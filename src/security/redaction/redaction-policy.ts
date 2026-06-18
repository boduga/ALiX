/**
 * P4.3-Sa1 — Redaction Foundation
 *
 * Defines the `RedactionPolicy` type, the factory function, and the
 * `keyIsSensitive()` helper that performs exact normalized key-name
 * matching (never substring matching).
 *
 * @module
 */

import {
  type ClassificationProfile,
  type RedactionClassification,
  MAX_DEPTH,
  MAX_PROPERTIES,
  MAX_ARRAY_ITEMS,
  MAX_OUTPUT_BYTES,
  PUBLIC_PROFILE,
  OPERATIONAL_PROFILE,
  ADMINISTRATIVE_PROFILE,
  SUPPORT_BUNDLE_PROFILE,
} from "./classifications.js";

import type { SecretDetectorOptions } from "./secret-detector.js";

// ---------------------------------------------------------------------------
// RedactionPolicy
// ---------------------------------------------------------------------------

export interface RedactionPolicy {
  /** The active classification profile. */
  profile: ClassificationProfile;

  /** Optional custom patterns forwarded to the detector. */
  customPatterns?: SecretDetectorOptions["customPatterns"];

  /**
   * Max recursion depth for structural redaction.
   * @default MAX_DEPTH (12)
   */
  maxDepth?: number;

  /**
   * Max enumerable properties per object.
   * @default MAX_PROPERTIES (200)
   */
  maxProperties?: number;

  /**
   * Max array items to redact.
   * @default MAX_ARRAY_ITEMS (1000)
   */
  maxArrayItems?: number;

  /**
   * Max total output bytes before truncation.
   * @default MAX_OUTPUT_BYTES (262144)
   */
  maxOutputBytes?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const PROFILE_REGISTRY: Record<string, ClassificationProfile> = {
  public: PUBLIC_PROFILE,
  operational: OPERATIONAL_PROFILE,
  administrative: ADMINISTRATIVE_PROFILE,
  support_bundle: SUPPORT_BUNDLE_PROFILE,
};

/**
 * Resolve a profile name to a `ClassificationProfile` object.
 * Throws if the name is unknown.
 */
export function resolveProfile(name: string): ClassificationProfile {
  const profile = PROFILE_REGISTRY[name.toLowerCase()];
  if (!profile) {
    throw new Error(
      `Unknown redaction profile "${name}". ` +
      `Valid profiles: ${Object.keys(PROFILE_REGISTRY).join(", ")}`,
    );
  }
  return profile;
}

/**
 * Create a `RedactionPolicy` from a profile name and optional overrides.
 *
 * ```ts
 * const policy = createRedactionPolicy("public", { maxDepth: 8 });
 * ```
 */
export function createRedactionPolicy(
  profileName: string,
  opts?: Partial<RedactionPolicy>,
): RedactionPolicy {
  const profile = resolveProfile(profileName);

  return {
    profile,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Sensitive-key detection
// ---------------------------------------------------------------------------

/**
 * Normalized set of sensitive key names.
 * Every lookup is O(1) and exact — no substring matching.
 */
const SENSITIVE_KEYS = new Set<string>([
  // Exact common secret-bearing keys
  "password",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "apikey",
  "apisecret",
  "api_secret",
  "privateKey",
  "private_key",
  "accessKey",
  "access_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "sessionKey",
  "session_key",
  "authToken",
  "auth_token",
  "authorization",
  "credential",
  "credentials",
]);

/**
 * Return `true` when `key` matches a known sensitive key name.
 *
 * **Exact match only.**  `keyboardLayout` returns `false`,
 * `monkeyPatch` returns `false`, but `token` returns `true`.
 *
 * @param key — object property name (already a string).
 */
export function keyIsSensitive(key: string): boolean {
  return SENSITIVE_KEYS.has(key);
}
