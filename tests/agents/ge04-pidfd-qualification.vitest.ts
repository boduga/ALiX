import {expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {join} from 'node:path';

// Qualification-only: the standalone helper does not retain a pidfd across
// calls and cannot establish an authenticated supervisor-child binding.
test.skipIf(process.platform!=='linux')('native pidfd helper validates inputs and signals its live child',async()=>{
 const dir=await mkdtemp('/tmp/alix-pidfd-');
 try{
  const binary=join(dir,'pidfd-probe');
  const compile=spawnSync('cc',['-Wall','-Wextra','-Werror','-O2','-o',binary,'native/ge04/pidfd-qualification.c'],{encoding:'utf8'});
  expect(compile.status,compile.stderr).toBe(0);
  expect(spawnSync(binary,['kill','-1']).status).toBe(64);
  expect(spawnSync(binary,['bogus','123']).status).toBe(64);
  const child=spawn('/usr/bin/sleep',['30'],{stdio:'ignore'});
  try{
   expect(child.pid).toBeGreaterThan(1);
   expect(spawnSync(binary,['alive',String(child.pid)]).status).toBe(0);
   expect(spawnSync(binary,['kill',String(child.pid)]).status).toBe(0);
   await new Promise<void>((resolve,reject)=>{child.once('exit',()=>resolve());child.once('error',reject)});
   expect(spawnSync(binary,['alive',String(child.pid)]).status).not.toBe(0);
  }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 }finally{await rm(dir,{recursive:true,force:true});}
});
