/**
 * P4.3-Se1 — Credential References
 *
 * Defines the `cred://` reference scheme for indirect credential resolution.
 * Credentials are stored in the platform credential store and referenced by
 * their provider + keyLabel pair. The reference format is:
 *
 *   `cred://provider/keyLabel`
 *
 * Only the credential store is consulted for resolution. Environment variables
 * and config files are NOT used as fallback sources for `cred://` references.
 *
 * @module
 */

import type { CredentialStore } from "./credential-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** URL scheme prefix for credential references. */
export const CREDENTIAL_SCHEME = "cred://";

// ---------------------------------------------------------------------------
// Reference syntax
// ---------------------------------------------------------------------------

const CREDENTIAL_REFERENCE_REGEX = /^cred:\/\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_:.-]+)$/;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a value string is a `cred://` credential reference.
 */
export function isCredentialReference(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(CREDENTIAL_SCHEME);
}

/**
 * Construct a `cred://` reference string from provider and keyLabel.
 */
export function makeCredentialReference(
  provider: string,
  keyLabel: string
): string {
  return `${CREDENTIAL_SCHEME}${provider}/${keyLabel}`;
}

/**
 * Parse a `cred://` reference into its provider and keyLabel components.
 * Returns `null` if the reference is not a valid credential reference.
 */
export function parseCredentialReference(
  ref: string
): { provider: string; keyLabel: string } | null {
  const match = ref.match(CREDENTIAL_REFERENCE_REGEX);
  if (!match) return null;
  return { provider: match[1], keyLabel: match[2] };
}

/**
 * Resolve a `cred://` reference using the given credential store.
 *
 * Returns the credential value as a string, or `null` if:
 * - The reference is not a valid `cred://` URI
 * - The credential is not found in the store
 *
 * Resolution is strict: only the credential store is consulted. Environment
 * variables and config files are not used as fallback sources.
 */
export function resolveCredential(
  ref: string,
  store: CredentialStore
): string | null {
  const parsed = parseCredentialReference(ref);
  if (!parsed) return null;
  return store.get(parsed.provider, parsed.keyLabel);
}

/**
 * Recursively resolve credential references in a value.
 *
 * If the value is a `cred://` reference, it is resolved. The resolved value
 * is NOT recursively checked for further references (recursive references
 * are forbidden by design).
 *
 * If the value is not a reference, it is returned as-is.
 *
 * @param value - The value to resolve
 * @param store - The credential store to use for resolution
 * @returns The resolved value, or null if the credential was not found
 * @throws If the value is a recursive credential reference
 */
export function resolveValue(
  value: unknown,
  store: CredentialStore
): unknown {
  if (!isCredentialReference(value)) return value;

  const resolved = resolveCredential(value, store);
  if (resolved === null) {
    const parsed = parseCredentialReference(value);
    throw new Error(
      `Credential not found: ${value}` +
      (parsed ? ` (provider="${parsed.provider}", keyLabel="${parsed.keyLabel}")` : "")
    );
  }

  // Recursive reference check
  if (isCredentialReference(resolved)) {
    throw new Error(
      `Recursive credential reference detected: ${value} resolved to ${resolved}. ` +
      "Credential values must not contain cred:// references."
    );
  }

  return resolved;
}
