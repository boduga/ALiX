import {describe,it,expect} from 'vitest';
import {execFileSync,spawn} from 'node:child_process';
import {mkdirSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runSupervisedNativeProbe} from '../../src/agents/worker-broker-supervised-probe.js';
const enabled=process.env.ALIX_GE04_Q330_LINUX_TEST==='1';
function client(uid:number,socketPath:string):Promise<{code:number|null,out:string}>{
 return new Promise((resolve,reject)=>{
  const script=`const s=require('node:net').connect(process.argv[1]);s.on('data',d=>process.stdout.write(d));s.on('error',e=>{console.error(e.message);process.exitCode=2});`;
  const child=spawn('setpriv',['--reuid',String(uid),'--regid',String(uid),'--clear-groups',process.execPath,'-e',script,socketPath]);
  let out='';child.stdout.on('data',(d:Buffer)=>out+=d.toString());child.once('error',reject);child.once('close',code=>resolve({code,out}));
 });
}
async function waitForSocket(path:string){
 const end=Date.now()+4000;
 while(Date.now()<end){try{if(statSync(path).isSocket())return;}catch{}await new Promise(r=>setTimeout(r,20));}
 throw new Error('Native socket never became ready');
}
describe.skipIf(!enabled)('GE-04 Q3.30 pinned supervised distinct-UID Linux integration',()=>{
 it('checks authorized and denied kernel peer UIDs through pinned supervised probe',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('Disposable root Linux environment required');
  const dir='/root/alix-ge04-q330-'+process.pid;mkdirSync(dir,{mode:0o700});
  const executable=join(dir,'probe'),launcher=join(dir,'launcher');
  try{
   execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',executable,resolve('native/ge04/broker-peer-probe.c')]);
   execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',launcher,resolve('native/ge04/exec-pinned-probe.c')]);
   for(const [uid,authorized,reply] of [[10002,true,'OK\n'],[10003,false,'DENIED\n'],[10001,false,'DENIED\n']] as const){
    const socketPath=join('/tmp',`alix-ge04-q330-${process.pid}-${uid}.sock`);
    const pending=runSupervisedNativeProbe({executable,trustedLauncherPath:launcher,socketPath,brokerUid:10001,allowedUid:10002,testPublicSocket:true,timeoutMs:5000});
    // Attach a rejection handler immediately so early native failures are not unhandled.
    const outcome=pending.then(value=>({value,error:null as Error|null}),error=>({value:null,error:error as Error}));
    try { await waitForSocket(socketPath); } catch(error) {
      const settled=await outcome;
      throw settled.error ?? error;
    }
    const result=await client(uid,socketPath);
    expect(result.code).toBe(0);expect(result.out).toBe(reply);
    const settled=await outcome;
    if(settled.error)throw settled.error;
    const handoff=settled.value!;
    expect(handoff.peer.uid).toBe(uid);expect(handoff.authorized).toBe(authorized);
  }
  }finally{rmSync(dir,{recursive:true,force:true});}
 },30000);
});
