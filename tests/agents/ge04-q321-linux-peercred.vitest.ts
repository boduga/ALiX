import {describe,it,expect} from 'vitest';
import {createServer,createConnection} from 'node:net';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createLinuxPeerCredentialAttestor} from '../../src/agents/worker-broker-linux-peercred.js';
import {createBrokerProbeServer} from '../../src/agents/worker-broker-transport.js';
const linux=process.platform==='linux' && typeof process.getuid==='function';
describe.skipIf(!linux)('GE-04 Q3.21 real kernel SO_PEERCRED',()=>{
 it('reads actual client PID and UID from kernel',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ge04-peercred-'));const helper=join(dir,'peercred');const sock=join(dir,'sock');
  execFileSync('cc',['-O2','-Wall','-Wextra','-Werror','-o',helper,resolve('native/ge04/peercred.c')]);
  const attest=createLinuxPeerCredentialAttestor(helper);
  let observed:any;
  const server=createServer(socket=>{void attest(socket).then(peer=>{observed=peer;socket.end('OK\n');}).catch(()=>socket.destroy());});
  try {await new Promise<void>(r=>server.listen(sock,r));
   const output=await new Promise<string>(r=>{const client=createConnection(sock);let result='';client.on('data',c=>result+=c.toString());client.on('close',()=>r(result));});
   expect(output).toBe('OK\n');expect(observed.uid).toBe(process.getuid!());expect(observed.pid).toBe(process.pid);
  }finally{await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
 });
 it('rejects same-UID clients through real kernel attestor and policy',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'ge04-peercred-policy-'));const helper=join(dir,'peercred');const sock=join(dir,'sock');
  execFileSync('cc',['-O2','-o',helper,resolve('native/ge04/peercred.c')]);let authorized=0;
  const server=createBrokerProbeServer({socketPath:sock,peerPolicy:{brokerUid:process.getuid!(),allowedWorkerUids:[process.getuid!()]},attestPeer:createLinuxPeerCredentialAttestor(helper),onAuthorizedPeer:async()=>{authorized++;}});
  try{await new Promise<void>(r=>server.listen(sock,r));
   const output=await new Promise<string>(r=>{const client=createConnection(sock);let result='';client.on('data',c=>result+=c.toString());client.on('error',()=>r(result));client.on('close',()=>r(result));});
   expect(output).toBe('');expect(authorized).toBe(0);
  }finally{await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});}
 });
});
