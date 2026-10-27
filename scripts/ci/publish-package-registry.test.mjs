import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const script=fileURLToPath(new URL("./publish-package-registry.sh",import.meta.url));
function run(fixture, authorized=true) {
  const dir=mkdtempSync(join(tmpdir(),"registry-publish-")), state=join(dir,"state.json");
  try {
    writeFileSync(state,JSON.stringify({commands:[],attempt:0,pushes:0,payload:null}));
    const common=`const fs=require('node:fs'), state=process.env.FIXTURE_STATE, f=JSON.parse(process.env.FIXTURE), s=JSON.parse(fs.readFileSync(state)), args=process.argv.slice(2);const save=()=>fs.writeFileSync(state,JSON.stringify(s));`;
    writeFileSync(join(dir,"git"),`#!${process.execPath}\n${common}
s.commands.push(['git',...args]);
if(args[0]==='fetch') s.attempt++;
else if(args[0]==='diff') {save();process.exit(f.changed===false?0:1);}
else if(args[0]==='push') {s.pushes++;if(s.pushes<=(f.races??0)||f.permission){save();console.error(f.permission?'HTTP 403 permission denied':'[rejected] main -> main (fetch first)');process.exit(1);}}
else if(args[0]==='rev-parse') console.log(String(s.attempt).repeat(40));
save();\n`,{mode:0o755});
    writeFileSync(join(dir,"node"),`#!${process.execPath}\n${common}
s.commands.push(['node',...args]);save();if(f.generationFailure)process.exit(1);\n`,{mode:0o755});
    writeFileSync(join(dir,"gh"),`#!${process.execPath}\n${common}
s.commands.push(['gh',...args]);if(args[0]==='api')s.payload=JSON.parse(fs.readFileSync(0,'utf8'));save();if((args[0]==='api'&&f.dispatchFailure)||(args[0]==='workflow'&&f.ciFailure))process.exit(1);\n`,{mode:0o755});
    const result=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,FIXTURE_STATE:state,FIXTURE:JSON.stringify(fixture),GITHUB_ACTIONS:authorized?'true':'false',GITHUB_REPOSITORY:'bitbaum/fleet',FLEET_DISPATCH_TOKEN:'synthetic-dispatch',REPO_ACTIONS_TOKEN:'synthetic-actions'}});
    return {...result,state:JSON.parse(readFileSync(state,'utf8'))};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
const calls=(r,cmd)=>r.state.commands.filter(c=>c[0]===cmd);
test('unchanged facts recover catalogue dispatch without writing or duplicate CI',()=>{const r=run({changed:false});assert.equal(r.status,0,r.stderr);assert.equal(r.state.pushes,0);assert.equal(calls(r,'gh').length,1);assert.equal(r.state.payload.client_payload.packages_sha,'1'.repeat(40));});
test('a successful changed registry dispatches its exact commit and re-arms CI',()=>{const r=run({});assert.equal(r.status,0,r.stderr);assert.equal(r.state.pushes,1);assert.equal(calls(r,'gh').length,2);assert.equal(r.state.payload.client_payload.packages_sha,'1'.repeat(40));});
test('a concurrent main update recomputes facts before retrying without force',()=>{const r=run({races:1});assert.equal(r.status,0,r.stderr);assert.equal(r.state.pushes,2);assert.equal(calls(r,'node').length,2);assert.equal(r.state.payload.client_payload.packages_sha,'2'.repeat(40));assert.ok(!calls(r,'git').some(c=>c.includes('--force')));});
test('repeated concurrency is bounded and never announces an unlanded registry',()=>{const r=run({races:9});assert.equal(r.status,1);assert.equal(r.state.pushes,3);assert.equal(calls(r,'gh').length,0);});
test('permission failures are not mistaken for concurrency',()=>{const r=run({permission:true});assert.equal(r.status,1);assert.equal(r.state.pushes,1);assert.equal(calls(r,'gh').length,0);});
test('catalogue failure still re-arms CI and remains red for recovery',()=>{const r=run({dispatchFailure:true});assert.equal(r.status,1);assert.equal(calls(r,'gh').length,2);});
test('failed CI re-arm remains visible',()=>{assert.equal(run({ciFailure:true}).status,1);});
test('generation failure cannot push or dispatch',()=>{const r=run({generationFailure:true});assert.equal(r.status,1);assert.equal(r.state.pushes,0);assert.equal(calls(r,'gh').length,0);});
test('local worktrees cannot accidentally execute the disposable-checkout reset',()=>{const r=run({},false);assert.equal(r.status,1);assert.equal(calls(r,'git').length,0);});
