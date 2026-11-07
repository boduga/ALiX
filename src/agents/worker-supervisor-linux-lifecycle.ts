/** GE-04: connect the real spawn lifecycle to broker-owned Linux registration.
 * Qualification only: no authenticated IPC, process suspension, or credentials.
 */
import {createLinuxBrokerProcessRegistry} from './worker-broker-linux-registration.js';
import type {ReadLiveProcessIdentity} from './worker-broker-live-peer-binding.js';

export type SupervisorSpawnIdentity=Readonly<{
  pid:number;uid:number;coordinationRunId:string;workerId:string;attempt:number;
}>;

export function createSupervisorLinuxWorkerLifecycle(reader?:ReadLiveProcessIdentity) {
  const registry=createLinuxBrokerProcessRegistry(reader);
  const generations=new Map<number,number>();
  const pending=new Map<number,Promise<void>>();
  const exited=new Set<number>();
  let nextGeneration=0;
  return Object.freeze({
    async onSpawned(identity:SupervisorSpawnIdentity):Promise<void> {
      const {pid,uid,coordinationRunId,workerId,attempt}=identity;
      if(generations.has(pid) || !Number.isSafeInteger(pid) || pid<1) throw new Error('GE-04 duplicate or invalid worker PID');
      const generation=++nextGeneration;
      generations.set(pid,generation);
      exited.delete(pid);
      const registration=registry.registerSpawnedWorker(pid,uid,{coordinationRunId,workerId,attempt});
      pending.set(pid,registration);
      try {
        await registration;
        if(generations.get(pid)!==generation || exited.has(pid)) {
          registry.revokeSpawnedWorker(pid);
          throw new Error('GE-04 worker exited during registration');
        }
      } catch(error) {
        registry.revokeSpawnedWorker(pid);
        if(generations.get(pid)===generation) generations.delete(pid);
        throw error;
      } finally {
        if(pending.get(pid)===registration) pending.delete(pid);
        if(exited.has(pid) && generations.get(pid)===generation) {
          generations.delete(pid);
          exited.delete(pid);
        }
      }
    },
    onExited(pid:number):void {
      if(pending.has(pid)) exited.add(pid);
      else { generations.delete(pid); exited.delete(pid); }
      registry.revokeSpawnedWorker(pid);
    },
    /** Diagnostic-only resolver. Callers must independently attest the actual socket peer. */
    resolveAttestedPeer:registry.resolveAttestedPeer,
  });
}
