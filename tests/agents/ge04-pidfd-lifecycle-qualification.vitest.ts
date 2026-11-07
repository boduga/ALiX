import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

// A single native parent owns a child and retains its pidfd across stop,
// wait-for-stop, resume, kill and reap. No worker execution or cgroup admission.
test.skipIf(process.platform!=='linux')('native parent retains one pidfd for its entire test child lifecycle',async()=>{
 const dir=await mkdtemp('/tmp/alix-pidfd-lifecycle-');
 try{
  const binary=join(dir,'lifecycle');
  const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',binary,
   'native/ge04/pidfd-lifecycle-qualification.c'],{encoding:'utf8'});
  expect(compile.status,compile.stderr).toBe(0);
  const invalid=spawnSync(binary,['123'],{encoding:'utf8',timeout:5000});
  expect(invalid.status,invalid.stderr).toBe(64);
  const run=spawnSync(binary,[],{encoding:'utf8',timeout:5000});
  expect(run.status,run.stderr).toBe(0);
  expect(run.stdout).toContain('retained-pidfd lifecycle: PASS');
 }finally{await rm(dir,{recursive:true,force:true});}
});
