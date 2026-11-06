/** GE-04 Q3.10: pure canonical-tier route qualification, NOT production authority. */
import type { ModelConfig, ModelTier } from '../operations/config/schema.js';
import { createModelResolver, type ModelSourceConfig } from '../operations/config/model-resolver.js';
import { planWorkerCredentialGrant } from './credential-grant-planner.js';

/** Reads canonical models.* only. Caller must be trusted; this is not an authenticated decision. */
export function resolveSyntheticTrustedWorkerRoute(config: ModelSourceConfig, tier: ModelTier): ModelConfig {
  const model=createModelResolver(config).require(tier);
  // A selection policy needs a trusted asynchronous discovery decision before grant issuance.
  // Never silently treat a configured placeholder name as resolved authority.
  if (model.selection !== undefined) throw new Error('Trusted worker route requires resolved model selection');
  planWorkerCredentialGrant(model);
  return structuredClone(model);
}

/** Verify that a worker-proposed route matches the trusted primary and ordered fallback list.
 * This intentionally does not trust the proposed model as an authority source.
 */
export function assertSyntheticWorkerRouteMatches(authorized:ModelConfig, proposed:ModelConfig):void {
  const a=resolveRouteCandidates(authorized);
  const b=resolveRouteCandidates(proposed);
  if (JSON.stringify(a)!==JSON.stringify(b)) throw new Error('Worker route differs from trusted canonical route');
}
function resolveRouteCandidates(model:ModelConfig):readonly (readonly [string,string])[] {
  planWorkerCredentialGrant(model);
  const fallback=model.routing?.fallbacks ?? [];
  const routes:[[string,string],...[string,string][]]=[[model.provider,model.name]];
  if (model.routing?.freeFallback && model.provider==='openrouter') routes.push(['openrouter','openrouter/free']);
  for (const item of fallback) {
    if (!item || typeof item.name!=='string' || !item.name.trim() || typeof item.provider!=='string') throw new Error('Invalid fallback route');
    routes.push([item.provider,item.name]);
  }
  return routes;
}
