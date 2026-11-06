import {describe,it,expect} from 'vitest';
import {BrokerLivePeerBindings,type BrokerProcessIdentity} from '../../src/agents/worker-broker-live-peer-binding.js';
const processIdentity={pid:42,uid:10002,startTimeTicks:'12345678901234567890'};
const worker={coordinationRunId:'run-a',workerId:'worker-a',attempt:2};
const peer={pid:42,uid:10002,transport:'unix-peer-credentials' as const};
describe('GE-04 Q3.31 broker-owned live process binding',()=>{
 it('resolves only matching registered process and worker attempt',async()=>{
  const bindings=new BrokerLivePeerBindings(async()=>processIdentity);
  bindings.register({process:processIdentity,worker});
  await expect(bindings.resolve(peer)).resolves.toEqual(worker);
  await expect(bindings.resolve({...peer,uid:10003})).rejects.toThrow();
  await expect(bindings.resolve({...peer,pid:43})).rejects.toThrow();
 });
 it('rejects PID reuse even with identical UID',async()=>{
  let current:BrokerProcessIdentity|undefined=processIdentity;
  const bindings=new BrokerLivePeerBindings(async()=>current);
  bindings.register({process:processIdentity,worker});
  current={...processIdentity,startTimeTicks:'12345678901234567891'};
  await expect(bindings.resolve(peer)).rejects.toThrow(/changed/);
  current=undefined;
  await expect(bindings.resolve(peer)).rejects.toThrow(/exited/);
 });
 it('fails closed when registration is revoked during asynchronous lookup',async()=>{
  let finish!:(value:BrokerProcessIdentity)=>void;
  const bindings=new BrokerLivePeerBindings(()=>new Promise(resolve=>{finish=resolve;}));
  bindings.register({process:processIdentity,worker});
  const pending=bindings.resolve(peer);
  bindings.revoke(42);
  finish(processIdentity);
  await expect(pending).rejects.toThrow(/revoked/);
 });
 it('rejects duplicate PID and malformed identities',async()=>{
  const bindings=new BrokerLivePeerBindings(async()=>processIdentity);
  bindings.register({process:processIdentity,worker});
  expect(()=>bindings.register({process:processIdentity,worker})).toThrow(/already registered/);
  expect(()=>bindings.register({process:{...processIdentity,startTimeTicks:'01'},worker})).toThrow();
  expect(()=>bindings.register({process:{...processIdentity,pid:43},worker:{...worker,attempt:0}})).toThrow();
 });
});
