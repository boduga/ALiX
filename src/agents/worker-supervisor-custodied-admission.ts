/** GE-04 R2B qualification-only custody-bound admission composition.
 * Claim is sticky across crashes. There is intentionally no release, takeover,
 * worker credential admission, or production registration in this module.
 */
import type {WorkerSupervisor} from './worker-supervisor.js';
import type {RecoveryRecordReader} from './worker-supervisor-recovery-gate.js';
import type {DurableLaunchStore} from './worker-supervisor-durable-launch.js';
import {claimAdmissionCustody} from './worker-supervisor-admission-custody.js';
import {createSerializedAdmissionCoordinator} from './worker-supervisor-admission-coordinator.js';

/** Claim custody before constructing the coordinator; never attempt recovery
 * by trusting an old PID or automatically deleting a previous claim.
 * The caller must independently provision a protected parent directory and
 * exclusive ledger access. This is NOT a privileged security boundary.
 */
export function createCustodiedAdmissionCoordinator(
 custodyPath:string,
 ownerId:string,
 native:WorkerSupervisor,
 ledger:RecoveryRecordReader & DurableLaunchStore,
):WorkerSupervisor {
 if(!native || typeof native.launch!=='function' ||
    typeof native.revoke!=='function' || typeof native.reconcile!=='function' ||
    !ledger || typeof ledger.unresolved!=='function' ||
    typeof ledger.unresolvedIntents!=='function' ||
    typeof ledger.beginLaunch!=='function' ||
    typeof ledger.promoteLaunch!=='function')
   throw new Error('WorkerSupervisor SECURITY HOLD: invalid custody-bound admission dependencies');
 claimAdmissionCustody(custodyPath,ownerId);
 return createSerializedAdmissionCoordinator(native,ledger);
}
