import {describe,it,expect} from 'vitest';
import {execFileSync,spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {accessSync,chmodSync,chownSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const enabled=process.env.ALIX_GE04_DISTINCT_UID_TEST==='1';
const brokerUid=10001,authorizedUid=10002,unauthorizedUid=10003;
function asUid(uid:number,command:string,args:string[]) {
 return spawn('setpriv',['--reuid',String(uid),'--regid',String(uid),'--clear-groups',command,...args],{stdio:['pipe','pipe','pipe']});
}
function collect(child:ChildProcessWithoutNullStreams):Promise<{code:number|null,stdout:string,stderr:string}> {
 return new Promise((resolve,reject)=>{
  let stdout='',stderr='';child.stdout.on('data',(c:Buffer)=>stdout+=c.toString());child.stderr.on('data',(c:Buffer)=>stderr+=c.toString());
  child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 });
}
async function probe(path:string,uid:number){
 const script=`const net=require('node:net');const s=net.connect(process.argv[1]);s.setTimeout(3000,()=>s.destroy());s.on('data',d=>process.stdout.write(d));s.on('error',()=>{process.exitCode=2});`;
 return collect(asUid(uid,process.execPath,['-e',script,path]));
}
async function ready(child:ChildProcessWithoutNullStreams):Promise<void>{
 return new Promise((resolve,reject)=>{
  let output='',stderr='';child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString();});const timer=setTimeout(()=>reject(new Error('Broker readiness timeout: '+output+' stderr: '+stderr)),5000);
  const onData=(chunk:Buffer)=>{output+=chunk.toString();if(output.includes('READY\n')){clearTimeout(timer);child.stdout.off('data',onData);resolve();}};
  child.stdout.on('data',onData);child.once('error',err=>{clearTimeout(timer);reject(err);});
  child.once('exit',code=>{clearTimeout(timer);reject(new Error('Broker exited before ready: '+code+' stderr: '+stderr+' stdout: '+output));});
 });
}
describe.skipIf(!enabled)('GE-04 Q3.22 distinct UID probe (Linux)',()=>{
 it('separates broker, authorized worker, and unauthorized worker OS identities',async()=>{
  if(process.platform!=='linux'||process.getuid?.()!==0)throw new Error('Run Q3.22 as root inside a disposable Linux container');
  for(const uid of [brokerUid,authorizedUid,unauthorizedUid]){
   const result=await collect(asUid(uid,'id',['-u']));
   if(result.code!==0||result.stdout.trim()!==String(uid))throw new Error('Cannot switch to test UID '+uid+': '+result.stderr);
  }
  const dir=mkdtempSync(join(tmpdir(),'ge04-q322-'));
  const sock=join(dir,'broker.sock'),helper=join(dir,'peercred'),secret=join(dir,'broker.key'),script=join(dir,'broker.mjs');
  let broker:ChildProcessWithoutNullStreams|undefined;
  try{
   chownSync(dir,brokerUid,brokerUid);chmodSync(dir,0o711);
   execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',helper,resolve('native/ge04/peercred.c')]);chmodSync(helper,0o755);
   writeFileSync(secret,'broker-owned-test-secret',{mode:0o600});chownSync(secret,brokerUid,brokerUid);chmodSync(secret,0o600);
   // The disposable container copy may inherit host checkout directory modes.
   // Permit non-root broker traversal of compiled test modules (not the broker secret).
   for(const path of ['.','dist','dist/src','dist/src/agents'])chmodSync(resolve(path),0o755);
   const transportPath=resolve('dist/src/agents/worker-broker-transport.js');
   accessSync(transportPath);
   const transport=pathToFileURL(transportPath).href;
   const attestor=pathToFileURL(resolve('dist/src/agents/worker-broker-linux-peercred.js')).href;
   writeFileSync(script,`import {chmodSync} from 'node:fs';\nimport {createBrokerProbeServer} from ${JSON.stringify(transport)};\nimport {createLinuxPeerCredentialAttestor} from ${JSON.stringify(attestor)};\nconst server=createBrokerProbeServer({socketPath:${JSON.stringify(sock)},peerPolicy:{brokerUid:${brokerUid},allowedWorkerUids:[${authorizedUid}]},attestPeer:createLinuxPeerCredentialAttestor(${JSON.stringify(helper)}),onAuthorizedPeer:async()=>{}});\nserver.listen(${JSON.stringify(sock)},()=>{chmodSync(${JSON.stringify(sock)},0o666);process.stdout.write('READY\\n')});\n`,{mode:0o644});
   const started=asUid(brokerUid,process.execPath,[script]);broker=started;await ready(started);
   const allowed=await probe(sock,authorizedUid);expect(allowed).toEqual({code:0,stdout:'OK\n',stderr:''});
   const unauthorized=await probe(sock,unauthorizedUid);expect(unauthorized.stdout).toBe('');
   const sameUid=await probe(sock,brokerUid);expect(sameUid.stdout).toBe('');
   for(const uid of [authorizedUid,unauthorizedUid]){
    const read=await collect(asUid(uid,'cat',[secret]));expect(read.code).not.toBe(0);expect(read.stdout).toBe('');
   }
   expect(readFileSync(secret,'utf8')).toBe('broker-owned-test-secret');
  }finally{
   if(broker && broker.exitCode===null){broker.kill('SIGTERM');await new Promise<void>(r=>{if(broker!.exitCode!==null)r();else broker!.once('exit',()=>r());});}
   rmSync(dir,{recursive:true,force:true});
  }
 },15000);
});
