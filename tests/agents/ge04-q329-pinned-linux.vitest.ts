import {describe,it,expect} from 'vitest';
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,rmSync,renameSync,writeFileSync,chmodSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnPinnedNativeProbe} from '../../src/agents/worker-broker-pinned-probe.js';

const enabled=process.env.ALIX_GE04_PINNED_LINUX_TEST==='1';
function collect(child:ReturnType<typeof spawn>):Promise<{code:number|null,out:string,err:string}>{
 return new Promise((resolve,reject)=>{let out='',err='';child.stdout?.on('data',(d:Buffer)=>out+=d.toString());child.stderr?.on('data',(d:Buffer)=>err+=d.toString());child.once('error',reject);child.once('close',code=>resolve({code,out,err}));});
}
describe.skipIf(!enabled)('GE-04 Q3.29 root-controlled descriptor-pinned execution',()=>{
 it('executes verified native binary via pinned fd and rejects path replacement after opening',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('Requires root-owned disposable Linux environment');
  const dir='/root/alix-ge04-q329-'+process.pid;mkdirSync(dir,{mode:0o700});
  const executable=join(dir,'probe'),launcher=join(dir,'launcher');
  try{
   execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',executable,resolve('native/ge04/broker-peer-probe.c')]);
   execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',launcher,resolve('native/ge04/exec-pinned-probe.c')]);
   const child=spawnPinnedNativeProbe(executable,launcher,['/'+ 'x'.repeat(140),'10001','10002']);
   // A successfully pinned executable can execute despite subsequent path replacement.
   renameSync(executable,join(dir,'original'));
   writeFileSync(executable,'not executable');chmodSync(executable,0o600);
   const result=await collect(child);
   // The genuine native probe rejects a too-long Unix socket path with exit 64.
   expect(result.err).not.toContain('execveat pinned probe failed');
   expect(result.code).toBe(64);
   expect(()=>spawnPinnedNativeProbe(executable,launcher,['/tmp/no','10001','10002'])).toThrow();
  }finally{rmSync(dir,{recursive:true,force:true});}
 },20000);
});
