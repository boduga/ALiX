/**
 * P4.3-Sd1 — Canonical JSON Serializer
 *
 * Produces deterministic JSON output suitable for cryptographic hashing.
 * Every property key is sorted alphabetically at each nesting level,
 * arrays preserve their original element order, and non-finite numbers
 * and non-serializable JS values are rejected with stable errors.
 *
 * Canonical form:
 *   canonicalHash(value) = sha256("alix-audit-v1:" + canonicalStringify(value))
 *
 * @module
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Domain prefix
// ---------------------------------------------------------------------------

/** Domain/version prefix prepended to canonical content before hashing. */
const DOMAIN_PREFIX = "alix-audit-v1:";

// ---------------------------------------------------------------------------
// Error messages (stable — tests depend on exact text)
// ---------------------------------------------------------------------------

const ERR_NON_FINITE = "Canonical JSON: non-finite numbers are not allowed";
const ERR_UNDEFINED = "Canonical JSON: undefined is not allowed";
const ERR_FUNCTION = "Canonical JSON: functions are not allowed";
const ERR_SYMBOL = "Canonical JSON: symbols are not allowed";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).sort();
}

/**
 * Recursively produce the canonical JSON string for `value`.
 * Throws on invalid types so callers can choose to handle or propagate.
 */
function serialize(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const t = typeof value;

  switch (t) {
    case "string":
      return JSON.stringify(value);

    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError(ERR_NON_FINITE);
      }
      // JSON.stringify handles integer vs float correctly for finite numbers.
      // However, -0 must serialize as 0 per RFC 8785 (I-JSON).
      // We follow the same rule.
      if (Object.is(value, -0)) {
        return "0";
      }
      return JSON.stringify(value);
    }

    case "boolean":
      return value === true ? "true" : "false";

    case "object": {
      if (Array.isArray(value)) {
        return serializeArray(value);
      }
      return serializeObject(value as Record<string, unknown>);
    }

    case "undefined":
      throw new TypeError(ERR_UNDEFINED);

    case "function":
      throw new TypeError(ERR_FUNCTION);

    case "symbol":
      throw new TypeError(ERR_SYMBOL);

    default:
      // bigint — not representable in JSON; reject as symbol-like
      throw new TypeError(ERR_SYMBOL);
  }
}

function serializeArray(arr: unknown[]): string {
  if (arr.length === 0) return "[]";
  const parts: string[] = [];
  for (const item of arr) {
    parts.push(serialize(item));
  }
  return "[" + parts.join(",") + "]";
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys = sortedKeys(obj);
  if (keys.length === 0) return "{}";
  const parts: string[] = [];
  for (const key of keys) {
    // Only serialize own-enumerable properties; Object.keys already guarantees this.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      parts.push(JSON.stringify(key) + ":" + serialize(obj[key]));
    }
  }
  return "{" + parts.join(",") + "}";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Produce a deterministic, canonical JSON string for the given value.
 *
 * - Object keys are sorted alphabetically (recursively).
 * - Arrays preserve element order.
 * - Non-finite numbers (`NaN`, `Infinity`, `-Infinity`) throw `TypeError`.
 * - `undefined`, functions, and symbols throw `TypeError`.
 * - Output is always valid UTF-8 JSON.
 *
 * @throws {TypeError} if the value contains an unsupported type.
 */
export function canonicalStringify(value: unknown): string {
  return serialize(value);
}

/**
 * Return the hex-encoded SHA-256 digest of the canonical form of `value`.
 *
 * The digest covers `"alix-audit-v1:"` + `canonicalStringify(value)`.
 *
 * @throws {TypeError} if the value contains an unsupported type.
 */
export function canonicalHash(value: unknown): string {
  const canonical = canonicalStringify(value);
  const hash = createHash("sha256");
  hash.update(DOMAIN_PREFIX);
  hash.update(canonical, "utf8");
  return hash.digest("hex");
}

/**
 * The domain prefix prepended to canonical content before hashing.
 * Exported for test fixtures and verification.
 */
export function getDomainPrefix(): string {
  return DOMAIN_PREFIX;
}
