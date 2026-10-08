/**
 * provider-locality.ts — R5.1 provider locality predicate.
 *
 * The outbound redaction gate applies to every provider that is not
 * explicitly local. **Fail-closed:** an unknown provider id is treated as
 * REMOTE (redact), never as local — a new remote provider is protected by
 * default and must be explicitly added here to opt out.
 *
 * Local means the request never leaves the machine: an in-process mock or a
 * local server (Ollama, llama.cpp). Keyless providers are a subset of local.
 */

import { KEYLESS_PROVIDERS } from "./keyless-providers.js";

/** Providers whose traffic never leaves the machine (local server or mock). */
export const LOCAL_PROVIDERS: ReadonlyArray<string> = [
  ...KEYLESS_PROVIDERS,
  // Eval/test double; never a real network provider.
  "scripted-mock",
];

/** True only when the provider id is an explicitly local backend. */
export function isLocalProvider(providerId: string): boolean {
  return LOCAL_PROVIDERS.includes(providerId);
}

/** True unless the provider is explicitly local (fail-closed for unknown ids). */
export function isRemoteProvider(providerId: string): boolean {
  return !isLocalProvider(providerId);
}
