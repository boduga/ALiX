/** GE-04 R2A qualification-only serialized admission coordinator.
 * No production enablement: trusted kernel containment and recovery remain unqualified.
 * The same coordinator must exclusively own all writers to its durable ledger.
 */
import type {WorkerSupervisor,SupervisedWorkerRequest} from './worker-supervisor.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';
import type {RecoveryRecordReader,} from './worker-supervisor-recovery-gate.js';
import type {DurableLaunchStore} from './worker-supervisor-durable-launch.js';
import {createDurableLaunchWorkerSupervisor} from './worker-supervisor-durable-launch.js';

export function createSerializedAdmissionCoordinator(
  native:WorkerSupervisor,
  ledger:RecoveryRecordReader & DurableLaunchStore,
):WorkerSupervisor {
  if(!native || !ledger || typeof native.launch!=='function' ||
    typeof native.reconcile!=='function' || typeof native.revoke!=='function' ||
    typeof ledger.unresolved!=='function' || typeof ledger.unresolvedIntents!=='function' ||
    typeof ledger.beginLaunch!=='function' || typeof ledger.promoteLaunch!=='function')
    throw new Error('WorkerSupervisor admission requires trusted supervisor and durable ledger');
  const durable=createDurableLaunchWorkerSupervisor(native,ledger);
  let tail:Promise<void>=Promise.resolve();
  let ready=false;
  // Serialize all calls in this process. Cross-process exclusivity is NOT established.
  function serial<T>(fn:()=>Promise<T>):Promise<T> {
    const operation=tail.then(fn);
    tail=operation.then(()=>{},()=>{});
    return operation;
  }
  function clean():boolean {
    const records=ledger.unresolved(),intents=ledger.unresolvedIntents();
    return Array.isArray(records)&&records.length===0&&
      Array.isArray(intents)&&intents.length===0;
  }
  return Object.freeze({
    reconcile:()=>serial(async()=>{
      ready=false;
      if(!clean())throw new Error('WorkerSupervisor SECURITY HOLD: unresolved durable ownership');
      await native.reconcile();
      if(!clean())throw new Error('WorkerSupervisor SECURITY HOLD: ownership changed during reconciliation');
      ready=true;
    }),
    launch:(request:SupervisedWorkerRequest)=>serial(async()=>{
      if(!ready||!clean()){
        ready=false;
        throw new Error('WorkerSupervisor SECURITY HOLD: admission not reconciled');
      }
      // Reserve the only admitted launch slot before writing the durable intent.
      // No other admission is permitted until independent recovery reconciliation.
      ready=false;
      return durable.launch(request);
    }),
    revoke:(identity:WorkerGrantIdentity)=>serial(async()=>{
      ready=false;
      await native.revoke(identity);
      // A successful revoke is not proof of descendant containment.
    }),
  });
}
