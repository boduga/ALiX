/** GE-04 Q3.4: pure, test-only metadata projection; not an isolation boundary. */
import type { ModelConfig } from '../operations/config/schema.js';
import type { CredentialGrantPlan } from './credential-grant-planner.js';

export type WorkerConfigView = Readonly<{
  model: Readonly<{ provider: string; name: string }>;
  allowedProviders: readonly string[];
}>;

/** Accept only a concrete primary model and an independently computed grant. */
export function projectWorkerConfigView(model: ModelConfig, grant: CredentialGrantPlan): WorkerConfigView {
  if (!model || typeof model.name !== 'string' || !model.name.trim() ||
      typeof model.provider !== 'string' || !/^[a-z][a-z0-9-]*$/.test(model.provider) ||
      model.selection !== undefined || !grant || !Array.isArray(grant.providers) ||
      grant.providers.length === 0 || grant.providers[0] !== model.provider ||
      new Set(grant.providers).size !== grant.providers.length ||
      grant.providers.some(p => typeof p !== 'string' || !/^[a-z][a-z0-9-]*$/.test(p))) {
    throw new Error('Invalid worker configuration projection');
  }
  return Object.freeze({
    model: Object.freeze({ provider: model.provider, name: model.name }),
    allowedProviders: Object.freeze([...grant.providers]),
  });
}
