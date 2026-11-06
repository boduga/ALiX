/** GE-04 Q3.11: pure snapshot lifecycle simulation. No durable storage or production wiring. */
import type { ModelConfig } from '../operations/config/schema.js';
import type { WorkerGrantIdentity } from './worker-grant-binding.js';
import { captureSyntheticRouteEvidence, assertSyntheticRouteEvidence, type WorkerRouteEvidence } from './worker-route-authority.js';
import type { ClaimedWorkerRecord } from './worker-grant-record-check.js';

export type SyntheticRouteSnapshot = Readonly<{
  schemaVersion:1;
  routeRevision:number;
  evidence:WorkerRouteEvidence;
  revoked:boolean;
}>;

/** The caller must supply a trusted post-claim record and resolved scheduler route.
 * The revision is local evidence, not an atomic CAS or proof of persistence.
 */
export function createSyntheticRouteSnapshot(record:ClaimedWorkerRecord,identity:WorkerGrantIdentity,ownerId:string,planRevision:number,model:ModelConfig,routeRevision:number):SyntheticRouteSnapshot {
  if (!Number.isSafeInteger(routeRevision) || routeRevision < 1) throw new Error('Invalid route revision');
  return Object.freeze({schemaVersion:1,routeRevision,evidence:captureSyntheticRouteEvidence(record,identity,ownerId,planRevision,model),revoked:false});
}

/** Reject use if the snapshot is revoked, stale or its route has changed. */
export function assertSyntheticRouteSnapshot(snapshot:SyntheticRouteSnapshot,record:ClaimedWorkerRecord,identity:WorkerGrantIdentity,ownerId:string,planRevision:number,model:ModelConfig,routeRevision:number):void {
  if (!snapshot || snapshot.schemaVersion!==1 || snapshot.revoked!==false ||
      !Number.isSafeInteger(routeRevision) || snapshot.routeRevision!==routeRevision) {
    throw new Error('Worker route snapshot unavailable or stale');
  }
  assertSyntheticRouteEvidence(snapshot.evidence,record,identity,ownerId,planRevision,model);
}

/** Synthetic invalidation only. Production must revoke under the same trusted persistence boundary. */
export function revokeSyntheticRouteSnapshot(snapshot:SyntheticRouteSnapshot):SyntheticRouteSnapshot {
  if (!snapshot || snapshot.schemaVersion!==1) throw new Error('Invalid route snapshot');
  return Object.freeze({...snapshot,revoked:true});
}
