import {describe,it,expect} from 'vitest';
import {execFileSync,spawn} from 'node:child_process';
import {chmodSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createBrokerProbeServer} from '../../src/agents/worker-broker-transport.js';
import {createLinuxPeerCredentialAttestor} from '../../src/agents/worker-broker-linux-peercred.js';

const enabled=process.env.ALIX_GE04_DISTINCT_UID_TEST==='1' && process.platform==='linux' && typeof process.getuid==='function' && process.getuid()!==0;
const workerUid=65534;
function probe(path:string,uid:number):Promise<{code:number|null,stdout:string,stderr:string}> {
 return new Promise((resolve,reject)=>{
  const script=`const net=require('node:net');const s=net.connect(process.argv[1]);s.setTimeout(3000,()=>s.destroy());s.on('data',d=>process.stdout.write(d));s.on('error',()=>process.exitCode=2);s.on('close',()=>{});`;
  const child=spawn('setpriv',['--reuid',String(uid),'--regid',String(uid),'--clear-groups',process.execPath,'-e',script,path],{stdio:['ignore','pipe','pipe']});
  let stdout='';let stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
 });
}
describe.skipIf(!enabled)('GE-04 Q3.22 distinct UID probe (Linux)',()=>{
 it('permits allowed different UID, rejects broker UID, and denies worker secret read',async()=>{
  const capability=spawn('setpriv',['--reuid',String(workerUid),'--regid',String(workerUid),'--clear-groups','id','-u']);
  const check=await new Promise<number|null>((ok,fail)=>{capability.on('error',fail);capability.on('close',ok);});
  if(check!==0) throw new Error('Distinct UID test requires privilege to switch to worker UID; run in privileged disposable test environment');
  const dir=mkdtempSync(join(tmpdir(),'ge04-q322-'));const sock=join(dir,'broker.sock');const helper=join(dir,'peercred');const secret=join(dir,'broker.key');
  chmodSync(dir,0o711);execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',helper,resolve('native/ge04/peercred.c')]);chmodSync(helper,0o755);
  writeFileSync(secret,'broker-owned-test-secret',{mode:0o600});chmodSync(secret,0o600);
  let accepted=0;const server=createBrokerProbeServer({socketPath:sock,peerPolicy:{brokerUid:process.getuid!(),allowedWorkerUids:[workerUid]},attestPeer:createLinuxPeerCredentialAttestor(helper),onAuthorizedPeer:async peer=>{expect(peer.uid).toBe(workerUid);accepted++;}});
  try{
   await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(sock,ok);});chmodSync(sock,0o666);
   const allowed=await probe(sock,workerUid);expect(allowed).toEqual({code:0,stdout:'OK\n',stderr:''});expect(accepted).toBe(1);
   const rejected=await probe(sock,process.getuid!());expect(rejected.stdout).toBe('');expect(accepted).toBe(1);
   const secretAttempt=spawn('setpriv',['--reuid',String(workerUid),'--regid',String(workerUid),'--clear-groups','cat',secret]);
   const secretCode=await new Promise<number|null>((ok,fail)=>{secretAttempt.on('error',fail);secretAttempt.on('close',ok);});expect(secretCode).not.toBe(0);
   expect(readFileSync(secret,'utf8')).toBe('broker-owned-test-secret');
  }finally{await new Promise<void>(ok=>server.close(()=>ok()));rmSync(dir,{recursive:true,force:true});}
 });
});
