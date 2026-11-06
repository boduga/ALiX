/** GE-04 Q3.15: scheduler-side route qualification seam; not a credential authority. */
import type { ModelTier, ModelConfig } from '../../operations/config/schema.js';
import type { ModelSourceConfig } from '../../operations/config/model-resolver.js';
import { resolveSyntheticTrustedWorkerRoute, assertSyntheticWorkerRouteMatches } from '../../agents/worker-trusted-route-resolution.js';
import type { CoordinationRun, WorkerAssignment } from './coordination-types.js';
import type { CoordinationStore, WorkerPatch } from './coordination-store.js';

/**
 * Requires scheduler-provided canonical config, not worker CLI flags or worker config.
 * An executor's actual route MUST be checked separately before credentials are enabled.
 */
export async function qualifyAndClaimSchedulerWorkerRoute(args: {
  store: CoordinationStore;
  run: Pick<CoordinationRun,'id'|'planRevision'>;
  worker: Pick<WorkerAssignment,'id'|'attempt'>;
  config: ModelSourceConfig;
  tier: ModelTier;
  patch: WorkerPatch;
  routeRevision: number;
  proposedWorkerRoute?: ModelConfig;
}): Promise<boolean> {
  if (!args.patch.executionOwnerId) throw new Error('Scheduler owner required');
  const authorized = resolveSyntheticTrustedWorkerRoute(args.config,args.tier);
  if (args.proposedWorkerRoute) assertSyntheticWorkerRouteMatches(authorized,args.proposedWorkerRoute);
  return args.store.claimPendingWorkerWithRoute(args.run.id,args.worker.id,args.worker.attempt,args.patch,{
    model:authorized,expectedPlanRevision:args.run.planRevision,routeRevision:args.routeRevision,
  });
}
