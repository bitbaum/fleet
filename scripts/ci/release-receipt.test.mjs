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

test("CLI attests nested independent lock roots without confusing project identity with importer identity", async () => {
  const { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  for (const manager of ["pnpm", "npm"]) {
    const root = mkdtempSync(join(tmpdir(), "fleet-nested-receipt-"));
    try {
      const project = join(root, "frontend");
      mkdirSync(join(project, "node_modules/chat"), { recursive: true });
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");
      writeFileSync(join(project, "package.json"), JSON.stringify(manifest));
      writeFileSync(
        join(project, "node_modules/chat/package.json"),
        JSON.stringify({ name, version: "0.15.2" }),
      );
      if (manager === "pnpm")
        writeFileSync(join(project, "pnpm-lock.yaml"), pnpmLock);
      else
        writeFileSync(
          join(project, "package-lock.json"),
          JSON.stringify({
            lockfileVersion: 3,
            packages: {
              "node_modules/chat": { version: "0.15.2" },
              "node_modules/unrelated": { version: "1.0.1" },
            },
          }),
        );
      const git = (...args) =>
        execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
      git("init", "--quiet");
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
        "nested fixture",
      );
      const output = join(root, "receipt.json");
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("./release-receipt.mjs", import.meta.url)),
          "--public",
          "--root",
          root,
          "--dir",
          project,
          "--repo",
          input.repo,
          "--output",
          output,
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, `${manager}: ${result.stderr}`);
      const receipt = JSON.parse(readFileSync(output, "utf8"));
      assert.equal(receipt.project, "frontend");
      assert.deepEqual(receipt.projects, ["frontend"]);
      assert.deepEqual(receipt.artifacts, { [name]: "0.15.2" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("workspace package identity is the owning commit, never an unverified local link", () => {
  const localName = "@bitbaum/product-local";
  const localInput = {
    ...input,
    manifest: { dependencies: { [localName]: "workspace:*" } },
    pnpmLock: `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '${localName}':\n        specifier: workspace:*\n        version: link:packages/local\n`,
    installed: { [localName]: { name: localName, version: "0.2.0" } },
    workspacePackages: {
      [`.:${localName}`]: {
        path: "packages/local",
        name: localName,
        version: "0.2.0",
      },
    },
  };
  const receipt = createReleaseReceipt(localInput);
  assert.deepEqual(receipt.artifacts, {
    [localName]: `https://codeload.github.com/${input.repo}/tar.gz/${input.commit}`,
  });
  assert.equal(
    receiptMatches(receipt, {
      repo: input.repo,
      commit: input.commit,
      artifacts: receipt.artifacts,
    }),
    true,
  );
  for (const change of [
    { workspacePackages: {} },
    {
      workspacePackages: {
        [`.:${localName}`]: {
          path: "packages/other",
          name: localName,
          version: "0.2.0",
        },
      },
    },
    {
      workspacePackages: {
        [`.:${localName}`]: {
          path: "packages/local",
          name: "@bitbaum/other",
          version: "0.2.0",
        },
      },
    },
    {
      workspacePackages: {
        [`.:${localName}`]: {
          path: "packages/local",
          name: localName,
          version: "0.1.0",
        },
      },
    },
    {
      pnpmLock: localInput.pnpmLock.replace(
        "link:packages/local",
        "link:../outside",
      ),
    },
    { manifest: { dependencies: { [localName]: "file:packages/local" } } },
  ])
    assert.throws(
      () => createReleaseReceipt({ ...localInput, ...change }),
      /workspace package|immutable locked/,
    );
});

test("CLI verifies tracked workspace sources and real installed symlink targets", async () => {
  const {
    mkdtempSync,
    writeFileSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
  } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const localName = "@bitbaum/product-local";
  for (const scenario of [
    "root",
    "nested",
    "wrong-lock-path",
    "outside",
    "dirty-source",
  ]) {
    const base = mkdtempSync(join(tmpdir(), "fleet-local-receipt-"));
    const root = join(base, "repo");
    try {
      const project = scenario === "nested" ? "apps/web" : ".";
      const appDir = join(root, project);
      const localDir = join(root, "packages/local");
      const installedDir =
        scenario === "outside" ? join(base, "outside") : localDir;
      mkdirSync(join(appDir, "node_modules/@bitbaum"), { recursive: true });
      mkdirSync(localDir, { recursive: true });
      mkdirSync(installedDir, { recursive: true });
      const localManifest = JSON.stringify({
        name: localName,
        version: "0.2.0",
      });
      writeFileSync(join(localDir, "package.json"), localManifest);
      writeFileSync(join(installedDir, "package.json"), localManifest);
      writeFileSync(join(localDir, "source.ts"), "export const value = 1;\n");
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");
      writeFileSync(
        join(appDir, "package.json"),
        JSON.stringify({ dependencies: { [localName]: "workspace:*" } }),
      );
      const link =
        scenario === "nested"
          ? "../../packages/local"
          : scenario === "wrong-lock-path"
            ? "packages/other"
            : "packages/local";
      writeFileSync(
        join(root, "pnpm-lock.yaml"),
        `lockfileVersion: '9.0'\nimporters:\n  ${project}:\n    dependencies:\n      '${localName}':\n        specifier: workspace:*\n        version: link:${link}\n`,
      );
      symlinkSync(installedDir, join(appDir, "node_modules", localName), "dir");
      const git = (...args) =>
        execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
      git("init", "--quiet");
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
        "local fixture",
      );
      const commit = git("rev-parse", "HEAD").toString().trim();
      if (scenario === "dirty-source")
        writeFileSync(join(localDir, "source.ts"), "export const value = 2;\n");
      const output = join(base, "receipt.json");
      const result = spawnSync(
        process.execPath,
        [
          fileURLToPath(new URL("./release-receipt.mjs", import.meta.url)),
          "--public",
          "--root",
          root,
          "--dir",
          appDir,
          "--repo",
          input.repo,
          "--output",
          output,
        ],
        { encoding: "utf8" },
      );
      if (["root", "nested"].includes(scenario)) {
        assert.equal(result.status, 0, result.stderr);
        const receipt = JSON.parse(readFileSync(output, "utf8"));
        assert.equal(
          receipt.artifacts[localName],
          `https://codeload.github.com/${input.repo}/tar.gz/${commit}`,
        );
        assert.equal(receipt.versions[localName], "0.2.0");
      } else {
        assert.notEqual(
          result.status,
          0,
          `${scenario} must not receive an exact-commit receipt`,
        );
        assert.match(
          result.stderr,
          /outside the checkout|workspace package|diff --quiet/,
        );
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
});
