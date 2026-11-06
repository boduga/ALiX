/** GE-04 Q3.19: early ledger consistency gate; NOT authenticated credential authorization. */
import type { CoordinationStore } from '../coordination/kernel/coordination-store.js';
import type { WorkerGrantIdentity } from './worker-grant-binding.js';
import { assertSyntheticRouteSnapshot } from './worker-route-snapshot.js';
import type { ModelConfig } from '../operations/config/schema.js';

/** Reject invalid/stale worker claims before credential FD consumption or config loading.
 * Route reconstruction only validates persisted evidence consistency; it does not
 * establish provenance, grant access, or replace the later canonical route check.
 */
export async function assertPrecredentialWorkerRouteClaim(args:{store:Pick<CoordinationStore, "load">;identity:WorkerGrantIdentity;ownerId:string}):Promise<void>{
  const {identity,ownerId}=args;
  if (!identity.coordinationRunId || !identity.workerId || !Number.isSafeInteger(identity.attempt) || identity.attempt<1 || !ownerId)
    throw new Error('Invalid precredential worker identity');
  const run=await args.store.load(identity.coordinationRunId);
  const worker=run?.workers.find(w=>w.id===identity.workerId);
  if (!run || !worker || worker.status!=='running' || worker.attempt!==identity.attempt ||
      worker.executionOwnerId!==ownerId || !worker.trustedRouteSnapshot)
    throw new Error('Precredential worker claim unavailable or stale');
  const snapshot=worker.trustedRouteSnapshot;
  const candidates=snapshot.evidence?.candidates;
  if (!Array.isArray(candidates) || candidates.length<1) throw new Error('Precredential route evidence unavailable');
  const model:ModelConfig={provider:candidates[0]!.provider,name:candidates[0]!.name,
    ...(candidates.length>1?{routing:{fallbacks:candidates.slice(1).map(c=>({provider:c.provider,name:c.name}))}}:{})};
  assertSyntheticRouteSnapshot(snapshot,{runId:run.id,workerId:worker.id,attempt:worker.attempt,
    status:worker.status,executionOwnerId:worker.executionOwnerId,planRevision:run.planRevision},
    identity,ownerId,run.planRevision,model,snapshot.routeRevision);
}
