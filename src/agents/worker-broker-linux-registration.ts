/** GE-04 Q3.31: broker-owned process registration from independently read procfs.
 * This does not authenticate the worker socket or grant credential access.
 */
import {BrokerLivePeerBindings,type ReadLiveProcessIdentity} from './worker-broker-live-peer-binding.js';
import {readLinuxProcessIdentity} from './worker-broker-linux-process.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';

/** Registration is supervisor-only. Never accept a PID or worker identity from
 * an IPC request as authorization evidence. */
export function createLinuxBrokerProcessRegistry(reader:ReadLiveProcessIdentity=readLinuxProcessIdentity) {
  if(process.platform!=='linux')throw new Error('Linux broker registry requires Linux');
  const bindings=new BrokerLivePeerBindings(reader);
  return Object.freeze({
    /** Must be called from the trusted supervisor's spawn/lifecycle path. */
    async registerSpawnedWorker(pid:number,uid:number,worker:WorkerGrantIdentity):Promise<void>{
      if(!Number.isSafeInteger(pid)||pid<1||!Number.isSafeInteger(uid)||uid<0||uid>0xffffffff)
        throw new Error('Invalid supervised process identity');
      const observed=await reader(pid);
      if(!observed||observed.pid!==pid||observed.uid!==uid)
        throw new Error('Supervised worker process missing or UID mismatch');
      bindings.register({process:observed,worker});
    },
    revokeSpawnedWorker(pid:number):void{bindings.revoke(pid);},
    /** Resolver accepts only kernel-attested peer identity from trusted caller. */
    resolveAttestedPeer:bindings.resolve.bind(bindings),
  });
}
