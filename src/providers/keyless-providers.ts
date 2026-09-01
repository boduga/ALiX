/**
 * keyless-providers.ts — Single source of truth for providers that run
 * without an API key (local, self-hosted, or mock backends).
 *
 * Every keyless check in the codebase should read from this module instead
 * of hardcoding a provider id, so a new keyless provider is enabled by
 * adding it to the set below.
 */

export const KEYLESS_PROVIDERS: ReadonlyArray<string> = [
  "ollama",
  "local-llama",
  "mock",
];

export function isKeylessProvider(providerId: string): boolean {
  return KEYLESS_PROVIDERS.includes(providerId);
}
