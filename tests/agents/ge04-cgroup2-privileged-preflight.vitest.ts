/** Read-only cgroup2 qualification preflight for a disposable Linux VM.
 * Explicitly gated: never run as ordinary unit-test evidence.
 */
import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';

const enabled=process.platform==='linux' && process.getuid?.()===0 &&
 process.env.ALIX_GE04_PRIVILEGED_QUALIFICATION==='1' &&
 process.env.ALIX_GE04_CGROUP2_PREFLIGHT==='1';

test.skipIf(!enabled)('pinned real cgroup2 mount identity is observable without mutation',async()=>{
 const dir=await mkdtemp('/tmp/alix-ge04-cgroup-preflight-');
 try{
  const bin=join(dir,'probe');
  const cc=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',bin,
   'native/ge04/cgroup2-mount-preflight.c'],{encoding:'utf8'});
  expect(cc.status,cc.stderr).toBe(0);
  const root=process.env.ALIX_GE04_CGROUP2_ROOT;
  expect(root).toBeTruthy();
  const run=spawnSync(bin,[root!],{encoding:'utf8',timeout:5000});
  expect(run.status,run.stderr).toBe(0);
  expect(run.stdout).toContain('read-only cgroup2 preflight: PASS');
 }finally{await rm(dir,{recursive:true,force:true});}
});
