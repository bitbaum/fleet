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

test("standalone nested starters use their own lockfile for package rollout evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "rollout-nested-cli-"));
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const tip = "c".repeat(40);
  const standaloneLock = (version) =>
    `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@bitbaum/ai-kit':\n        specifier: ^${version}\n        version: ${version}\n`;
  const canaryLock =
    `lockfileVersion: '9.0'\nimporters:\n  .:\n  packages/ai:\n    dependencies:\n      '@bitbaum/ai-kit':\n        specifier: ^1.21.4\n        version: 1.21.4\n`;
  const rootLock = "lockfileVersion: '9.0'\nimporters:\n  .:\n";
  try {
    writeFileSync(
      join(dir, "gh"),
      `#!${process.execPath}
const [verb,path] = process.argv.slice(2);
const base=${JSON.stringify(base)}, head=${JSON.stringify(head)}, tip=${JSON.stringify(tip)};
const lock=${standaloneLock.toString()};
const canaryLock=${JSON.stringify(canaryLock)};
const rootLock=${JSON.stringify(rootLock)};
const encode = value => ({content:Buffer.from(value).toString('base64')});
let result;
if(verb!=='api') throw Error('unexpected CLI invocation');
if(path==='repos/bitbaum/loki/pulls/1') result={base:{sha:base},head:{sha:head}};
else if(path.includes('/pulls/1/files?')) result=[{filename:'scripts/site-template/package.json'},{filename:'scripts/site-template/pnpm-lock.yaml'}];
else if(path==='repos/bitbaum/kivvi') result={default_branch:'main'};
else if(path==='repos/bitbaum/kivvi/commits/main') result={sha:tip};
else if(path.includes('repos/bitbaum/kivvi/actions/workflows/deploy.yml/runs?')) result={workflow_runs:[{conclusion:'success',head_sha:tip,updated_at:new Date().toISOString()}]};
else if(path.includes('repos/bitbaum/kivvi/actions/runs?')) result={workflow_runs:['ci.yml','browser-smoke.yml'].map(p=>({path:'.github/workflows/'+p,event:'push',conclusion:'success'}))};
else if(path.includes('repos/bitbaum/loki/actions/runs?')) result={workflow_runs:[{path:'.github/workflows/ci.yml',event:'pull_request',conclusion:'success'}]};
else if(path.includes('/contents/')) {
 const [repo,file,ref]=/^repos\\/([^/]+\\/[^/]+)\\/contents\\/(.+)\\?ref=(.+)$/.exec(path).slice(1);
 let value=null;
 if(repo==='bitbaum/loki' && file==='package.json') value=JSON.stringify({name:'loki',dependencies:{}});
 if(repo==='bitbaum/loki' && file==='pnpm-lock.yaml') value=rootLock;
 if(repo==='bitbaum/loki' && file==='scripts/site-template/package.json') value=JSON.stringify({name:'starter',dependencies:{'@bitbaum/ai-kit':'^'+(ref===base?'1.21.0':'1.21.4')}});
 if(repo==='bitbaum/loki' && file==='scripts/site-template/pnpm-lock.yaml') value=lock(ref===base?'1.21.0':'1.21.4');
 if(repo==='bitbaum/kivvi' && file==='packages/ai/package.json') value=JSON.stringify({name:'@kivvi/ai',dependencies:{'@bitbaum/ai-kit':'^1.21.4'}});
 if(repo==='bitbaum/kivvi' && file==='pnpm-lock.yaml') value=canaryLock;
 if(value!==null) result=encode(value);
}
if(result===undefined){console.error('404');process.exit(1)}
console.log(JSON.stringify(result));
`,
      { mode: 0o755 },
    );
    const run = spawnSync(
      process.execPath,
      [
        new URL("./package-rollout-gate.mjs", import.meta.url).pathname,
        "bitbaum/loki",
        "1",
      ],
      { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
    );
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /@bitbaum\/ai-kit@1\.21\.4: wait for bitbaum\/kivvi/);
    assert.doesNotMatch(run.stdout + run.stderr, /no importer-specific lock evidence/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
