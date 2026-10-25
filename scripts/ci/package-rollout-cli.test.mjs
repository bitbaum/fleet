import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// Exercise the real CLI, including both API orchestration paths. No network.
for (const project of [".", "templates/app"]) {
  test(`${project}: the CLI enforces served receipts as well as green workflows`, () => {
    const dir = mkdtempSync(join(tmpdir(), "rollout-cli-"));
    const tip = "c".repeat(40);
    const lock = (version) =>
      `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@bitbaum/sitekit':\n        specifier: ^${version}\n        version: ${version}\n`;
    const receipt = {
      formatVersion: 1,
      repo: "bitbaum/biaslens",
      commit: tip,
      project: ".",
      createdAt: "2026-10-20T00:00:00Z",
      lockSha256: createHash("sha256").update(lock("0.4.2")).digest("hex"),
      artifacts: { "@bitbaum/sitekit": "0.4.2" },
      versions: { "@bitbaum/sitekit": "0.4.2" },
    };
    try {
      writeFileSync(
        join(dir, "gh"),
        `#!${process.execPath}
const [verb, path] = process.argv.slice(2);
const project = process.env.FIXTURE_PROJECT;
const tip = 'c'.repeat(40);
const lock = ${lock.toString()};
const manifest = v => JSON.stringify({name:'fixture-app',dependencies:{'@bitbaum/sitekit':'^'+v}});
let result;
if (verb !== 'api') throw Error('unexpected CLI invocation');
if (path === 'repos/bitbaum/example/pulls/1') result={base:{sha:'a'.repeat(40)},head:{sha:'b'.repeat(40)}};
else if (path.includes('/pulls/1/files?')) result=[{filename:(project==='.'?'':project+'/')+'package.json'},{filename:(project==='.'?'':project+'/')+'pnpm-lock.yaml'}];
else if (path === 'repos/bitbaum/biaslens') result={default_branch:'main'};
else if (path === 'repos/bitbaum/biaslens/commits/main') result={sha:tip};
else if (path.includes('/actions/workflows/deploy.yml/runs?')) result={workflow_runs:[{conclusion:'success',head_sha:tip,updated_at:'2026-10-20T00:00:00Z'}]};
else if (path.includes('/actions/runs?')) result={workflow_runs:['ci.yml','browser-smoke.yml'].map(p=>({path:'.github/workflows/'+p,event:'push',conclusion:'success'}))};
else if (path.includes('/contents/')) {
 const [repo,file,ref]=/^repos\\/([^/]+\\/[^/]+)\\/contents\\/(.+)\\?ref=(.+)$/.exec(path).slice(1);
 const prefix=project==='.'?'':project+'/';
 const name=repo==='bitbaum/biaslens'?file:file.startsWith(prefix)?file.slice(prefix.length):null;
 const v=repo==='bitbaum/biaslens'||ref==='b'.repeat(40)?'0.4.2':'0.4.0';
 const content=name==='package.json'?manifest(v):name==='pnpm-lock.yaml'?lock(v):null;
 if(content!==null) result={content:Buffer.from(content).toString('base64')};
}
if(result===undefined){console.error('404');process.exit(1)}
console.log(JSON.stringify(result));
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(dir, "fetch.mjs"),
        `globalThis.fetch = async (url) => {
 if(new URL(url).hostname!=='biaslens.orangecat.ch') throw Error('unexpected network target');
 return new Response(process.env.FIXTURE_RECEIPT,{status:Number(process.env.FIXTURE_STATUS??200),headers:{'content-type':'application/json'}});
};`,
      );
      const run = (value, status = 200) =>
        spawnSync(
          process.execPath,
          [
            "--import",
            join(dir, "fetch.mjs"),
            new URL("./package-rollout-gate.mjs", import.meta.url).pathname,
            "bitbaum/example",
            "1",
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: dir + ":" + process.env.PATH,
              FIXTURE_PROJECT: project,
              FIXTURE_RECEIPT: JSON.stringify(value),
              FIXTURE_STATUS: String(status),
            },
          },
        );
      const good = run(receipt);
      assert.equal(good.status, 0, good.stdout + good.stderr);
      for (const bad of [
        { ...receipt, commit: "d".repeat(40) },
        { ...receipt, lockSha256: "0".repeat(64) },
        { ...receipt, artifacts: {} },
      ]) {
        const held = run(bad);
        assert.equal(held.status, 1, held.stdout + held.stderr);
        assert.match(held.stdout, /wait for .*soak for 24h/);
      }
      assert.equal(run(receipt, 503).status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
