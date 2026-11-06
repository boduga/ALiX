/** GE-04 Q3.12: synthetic single-transaction claim/route model. NOT durable storage. */
import type { ModelConfig } from '../operations/config/schema.js';
import type { ClaimedWorkerRecord } from './worker-grant-record-check.js';
import type { WorkerGrantIdentity } from './worker-grant-binding.js';
import {createSyntheticRouteSnapshot,assertSyntheticRouteSnapshot,type SyntheticRouteSnapshot} from './worker-route-snapshot.js';

export type SyntheticClaimState = Readonly<{
  record:ClaimedWorkerRecord;
  snapshot:SyntheticRouteSnapshot|null;
}>;
/** Returns an entirely new state only after route qualification succeeds.
 * A rejected or throwing claim leaves the original state unchanged.
 */
export function simulateAtomicRouteClaim(state:SyntheticClaimState,expectedAttempt:number,ownerId:string,model:ModelConfig,routeRevision:number,expectedPlanRevision:number):SyntheticClaimState {
  const r=state.record;
  if (r.status!=='pending' || r.attempt!==expectedAttempt || state.snapshot!==null ||
      !Number.isSafeInteger(expectedAttempt) || expectedAttempt<0 ||
      !Number.isSafeInteger(expectedPlanRevision) || r.planRevision!==expectedPlanRevision ||
      typeof ownerId!=='string' || !ownerId.trim()) throw new Error('Synthetic claim CAS rejected');
  const record=Object.freeze({...r,status:'running',attempt:expectedAttempt+1,executionOwnerId:ownerId});
  const identity:WorkerGrantIdentity={coordinationRunId:r.runId,workerId:r.workerId,attempt:record.attempt};
  const snapshot=createSyntheticRouteSnapshot(record,identity,ownerId,expectedPlanRevision,model,routeRevision);
  return Object.freeze({record,snapshot});
}
/** A replayed state is acceptable only if its claim and snapshot remain consistent. */
export function assertSyntheticClaimReplay(state:SyntheticClaimState,model:ModelConfig,routeRevision:number):void {
  const {record,snapshot}=state;
  if (!snapshot || record.status!=='running' || !record.executionOwnerId) throw new Error('Missing committed route claim');
  const identity:WorkerGrantIdentity={coordinationRunId:record.runId,workerId:record.workerId,attempt:record.attempt};
  assertSyntheticRouteSnapshot(snapshot,record,identity,record.executionOwnerId,record.planRevision,model,routeRevision);
}
