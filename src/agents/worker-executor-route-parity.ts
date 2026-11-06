/** GE-04 Q3.16: pre-dispatch parity qualification, NOT live credential enforcement. */
import type { ModelConfig, ModelTier } from '../operations/config/schema.js';
import type { ModelSourceConfig } from '../operations/config/model-resolver.js';
import { createModelResolver } from '../operations/config/model-resolver.js';
import { buildFallbackChain } from '../models/providers/routing-adapter.js';
import { resolveSyntheticTrustedWorkerRoute, assertSyntheticWorkerRouteMatches } from './worker-trusted-route-resolution.js';
import type { SyntheticRouteSnapshot } from './worker-route-snapshot.js';
import { assertSyntheticRouteSnapshot } from './worker-route-snapshot.js';
import type { ClaimedWorkerRecord } from './worker-grant-record-check.js';
import type { WorkerGrantIdentity } from './worker-grant-binding.js';

/** Reconstruct what the current child CLI can actually pass to createProvider.
 * It uses --provider/--model overrides, then finds a matching models.* entry
 * for timeouts, but does not forward routing.fallbacks or routing.freeFallback.
 */
export function describeCurrentChildCliRoute(config:ModelSourceConfig,tier:ModelTier,overrides:{provider?:string;name?:string}):ModelConfig {
  const base=createModelResolver(config).require(tier);
  const provider=overrides.provider ?? base.provider;
  const name=overrides.name ?? base.name;
  const selection=overrides.name ? undefined : base.selection;
  const match=Object.values(config.models ?? {}).find(entry=>entry?.provider===provider && entry?.name===name);
  return {provider,name,...(selection!==undefined?{selection}:{}),
    ...(match?.timeoutMs!==undefined?{timeoutMs:match.timeoutMs}:{}),
    ...(match?.streamIdleTimeoutMs!==undefined?{streamIdleTimeoutMs:match.streamIdleTimeoutMs}:{})};
}

/** Refuse an execution route that differs in primary or ordered fallbacks.
 * Call this against the actual executor configuration, never worker assertions.
 */
export function assertExecutorRouteParity(args:{
  snapshot:SyntheticRouteSnapshot;
  record:ClaimedWorkerRecord;
  identity:WorkerGrantIdentity;
  ownerId:string;
  planRevision:number;
  routeRevision:number;
  schedulerConfig:ModelSourceConfig;
  schedulerTier:ModelTier;
  executorRoute:ModelConfig;
}):void {
  const authorized=resolveSyntheticTrustedWorkerRoute(args.schedulerConfig,args.schedulerTier);
  assertSyntheticRouteSnapshot(args.snapshot,args.record,args.identity,args.ownerId,args.planRevision,authorized,args.routeRevision);
  assertSyntheticWorkerRouteMatches(authorized,args.executorRoute);
  // Keep routing adapter fallback shape as the source of truth.
  if (buildFallbackChain(authorized).length!==buildFallbackChain(args.executorRoute).length) throw new Error('Executor fallback chain mismatch');
}
