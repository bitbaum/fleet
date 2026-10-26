import { test } from "node:test";
import assert from "node:assert/strict";
import { createReleaseReceipt, receiptMatches } from "./release-receipt.mjs";
import {
  lockedDependencies,
  lockedNpmDependencies,
} from "./package-rollout-gate.mjs";
const name = "@bitbaum/chatkit";
const manifest = {
  dependencies: { chat: "npm:@bitbaum/chatkit@^0.15.2", unrelated: "^1.0.0" },
};
const pnpmLock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      chat:\n        specifier: npm:@bitbaum/chatkit@^0.15.2\n        version: '@bitbaum/chatkit@0.15.2(react@19.3.1)'\n      unrelated:\n        specifier: ^1.0.0\n        version: 1.0.1\npackages:\n`;
const input = {
  repo: "bitbaum/example",
  commit: "a".repeat(40),
  manifest,
  pnpmLock,
  installed: { chat: { name, version: "0.15.2" } },
  createdAt: "2026-10-25T13:00:00Z",
};

test("receipt records canonical locked and installed artifacts without unrelated inventory", () => {
  const result = createReleaseReceipt(input);
  assert.deepEqual(result.artifacts, { [name]: "0.15.2" });
  assert.deepEqual(result.versions, { [name]: "0.15.2" });
  assert.match(result.lockSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("unrelated"), false);
  assert.equal(
    receiptMatches(result, {
      repo: input.repo,
      commit: input.commit,
      artifacts: { [name]: "0.15.2" },
    }),
    true,
  );
});
test("wrong product, commit, artifact or incomplete metadata cannot establish live evidence", () => {
  const receipt = createReleaseReceipt(input);
  assert.equal(
    receiptMatches(receipt, {
      repo: input.repo,
      commit: input.commit,
      artifacts: receipt.artifacts,
      lockSha256: "f".repeat(64),
    }),
    false,
  );
  const expected = {
    repo: input.repo,
    commit: input.commit,
    artifacts: receipt.artifacts,
  };
  for (const change of [
    { repo: "bitbaum/other" },
    { commit: "b".repeat(40) },
    { artifacts: {} },
    { project: "apps/web" },
    { lockSha256: null },
    { versions: {} },
    { createdAt: "unknown" },
  ]) {
    assert.equal(receiptMatches({ ...receipt, ...change }, expected), false);
  }
});
test("missing installed packages, different versions and absent locks refuse receipts", () => {
  assert.throws(
    () => createReleaseReceipt({ ...input, installed: {} }),
    /installed package metadata/,
  );
  assert.throws(
    () =>
      createReleaseReceipt({
        ...input,
        installed: { chat: { version: "0.14.0" } },
      }),
    /differs from the lockfile/,
  );
  assert.throws(
    () => createReleaseReceipt({ ...input, pnpmLock: undefined }),
    /supported lockfile/,
  );
  assert.throws(
    () => createReleaseReceipt({ ...input, commit: "main" }),
    /exact built commit/,
  );
});
test("workspace links and credential-bearing URLs cannot be published as immutable artifacts", () => {
  for (const artifact of [
    "link:packages/chatkit",
    "github:bitbaum/chatkit#main",
    "https://credential@github.com/bitbaum/chatkit#" + "a".repeat(40),
  ]) {
    const lock = pnpmLock.replace(
      "'@bitbaum/chatkit@0.15.2(react@19.3.1)'",
      artifact,
    );
    assert.throws(
      () => createReleaseReceipt({ ...input, pnpmLock: lock }),
      /immutable locked artifact/,
    );
  }
});
test("Git installs retain their immutable commit and installed package version", () => {
  const artifact =
    "https://codeload.github.com/bitbaum/accountkit/tar.gz/" + "b".repeat(40);
  const lock = `importers:\n  .:\n    dependencies:\n      '@bitbaum/accountkit':\n        specifier: github:bitbaum/accountkit#v0.6.2\n        version: ${artifact}(next@16.4.2)\n`;
  const result = createReleaseReceipt({
    ...input,
    manifest: {
      dependencies: {
        "@bitbaum/accountkit": "github:bitbaum/accountkit#v0.6.2",
      },
    },
    pnpmLock: lock,
    installed: { "@bitbaum/accountkit": { version: "0.6.2" } },
  });
  assert.equal(result.artifacts["@bitbaum/accountkit"], artifact);
  assert.equal(result.versions["@bitbaum/accountkit"], "0.6.2");
});
test("multi-importer receipts attest app and nested workspace packages", () => {
  const ai = "@bitbaum/ai-kit";
  const lock = pnpmLock
    .replace("  .:", "  apps/web:")
    .replace(
      "packages:",
      "  'packages/ai':\n    dependencies:\n      '@bitbaum/ai-kit':\n        specifier: ^1.21.4\n        version: 1.21.4\npackages:",
    );
  const result = createReleaseReceipt({
    ...input,
    importers: ["apps/web", "packages/ai"],
    importer: "apps/web",
    manifests: {
      "apps/web": manifest,
      "packages/ai": { dependencies: { [ai]: "^1.21.4" } },
    },
    pnpmLock: lock,
    installed: {
      chat: { name, version: "0.15.2" },
      [ai]: { name: ai, version: "1.21.4" },
    },
  });
  assert.deepEqual(result.projects, ["apps/web", "packages/ai"]);
  assert.deepEqual(result.artifacts, { [ai]: "1.21.4", [name]: "0.15.2" });
});
test("an explicitly selected nested importer cannot borrow root artifact evidence", () => {
  const nested = `  'apps/web':\n    dependencies:\n      chat:\n        specifier: npm:@bitbaum/chatkit@^0.15.2\n        version: '@bitbaum/chatkit@0.15.3(react@19.3.1)'\n`;
  const lock = pnpmLock.replace("packages:", nested + "packages:");
  assert.throws(
    () => lockedDependencies(manifest, pnpmLock + nested, "apps/web"),
    /Missing locked artifact/,
  );
  assert.equal(lockedDependencies(manifest, lock, "apps/web")[name], "0.15.3");
  assert.equal(lockedDependencies(manifest, lock)[name], "0.15.2");
  assert.throws(
    () => lockedDependencies(manifest, lock, "apps/missing"),
    /Missing locked artifact/,
  );
});
test("optional shared dependencies and npm aliases use the same evidence rules", () => {
  const optional = {
    optionalDependencies: { chat: "npm:@bitbaum/chatkit@^0.15.2" },
  };
  assert.equal(lockedDependencies(optional, pnpmLock)[name], "0.15.2");
  for (const lockfileVersion of [2, 3]) {
    const lock = {
      lockfileVersion,
      packages: { "node_modules/chat": { version: "0.15.2" } },
    };
    assert.equal(lockedNpmDependencies(optional, lock)[name], "0.15.2");
  }
  assert.throws(
    () => lockedNpmDependencies(optional, { lockfileVersion: 1 }),
    /Unsupported npm lockfile/,
  );
});

test("CLI uses the clean checked-out commit, requires public scope and rejects untracked source", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync, spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "fleet-receipt-"));
  try {
    writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "pnpm-lock.yaml"), pnpmLock);
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
    mkdirSync(join(dir, "node_modules/chat"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules/chat/package.json"),
      JSON.stringify({ name, version: "0.15.2" }),
    );
    const git = (...args) =>
      execFileSync("git", ["-C", dir, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    git("-c", "init.defaultBranch=main", "init", "--quiet");
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    );
    const commit = git("rev-parse", "HEAD").trim();
    const cli = new URL("./release-receipt.mjs", import.meta.url);
    const { fileURLToPath } = await import("node:url");
    const args = [fileURLToPath(cli), "--root", dir, "--repo", input.repo];
    const privateRun = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.notEqual(privateRun.status, 0);
    assert.match(privateRun.stderr, /private inventory stays internal/);
    const publicRun = spawnSync(process.execPath, [...args, "--public"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_SHA: "f".repeat(40) },
    });
    assert.equal(publicRun.status, 0, publicRun.stderr);
    const receipt = JSON.parse(
      readFileSync(join(dir, "public/.well-known/fleet-release.json"), "utf8"),
    );
    assert.equal(receipt.commit, commit);
    // Re-running the generated output is safe, but an extra source file is not.
    assert.equal(spawnSync(process.execPath, [...args, "--public"]).status, 0);
    writeFileSync(join(dir, "unexpected.ts"), "export const changed = true;");
    const dirty = spawnSync(process.execPath, [...args, "--public"], {
      encoding: "utf8",
    });
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /Untracked source/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
