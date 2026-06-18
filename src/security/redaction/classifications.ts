/**
 * P4.3-Sa1 — Redaction Foundation
 *
 * Defines classification types, profiles, and global limits for
 * the ALiX structural redaction system.
 *
 * Every value that flows through an external security surface should
 * be filtered by one of the profiles defined here.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Classification types
// ---------------------------------------------------------------------------

/**
 * Closed union of all secret classifications the redactor understands.
 *
 * Each classification maps to a family of patterns in the secret detector
 * and a replacement marker in the redaction policy.
 */
export type RedactionClassification =
  | "api_key"
  | "aws_access_key"
  | "aws_secret_key"
  | "private_key"
  | "bearer_token"
  | "basic_auth"
  | "jwt"
  | "auth_header"
  | "cookie"
  | "credential_url"
  | "password"
  | "generic_secret"
  | "connection_string";

// ---------------------------------------------------------------------------
// Profile types
// ---------------------------------------------------------------------------

/**
 * A named profile that combines a set of classifications to redact,
 * a replacement-marker template, and a cap on redacted-value length.
 *
 * - `name` — machine-readable profile key (e.g. "public").
 * - `redactedClassifications` — classifications whose values MUST be replaced.
 * - `preservedClassifications` — classifications whose values MAY pass through.
 * - `markerTemplate` — sprintf-like template for replacement markers, e.g.
 *   `"[REDACTED_{classification}]"`.  `{classification}` is substituted
 *   with the uppercase classification name.
 * - `maxRedactedValueChars` — when a redacted value is longer than this
 *   it is truncated to a safe preview.
 */
export interface ClassificationProfile {
  name: string;
  redactedClassifications: RedactionClassification[];
  preservedClassifications: RedactionClassification[];
  markerTemplate: string;
  maxRedactedValueChars: number;
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

const ALL_CLASSIFICATIONS: RedactionClassification[] = [
  "api_key",
  "aws_access_key",
  "aws_secret_key",
  "private_key",
  "bearer_token",
  "basic_auth",
  "jwt",
  "auth_header",
  "cookie",
  "credential_url",
  "password",
  "generic_secret",
  "connection_string",
];

/** Profile: **public** — redact everything, for logs, CLI output, UI. */
export const PUBLIC_PROFILE: ClassificationProfile = {
  name: "public",
  redactedClassifications: [...ALL_CLASSIFICATIONS],
  preservedClassifications: [],
  markerTemplate: "[REDACTED_{classification}]",
  maxRedactedValueChars: 40,
};

/** Profile: **operational** — redact credentials and tokens, preserve headers. */
export const OPERATIONAL_PROFILE: ClassificationProfile = {
  name: "operational",
  redactedClassifications: [
    "api_key",
    "aws_access_key",
    "aws_secret_key",
    "bearer_token",
    "basic_auth",
    "jwt",
    "password",
    "generic_secret",
    "connection_string",
  ],
  preservedClassifications: [
    "auth_header",
    "cookie",
    "credential_url",
    "private_key",
  ],
  markerTemplate: "[REDACTED_{classification}]",
  maxRedactedValueChars: 40,
};

/** Profile: **administrative** — keep only safe headers. */
export const ADMINISTRATIVE_PROFILE: ClassificationProfile = {
  name: "administrative",
  redactedClassifications: [
    "api_key",
    "aws_access_key",
    "aws_secret_key",
    "bearer_token",
    "basic_auth",
    "jwt",
    "password",
    "generic_secret",
    "connection_string",
    "private_key",
    "credential_url",
  ],
  preservedClassifications: [
    "auth_header",
    "cookie",
  ],
  markerTemplate: "[REDACTED_{classification}]",
  maxRedactedValueChars: 40,
};

/** Profile: **support_bundle** — no redaction, use for diagnostics. */
export const SUPPORT_BUNDLE_PROFILE: ClassificationProfile = {
  name: "support_bundle",
  redactedClassifications: [],
  preservedClassifications: [...ALL_CLASSIFICATIONS],
  markerTemplate: "[REDACTED_{classification}]",
  maxRedactedValueChars: Number.POSITIVE_INFINITY,
};

// ---------------------------------------------------------------------------
// Global limits
// ---------------------------------------------------------------------------

/**
 * Maximum recursion depth for structural redaction.
 * Beyond this depth the redactor returns `"[MAX_DEPTH_REACHED]"`.
 */
export const MAX_DEPTH = 12;

/**
 * Maximum number of own properties per object.
 * Beyond this count the redactor truncates the output.
 */
export const MAX_PROPERTIES = 200;

/**
 * Maximum number of array items.
 * Beyond this count the redactor truncates the output.
 */
export const MAX_ARRAY_ITEMS = 1000;

/**
 * Maximum string length the detector will scan in one call.
 * Longer strings are truncated at this boundary.
 */
export const MAX_STRING_SCAN = 65536;

/**
 * Maximum total output bytes for one redaction call.
 * Once exceeded the redactor returns `"[MAX_OUTPUT_EXCEEDED]"`.
 */
export const MAX_OUTPUT_BYTES = 262144;

/**
 * Maximum safe string length for a redacted value before truncation
 * to a preview-with-suffix pattern.
 */
export const MAX_SAFE_STRING_LENGTH = 512;

/**
 * Length of the preview portion of a truncated redacted value.
 */
export const MAX_PREVIEW_LENGTH = 128;
