import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./publish-package-registry.sh',import.meta.url));
function run(f={}) {
 const dir=mkdtempSync(join(tmpdir(),'registry-proposal-')),state=join(dir,'state.json'),out=join(dir,'output');
 try {
  writeFileSync(state,JSON.stringify({commands:[],payload:null}));writeFileSync(out,'');
  const common=`const fs=require('node:fs'),p=process.env.FIXTURE_STATE,s=JSON.parse(fs.readFileSync(p)),f=JSON.parse(process.env.FIXTURE),args=process.argv.slice(2);const save=()=>fs.writeFileSync(p,JSON.stringify(s));`;
  writeFileSync(join(dir,'git'),`#!${process.execPath}\n${common}\ns.commands.push(['git',...args]);save();if(args[0]==='status'&&f.dirty)console.log(' M tracked');if(args[0]==='diff')process.exit(f.diffFailure?2:f.changed===false?0:1);if(args[0]==='rev-parse')console.log('a'.repeat(40));if(['push','reset','commit'].includes(args[0]))process.exit(99);\n`,{mode:0o755});
  writeFileSync(join(dir,'node'),`#!${process.execPath}\n${common}\ns.commands.push(['node',...args]);save();if(f.generationFailure)process.exit(1);\n`,{mode:0o755});
  writeFileSync(join(dir,'gh'),`#!${process.execPath}\n${common}\ns.commands.push(['gh',...args]);s.payload=JSON.parse(fs.readFileSync(0,'utf8'));save();if(f.dispatchFailure)process.exit(1);\n`,{mode:0o755});
  const r=spawnSync('bash',[script],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,FIXTURE_STATE:state,FIXTURE:JSON.stringify(f),GITHUB_ACTIONS:f.local?'false':'true',GITHUB_REPOSITORY:'bitbaum/fleet',GITHUB_REF:f.branch?'refs/heads/candidate':'refs/heads/main',FLEET_DISPATCH_TOKEN:'synthetic-dispatch',GITHUB_OUTPUT:out}});
  return {...r,state:JSON.parse(readFileSync(state)),output:readFileSync(out,'utf8')};
 } finally {rmSync(dir,{recursive:true,force:true});}
}
test('changed facts are proposed without direct main writes or premature notification',()=>{const r=run();assert.equal(r.status,0,r.stderr);assert.equal(r.output,'changed=true\n');assert.equal(r.state.payload,null);assert.ok(!r.state.commands.some(c=>c[0]==='gh'||['push','commit','reset'].includes(c[1])));});
test('unchanged main facts notify the exact landed source and recover missed dispatches',()=>{const r=run({changed:false});assert.equal(r.status,0,r.stderr);assert.equal(r.output,'changed=false\n');assert.equal(r.state.payload.client_payload.packages_sha,'a'.repeat(40));});
test('failed catalogue notification stays visibly red for retry',()=>assert.equal(run({changed:false,dispatchFailure:true}).status,1));
test('generation failure cannot propose or notify',()=>{const r=run({generationFailure:true});assert.equal(r.status,1);assert.equal(r.output,'');assert.equal(r.state.payload,null);});
test('local and candidate checkouts cannot publish proposed facts',()=>{for(const f of [{local:true},{branch:true}]){const r=run(f);assert.equal(r.status,1);assert.deepEqual(r.state.commands,[]);}});
test('tracked changes are never overwritten or mixed into a proposal',()=>{const r=run({dirty:true});assert.equal(r.status,1);assert.equal(r.output,'');assert.equal(r.state.commands.length,1);});

test('failed diff is not mistaken for changed facts',()=>{const r=run({diffFailure:true});assert.equal(r.status,2);assert.equal(r.output,'');assert.equal(r.state.payload,null);});
