/** GE-04 Q3.3: pure planning only. NOT wired into production credential delivery. */
import type { ModelConfig } from '../operations/config/schema.js';
import { buildFallbackChain } from '../models/providers/routing-adapter.js';

export type CredentialGrantPlan = Readonly<{ providers: readonly string[] }>;

function checkedProvider(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error('Invalid credential-grant provider identity');
  }
  return value;
}

/** Compute the exact provider set for a concrete, authorized routing chain.
 * Does not read, resolve, serialize or grant access to any credential.
 * Rejects unresolved primary models rather than guessing routing authority.
 */
export function planWorkerCredentialGrant(model: ModelConfig): CredentialGrantPlan {
  if (!model || typeof model.name !== 'string' || !model.name.trim() || model.selection !== undefined) {
    throw new Error('Credential-grant planning requires a concrete resolved model');
  }
  const providers = new Set<string>([checkedProvider(model.provider)]);
  for (const fallback of buildFallbackChain(model)) {
    if (typeof fallback.name !== 'string' || !fallback.name.trim()) {
      throw new Error('Invalid credential-grant fallback model');
    }
    providers.add(checkedProvider(fallback.provider));
  }
  return Object.freeze({ providers: Object.freeze([...providers]) });
}
