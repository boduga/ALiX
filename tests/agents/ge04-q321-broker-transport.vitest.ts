import {describe,it,expect} from 'vitest';
import {createConnection} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBrokerProbeServer} from '../../src/agents/worker-broker-transport.js';
const policy={brokerUid:1000,allowedWorkerUids:[1001]};
async function scenario(attestPeer:any){
 const dir=mkdtempSync(join(tmpdir(),'ge04-q321-ipc-'));const socketPath=join(dir,'probe.sock');let accepted=0;
 const server=createBrokerProbeServer({socketPath,peerPolicy:policy,attestPeer,onAuthorizedPeer:async()=>{accepted++;}});
 try {
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});
  const result=await new Promise<string>(resolve=>{const client=createConnection(socketPath);let data='';client.on('data',c=>data+=c.toString());client.on('error',()=>resolve(data));client.on('close',()=>resolve(data));});
  return {result,accepted};
 } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});}
}
describe('GE-04 Q3.21 credential-free broker transport seam',()=>{
 it('requires a configured attestor',()=>expect(()=>createBrokerProbeServer({socketPath:'/tmp/probe.sock',peerPolicy:policy} as any)).toThrow());
 it('rejects when attestation fails',async()=>expect(await scenario(async()=>{throw new Error('no OS credentials');})).toEqual({result:'',accepted:0}));
 it('rejects same-UID and unknown-UID peers',async()=>{for(const uid of [1000,1002])expect(await scenario(async()=>({uid,pid:42,transport:'unix-peer-credentials'}))).toEqual({result:'',accepted:0});});
 it('accepts only attested allowed UID; never reads request identity',async()=>expect(await scenario(async()=>({uid:1001,pid:42,transport:'unix-peer-credentials'}))).toEqual({result:'OK\n',accepted:1}));
});
