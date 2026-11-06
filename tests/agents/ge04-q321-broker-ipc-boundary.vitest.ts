import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrokerReplayLedger,assertBrokerPeer} from '../../src/agents/worker-broker-ipc-boundary.js';
import type {BrokerAuthorizationTicket} from '../../src/agents/worker-broker-authorization.js';
const policy={brokerUid:1000,allowedWorkerUids:[1001]};
const ticket={nonce:'a'.repeat(48),expiresAt:2000} as BrokerAuthorizationTicket;
describe('GE-04 Q3.21 broker IPC boundary primitives',()=>{
 it('accepts attested distinct worker UID',()=>expect(()=>assertBrokerPeer({uid:1001,pid:123,transport:'unix-peer-credentials'},policy)).not.toThrow());
 it('rejects missing, same UID, unauthorized UID and invalid pid',()=>{for(const peer of [undefined,{uid:1000,pid:1,transport:'unix-peer-credentials'},{uid:1002,pid:1,transport:'unix-peer-credentials'},{uid:1001,pid:0,transport:'unix-peer-credentials'}] as any[])expect(()=>assertBrokerPeer(peer,policy)).toThrow();});
 it('consumes nonce transactionally across connections and restart',()=>{const dir=mkdtempSync(join(tmpdir(),'ge04-q321-'));const path=join(dir,'broker.sqlite');const a=new BrokerReplayLedger(path),b=new BrokerReplayLedger(path);try{a.consumeAuthenticated(ticket,1000);expect(()=>b.consumeAuthenticated(ticket,1000)).toThrow(/consumed/);a.close();const c=new BrokerReplayLedger(path);try{expect(()=>c.consumeAuthenticated(ticket,1000)).toThrow(/consumed/);}finally{c.close();}}finally{b.close();rmSync(dir,{recursive:true,force:true});}});
 it('rejects expired or malformed nonce without inserting',()=>{const dir=mkdtempSync(join(tmpdir(),'ge04-q321-'));const db=new BrokerReplayLedger(join(dir,'broker.sqlite'));try{expect(()=>db.consumeAuthenticated(ticket,2000)).toThrow(/expired/);expect(()=>db.consumeAuthenticated({...ticket,nonce:'bad'},1000)).toThrow();expect(()=>db.consumeAuthenticated(ticket,1000)).not.toThrow();}finally{db.close();rmSync(dir,{recursive:true,force:true});}});
});
