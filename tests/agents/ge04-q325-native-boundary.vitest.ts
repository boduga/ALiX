import {describe,it,expect} from 'vitest';
import {execFileSync,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {chmodSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const enabled=process.env.ALIX_GE04_NATIVE_BOUNDARY_TEST==='1';
const brokerUid=10001,authorizedUid=10002,unauthorizedUid=10003;
function asUid(uid:number,command:string,args:string[]){
 return spawn('setpriv',['--reuid',String(uid),'--regid',String(uid),'--clear-groups',command,...args],{stdio:['pipe','pipe','pipe']});
}
function collect(child:ChildProcessWithoutNullStreams):Promise<{code:number|null,stdout:string,stderr:string}>{
 return new Promise((resolve,reject)=>{
  let stdout='',stderr='';child.stdout.on('data',(d:Buffer)=>stdout+=d.toString());child.stderr.on('data',(d:Buffer)=>stderr+=d.toString());
  child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 });
}
async function ready(child:ChildProcessWithoutNullStreams){
 return new Promise<void>((resolve,reject)=>{
  let out='',err='';const timer=setTimeout(()=>reject(new Error('Native broker readiness timeout: '+err)),5000);
  child.stderr.on('data',(d:Buffer)=>err+=d.toString());
  const onData=(d:Buffer)=>{out+=d.toString();if(out.includes('READY\n')){clearTimeout(timer);child.stdout.off('data',onData);resolve();}};
  child.stdout.on('data',onData);child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('exit',code=>{clearTimeout(timer);reject(new Error('Native broker exited: '+code+' '+err));});
 });
}
describe.skipIf(!enabled)('GE-04 Q3.25 native SO_PEERCRED distinct UID boundary',()=>{
 it('accepts only the authorized distinct UID and rejects broker/unauthorized UIDs',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('Requires disposable root Linux container');
  for(const uid of [brokerUid,authorizedUid,unauthorizedUid]){
   const r=await collect(asUid(uid,'id',['-u']));expect(r.code).toBe(0);expect(r.stdout.trim()).toBe(String(uid));
  }
  const dir=mkdtempSync(join(tmpdir(),'ge04-q325-'));chmodSync(dir,0o777);
  const binary=join(dir,'native-probe');
  try{
   execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',binary,resolve('native/ge04/broker-peer-probe.c')]);
   for(const [uid,reply,authorized] of [[authorizedUid,'OK\n','1'],[unauthorizedUid,'DENIED\n','0'],[brokerUid,'DENIED\n','0']] as const){
    const sock=join(dir,`broker-${uid}.sock`);
    const server=asUid(brokerUid,binary,[sock,String(brokerUid),String(authorizedUid),'--test-public-socket']);
    try{
     await ready(server);
     const script=`const s=require('node:net').connect(process.argv[1]);s.setTimeout(3000,()=>s.destroy());s.on('data',d=>process.stdout.write(d));s.on('error',e=>{console.error(e.message);process.exitCode=2});`;
     const client=await collect(asUid(uid,process.execPath,['-e',script,sock]));
     expect(client.code).toBe(0);expect(client.stdout).toBe(reply);
     const result=await collect(server);
     expect(result.code).toBe(0);
     expect(result.stdout).toContain(`uid=${uid} authorized=${authorized}`);
    }finally{if(server.exitCode===null){server.kill('SIGKILL');await new Promise<void>(r=>server.once('exit',()=>r()));}}
   }
  }finally{rmSync(dir,{recursive:true,force:true});}
 },20000);
});
