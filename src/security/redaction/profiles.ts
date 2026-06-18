/**
 * P4.3-Sa1 — Redaction Foundation
 *
 * Convenience re-exports for the built-in classification profiles and
 * the default-profile constant.
 *
 * @module
 */

export {
  PUBLIC_PROFILE,
  OPERATIONAL_PROFILE,
  ADMINISTRATIVE_PROFILE,
  SUPPORT_BUNDLE_PROFILE,
  type ClassificationProfile,
  type RedactionClassification,
} from "./classifications.js";

export { resolveProfile } from "./redaction-policy.js";

/** Default redaction profile name. */
export const DEFAULT_PROFILE = "public";
