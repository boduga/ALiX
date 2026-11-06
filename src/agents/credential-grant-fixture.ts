/** GE-04 Q3.3: test-only synthetic sender projection. NOT used by production. */
import type { CredentialGrantPlan } from './credential-grant-planner.js';

const validProvider = (name: unknown): name is string =>
  typeof name === 'string' && /^[a-z][a-z0-9-]*$/.test(name);

/** Build a synthetic FD3 snapshot; reject malformed/expanded grants rather than copying all keys. */
export function projectSyntheticCredentialSnapshot(
  grant: CredentialGrantPlan,
  syntheticKeys: Readonly<Record<string, string>>,
  authorizedProviders: readonly string[],
): string {
  if (!grant || !Array.isArray(grant.providers) || !Array.isArray(authorizedProviders)) {
    throw new Error('Invalid synthetic credential grant');
  }
  const expected = new Set(authorizedProviders);
  const actual = new Set(grant.providers);
  if (expected.size !== authorizedProviders.length || actual.size !== grant.providers.length ||
      [...expected, ...actual].some(name => !validProvider(name)) ||
      expected.size !== actual.size || [...actual].some(name => !expected.has(name))) {
    throw new Error('Synthetic credential grant does not match authorized providers');
  }
  const output: Record<string,string> = Object.create(null);
  for (const provider of grant.providers) {
    if (!Object.hasOwn(syntheticKeys, provider)) continue;
    const key = syntheticKeys[provider];
    if (typeof key !== 'string') throw new Error('Invalid synthetic credential value');
    output[provider] = key;
  }
  return JSON.stringify(output);
}
