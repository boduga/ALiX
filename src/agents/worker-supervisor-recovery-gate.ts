/** GE-04 R1-B1: fail-closed startup admission gate for unresolved durable ownership.
 * Prototype only: no durable pre-spawn intent or process-tree containment.
 */
import type {WorkerSupervisor,SupervisedWorkerRequest} from './worker-supervisor.js';
import type {WorkerGrantIdentity} from './worker-grant-binding.js';
import type {RecoveryRecord} from './worker-supervisor-recovery-ledger.js';

export type RecoveryRecordReader=Readonly<{unresolved:()=>RecoveryRecord[];unresolvedIntents:()=>unknown[]}>;

/**
 * Refuse all launches until the recovery ledger has been read and is empty.
 * No automatic clearing based on missing procfs entries: PID absence does not
 * prove containment of escaped descendants. An operator must independently
 * qualify and clear unresolved records using the exact registration ID.
 */
export function createRecoveryGatedWorkerSupervisor(
  supervisor:WorkerSupervisor,ledger:RecoveryRecordReader,
):WorkerSupervisor {
  if(!supervisor||typeof supervisor.launch!=='function'||
     typeof supervisor.revoke!=='function'||typeof supervisor.reconcile!=='function'||
     !ledger||typeof ledger.unresolved!=='function'||typeof ledger.unresolvedIntents!=='function')
    throw new Error('GE-04 recovery gate requires supervisor and durable ledger');
  let ready=false;
  let checking:Promise<void>|undefined;
  const check=async():Promise<void>=>{
    ready=false;
    const unresolved=ledger.unresolved();
    const intents=ledger.unresolvedIntents();
    if(!Array.isArray(unresolved)||unresolved.length||!Array.isArray(intents)||intents.length)
      throw new Error('GE-04 SECURITY HOLD: unresolved durable worker registrations');
    await supervisor.reconcile();
    // A concurrent writer could have registered a worker during reconciliation.
    const after=ledger.unresolved();
    const afterIntents=ledger.unresolvedIntents();
    if(!Array.isArray(after)||after.length||!Array.isArray(afterIntents)||afterIntents.length)
      throw new Error('GE-04 SECURITY HOLD: durable registrations changed during reconciliation');
    ready=true;
  };
  return Object.freeze({
    async launch(request:SupervisedWorkerRequest){
      if(!ready||checking)throw new Error('GE-04 SECURITY HOLD: startup recovery not qualified');
      // Recheck durable records on each launch. This is not atomic with spawn,
      // and must not be used as a production ownership transaction.
      const unresolved=ledger.unresolved();
      const intents=ledger.unresolvedIntents();
    if(!Array.isArray(unresolved)||unresolved.length||!Array.isArray(intents)||intents.length){ready=false;
        throw new Error('GE-04 SECURITY HOLD: unresolved durable worker registrations');}
      return supervisor.launch(request);
    },
    revoke:(identity:WorkerGrantIdentity)=>supervisor.revoke(identity),
    async reconcile(){
      if(checking)return checking;
      const operation=Promise.resolve().then(check);
      checking=operation;
      try{await operation;}finally{if(checking===operation)checking=undefined;}
    },
  });
}
