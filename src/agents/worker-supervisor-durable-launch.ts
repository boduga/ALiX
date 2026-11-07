/** GE-04 R1-B1 qualification-only durable launch protocol.
 * An unresolved intent deliberately survives any uncertain launch outcome.
 * Not a production containment or crash recovery implementation.
 */
import {randomUUID} from 'node:crypto';
import type {WorkerSupervisor,SupervisedWorkerRequest} from './worker-supervisor.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';
import type {LaunchIntent,RecoveryRecord} from './worker-supervisor-recovery-ledger.js';

export type DurableLaunchStore=Readonly<{
 beginLaunch:(intent:LaunchIntent)=>void;
 promoteLaunch:(record:RecoveryRecord)=>void;
}>;

/** Write-ahead intent precedes any delegated native spawn. Promotion follows
 * supervisor process qualification. If anything fails, never erase the intent
 * automatically: a child may have escaped or the outcome may be unknown.
 */
export function createDurableLaunchWorkerSupervisor(
 supervisor:WorkerSupervisor,store:DurableLaunchStore,
):WorkerSupervisor {
 if(!supervisor||typeof supervisor.launch!=='function'||
  typeof supervisor.revoke!=='function'||typeof supervisor.reconcile!=='function'||
  !store||typeof store.beginLaunch!=='function'||typeof store.promoteLaunch!=='function')
  throw new Error('WorkerSupervisor durable launch requires trusted supervisor and ledger');
 return Object.freeze({
  async launch(request:SupervisedWorkerRequest){
   const registrationId=randomUUID();
   // A failure to persist the intent MUST prevent the native launch.
   store.beginLaunch({worker:request.identity,registrationId,state:'launching'});
   const handle=await supervisor.launch(request);
   try{
    if(handle.evidence.identity.coordinationRunId!==request.identity.coordinationRunId||
       handle.evidence.identity.workerId!==request.identity.workerId||
       handle.evidence.identity.attempt!==request.identity.attempt)
      throw new Error('WorkerSupervisor supervisor returned mismatched worker identity');
    store.promoteLaunch({worker:request.identity,registrationId,
     process:{pid:handle.evidence.pid,uid:handle.evidence.uid,
      startTimeTicks:handle.evidence.startTimeTicks}});
    return handle;
   }catch(error){
    // Even if termination succeeds, retain the intent: current process-group
    // termination cannot prove that hostile descendants are contained.
    try{await handle.cancel('WorkerSupervisor durable registration failed');}
    catch{/* SECURITY HOLD: termination outcome uncertain. */}
    throw error;
   }
  },
  revoke:(identity:WorkerGrantIdentity)=>supervisor.revoke(identity),
  reconcile:()=>supervisor.reconcile(),
 });
}
