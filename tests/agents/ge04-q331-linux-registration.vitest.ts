import {describe,it,expect} from 'vitest';
import {createLinuxBrokerProcessRegistry} from '../../src/agents/worker-broker-linux-registration.js';
import type {BrokerProcessIdentity} from '../../src/agents/worker-broker-live-peer-binding.js';
const processIdentity={pid:42,uid:10002,startTimeTicks:'100000'};
const worker={coordinationRunId:'run',workerId:'worker',attempt:2};
const peer={pid:42,uid:10002,transport:'unix-peer-credentials' as const};
describe.skipIf(process.platform!=='linux')('GE-04 Q3.31 broker-owned registration lifecycle',()=>{
 it('registers only a live observed matching UID and resolves matching peer',async()=>{
  const registry=createLinuxBrokerProcessRegistry(async()=>processIdentity);
  await registry.registerSpawnedWorker(42,10002,worker);
  await expect(registry.resolveAttestedPeer(peer)).resolves.toEqual(worker);
  await expect(registry.resolveAttestedPeer({...peer,uid:10003})).rejects.toThrow();
 });
 it('rejects spoofed UID and missing process before registration',async()=>{
  const registry=createLinuxBrokerProcessRegistry(async()=>processIdentity);
  await expect(registry.registerSpawnedWorker(42,10003,worker)).rejects.toThrow(/UID mismatch/);
  await expect(registry.registerSpawnedWorker(43,10002,worker)).rejects.toThrow(/missing/);
  const missing=createLinuxBrokerProcessRegistry(async()=>undefined);
  await expect(missing.registerSpawnedWorker(42,10002,worker)).rejects.toThrow(/missing/);
 });
 it('rejects PID reuse and revocation after registration',async()=>{
  let current:BrokerProcessIdentity|undefined=processIdentity;
  const registry=createLinuxBrokerProcessRegistry(async()=>current);
  await registry.registerSpawnedWorker(42,10002,worker);
  current={...processIdentity,startTimeTicks:'100001'};
  await expect(registry.resolveAttestedPeer(peer)).rejects.toThrow(/changed/);
  current=processIdentity;
  registry.revokeSpawnedWorker(42);
  await expect(registry.resolveAttestedPeer(peer)).rejects.toThrow(/No matching/);
 });
 it('rejects duplicate registrations and invalid worker attempts',async()=>{
  const registry=createLinuxBrokerProcessRegistry(async()=>processIdentity);
  await registry.registerSpawnedWorker(42,10002,worker);
  await expect(registry.registerSpawnedWorker(42,10002,worker)).rejects.toThrow(/already registered/);
  const second=createLinuxBrokerProcessRegistry(async()=>processIdentity);
  await expect(second.registerSpawnedWorker(42,10002,{...worker,attempt:0})).rejects.toThrow(/Invalid broker-owned/);
 });
});
