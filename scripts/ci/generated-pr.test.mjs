import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CONFIG, assertOwnedPaths } from "./generated-pr.mjs";
const script = fileURLToPath(new URL("./generated-pr.mjs", import.meta.url));
function run(f = {}) {
  const dir = mkdtempSync(join(tmpdir(), "generated-pr-fixture-")),
    state = join(dir, "state");
  try {
    writeFileSync(state, "[]");
    const common = `const fs=require('node:fs'),p=process.env.FIXTURE_STATE,s=JSON.parse(fs.readFileSync(p)),f=JSON.parse(process.env.FIXTURE),a=process.argv.slice(2);s.push([TOOL,...a]);fs.writeFileSync(p,JSON.stringify(s));`;
    writeFileSync(
      join(dir, "git"),
      `#!${process.execPath}\n${common.replace("TOOL", "'git'")}\nif(a[0]==='diff'&&a.includes('--quiet'))process.exit(f.diffFailure?2:f.unchanged?0:1);if(a[0]==='diff'&&a.includes('--name-only'))console.log((f.paths??['registers/packages.json']).join('\\n'));if(a[0]==='ls-remote'&&f.remote)console.log('a'.repeat(40)+'\\trefs/heads/fleet/generated-package-registry');if(a[0]==='push'&&f.leaseFailure)process.exit(1);\n`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(dir, "gh"),
      `#!${process.execPath}\n${common.replace("TOOL", "'gh'")}\nif(f.apiFailure)process.exit(1);if(a[0]==='pr'&&a[1]==='list')console.log(JSON.stringify(f.existing?[{number:99}]:[]));if((a[0]==='pr'&&a[1]==='diff')||a[0]==='api')console.log((f.remotePaths??['registers/packages.json']).join('\\n'));\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [script, f.key ?? "registry"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: dir + ":" + process.env.PATH,
        FIXTURE_STATE: state,
        FIXTURE: JSON.stringify(f),
        GITHUB_ACTIONS: f.local ? "false" : "true",
        GITHUB_REPOSITORY: "bitbaum/fleet",
        GITHUB_REF: f.branch ? "refs/heads/candidate" : "refs/heads/main",
        GH_TOKEN: "synthetic-maintenance",
      },
    });
    return { ...result, calls: JSON.parse(readFileSync(state)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const pushes = (r) => r.calls.filter((c) => c[0] === "git" && c[1] === "push");
test("a generated update pushes only its owned feature branch and creates a normal PR", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(pushes(r)[0], [
    "git",
    "push",
    "--force-with-lease=refs/heads/fleet/generated-package-registry:",
    "origin",
    "HEAD:refs/heads/fleet/generated-package-registry",
  ]);
  assert.ok(
    r.calls.some(
      (c) =>
        c[0] === "gh" &&
        c[1] === "pr" &&
        c[2] === "create" &&
        c.includes("--body-file"),
    ),
  );
});
test("unchanged generated output never writes or opens a PR", () => {
  const r = run({ unchanged: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(pushes(r).length, 0);
  assert.ok(!r.calls.some((c) => c[0] === "gh"));
});
test("existing generated PR is updated with the observed lease and not duplicated", () => {
  const r = run({ remote: true, existing: true });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(
    pushes(r)[0].includes(
      "--force-with-lease=refs/heads/fleet/generated-package-registry:" +
        "a".repeat(40),
    ),
  );
  assert.ok(!r.calls.some((c) => c[0] === "gh" && c[2] === "create"));
});
test("local and candidate checkouts cannot invoke the writer", () => {
  for (const f of [{ local: true }, { branch: true }, { key: "unknown" }]) {
    const r = run(f);
    assert.equal(r.status, 1);
    assert.equal(r.calls.length, 0);
  }
});
test("unrelated local or existing branch changes are never overwritten", () => {
  for (const f of [
    { paths: ["scripts/user-work.mjs"] },
    { remote: true, existing: true, remotePaths: ["scripts/user-work.mjs"] },
  ]) {
    const r = run(f);
    assert.equal(r.status, 1);
    assert.equal(pushes(r).length, 0);
  }
});
test("failed diff or API evidence cannot become a clean proposal", () => {
  for (const f of [{ diffFailure: true }, { apiFailure: true }]) {
    const r = run(f);
    assert.equal(r.status, 1);
    assert.equal(pushes(r).length, 0);
  }
});
test("a failed branch lease cannot create a PR for unpushed content", () => {
  const r = run({ remote: true, leaseFailure: true });
  assert.equal(r.status, 1);
  assert.ok(!r.calls.some((c) => c[0] === "gh" && c[2] === "create"));
});
test("origin proofs permit their subtree but never other repository content", () => {
  assert.doesNotThrow(() =>
    assertOwnedPaths(
      ["proofs/origin/new-proof.ots", "registers/origin.json"],
      CONFIG.origin,
    ),
  );
  assert.throws(() => assertOwnedPaths(["proofs/other/file"], CONFIG.origin));
});
