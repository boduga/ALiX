import {expect,test} from 'vitest';
import {createNativeLauncherQualificationBackend} from '../../src/agents/worker-supervisor-native-backend.js';

test.skipIf(process.platform!=='linux'||process.getuid?.()===0)('native qualification backend refuses unprivileged composition',()=>{
 expect(()=>createNativeLauncherQualificationBackend({
   launcherPath:'/usr/bin/id',selections:new Map(),
 })).toThrow(/requires trusted root supervisor/);
});

// Run only in a disposable privileged VM. This is a live backend integration
// probe, not process-tree confinement or production credential qualification.
test.skipIf(process.platform!=='linux'||process.getuid?.()!==0||
 process.env.ALIX_GE04_PRIVILEGED_QUALIFICATION!=='1'||
 !/^[1-9][0-9]*$/.test(process.env.ALIX_GE04_TEST_WORKER_UID??''))(
 'root native backend launches pinned executable and reaps isolated child',async()=>{
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const {join,resolve}=await import('node:path');
  const uid=Number(process.env.ALIX_GE04_TEST_WORKER_UID);
  const dir=await mkdtemp('/run/ge04-backend-');
  try{
   const launcher=join(dir,'launcher');
   const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',launcher,
    resolve('native/ge04/isolated-worker-launcher.c')],{encoding:'utf8'});
   expect(compile.status,compile.stderr).toBe(0);
   const backend=createNativeLauncherQualificationBackend({launcherPath:launcher,
    selections:new Map([['test',{uid,executable:'/usr/bin/sleep',argument:'30'}]])});
   const child=await backend.launch({identity:{coordinationRunId:'vm',workerId:'backend',attempt:1},
    configurationId:'test',workspaceRoot:'/usr'});
   expect(child.uid).toBe(uid);
   await child.terminate('test cleanup');
   const result=await child.wait();
   expect(result.signal).toBe('SIGKILL');
  }finally{await rm(dir,{recursive:true,force:true});}
 });

// A requested containment guarantee must never downgrade to the legacy
// process-group-only backend, even on a privileged supervisor host.
test.skipIf(process.platform!=='linux'||process.getuid?.()!==0)(
 'native backend rejects kernel containment request before launching',()=>{
  expect(()=>createNativeLauncherQualificationBackend({
   launcherPath:'/not/a/launcher',requireKernelContainment:true,selections:new Map(),
  })).toThrow(/SECURITY HOLD: kernel containment backend unavailable/);
 });
