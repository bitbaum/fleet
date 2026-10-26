import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const workflow = new URL('../../templates/package/.github/workflows/release-notify.yml', import.meta.url);
const script = execFileSync('python3', ['-c', 'import yaml,sys; print(yaml.safe_load(open(sys.argv[1]))["jobs"]["notify"]["steps"][0]["run"])', workflow.pathname], {encoding:'utf8'});
const dir = mkdtempSync(join(tmpdir(), 'release-notify-'));
try {
  writeFileSync(join(dir,'gh'), `#!/usr/bin/env node
const args=process.argv.slice(2), f=JSON.parse(process.env.FIXTURE);
if(args.includes('--method')) {require('node:fs').writeFileSync(process.env.POST,require('node:fs').readFileSync(0)); process.exit(0);}
if(args[1].includes('/contents/')) console.log(Buffer.from(JSON.stringify({version:f.version})).toString('base64'));
else if(args[1].includes('/commits/')) {if(!f.tagged) process.exit(1); console.log(f.tagged);}
else if(args[1].includes('/actions/runs?')) console.log(f.ci);
else throw new Error('Unexpected API request: '+args.join(' '));
`, {mode:0o755});
  const sha='a'.repeat(40), valid={version:'0.7.2',tagged:sha,ci:'success'};
  const run=(fixture,token='synthetic-maintenance-token')=>{
    rmSync(join(dir,'post'),{force:true});
    return spawnSync('bash',['-euo','pipefail','-c',script],{encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,FIXTURE:JSON.stringify(fixture),SHA:sha,GH_REPO:'bitbaum/accountkit',FLEET_TOKEN:token,POST:join(dir,'post'),GITHUB_STEP_SUMMARY:join(dir,'summary')}});
  };
  for(const fixture of [{...valid,version:'0.7.2-beta.1'},{...valid,tagged:null},{...valid,tagged:'b'.repeat(40)},{...valid,ci:'failure'},{...valid,ci:'null'}]) {
    const result=run(fixture); assert.equal(result.status,0,result.stderr);
    assert.throws(()=>readFileSync(join(dir,'post')));
  }
  assert.equal(run(valid,'').status,1,'missing cross-repo authority must be visible');
  const result=run(valid);assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'post'),'utf8')),{event_type:'shared-package-release',client_payload:{repository:'bitbaum/accountkit',version:'0.7.2',commit:sha}});
  console.log('7 release-notification scenarios pass: only verified tagged releases notify; missing authority fails visibly.');
} finally {rmSync(dir,{recursive:true,force:true});}
