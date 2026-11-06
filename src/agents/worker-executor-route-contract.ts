/** GE-04 Q3.17: opt-in, non-secret route contract qualification. Not an authenticated token. */
import type { ModelConfig, ModelTier } from '../operations/config/schema.js';
import type { ModelSourceConfig } from '../operations/config/model-resolver.js';
import type { CoordinationStore } from '../coordination/kernel/coordination-store.js';
import { resolveSyntheticTrustedWorkerRoute } from './worker-trusted-route-resolution.js';
import { assertExecutorRouteParity } from './worker-executor-route-parity.js';
import { buildFallbackChain } from '../models/providers/routing-adapter.js';
import type { WorkerGrantIdentity } from './worker-grant-binding.js';

export type QualifiedExecutorRouteContract = Readonly<{
  schemaVersion: 1;
  identity: WorkerGrantIdentity;
  ownerId: string;
  planRevision: number;
  routeRevision: number;
  primary: Readonly<{provider:string;name:string}>;
  fallbacks: readonly Readonly<{provider:string;name:string}>[];
}>;

/** Read the authoritative run again. Never use the caller's cached worker snapshot. */
export async function qualifyDurableExecutorRouteContract(args: {
  store: CoordinationStore;
  identity: WorkerGrantIdentity;
  ownerId: string;
  schedulerConfig: ModelSourceConfig;
  schedulerTier: ModelTier;
  executorRoute: ModelConfig;
}): Promise<QualifiedExecutorRouteContract> {
  const {identity,ownerId}=args;
  const run=await args.store.load(identity.coordinationRunId);
  const worker=run?.workers.find(w=>w.id===identity.workerId);
  if (!run || !worker || !worker.trustedRouteSnapshot || worker.status!=='running' ||
      worker.attempt!==identity.attempt || worker.executionOwnerId!==ownerId) {
    throw new Error('Durable worker claim or route snapshot unavailable');
  }
  const authorized=resolveSyntheticTrustedWorkerRoute(args.schedulerConfig,args.schedulerTier);
  const snapshot=worker.trustedRouteSnapshot;
  assertExecutorRouteParity({
    snapshot,record:{runId:run.id,workerId:worker.id,attempt:worker.attempt,
      status:worker.status,executionOwnerId:worker.executionOwnerId,planRevision:run.planRevision},
    identity,ownerId,planRevision:run.planRevision,routeRevision:snapshot.routeRevision,
    schedulerConfig:args.schedulerConfig,schedulerTier:args.schedulerTier,executorRoute:args.executorRoute,
  });
  const candidates=[authorized,...buildFallbackChain(authorized)];
  return Object.freeze({schemaVersion:1,identity:Object.freeze({...identity}),ownerId,
    planRevision:run.planRevision,routeRevision:snapshot.routeRevision,
    primary:Object.freeze({provider:candidates[0]!.provider,name:candidates[0]!.name}),
    fallbacks:Object.freeze(candidates.slice(1).map(c=>Object.freeze({provider:c.provider,name:c.name})))});
}

/** Validate a contract against an independently supplied, actual provider route.
 * A worker-supplied contract is not an authorization; broker must re-read store.
 */
export function assertExecutorRouteContractMatches(contract:QualifiedExecutorRouteContract, actual:ModelConfig):void {
  if (!contract || contract.schemaVersion!==1 || !contract.primary || !Array.isArray(contract.fallbacks))
    throw new Error('Invalid executor route contract');
  if (actual.selection!==undefined) throw new Error('Unresolved executor selection');
  const candidates=[actual,...buildFallbackChain(actual)].map(c=>({provider:c.provider,name:c.name}));
  if (JSON.stringify(candidates)!==JSON.stringify([contract.primary,...contract.fallbacks]))
    throw new Error('Executor route contract mismatch');
}
