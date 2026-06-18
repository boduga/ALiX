/**
 * P4.3-Sa1 — Redaction Foundation
 *
 * Core structural redactor.  Walks the raw object graph (never invokes
 * `toJSON()`), redacts sensitive values based on a `RedactionPolicy`, and
 * **never throws** — every failure path returns a safe sentinel string.
 *
 * @module
 */

import {
  type RedactionClassification,
  MAX_STRING_SCAN,
  MAX_PREVIEW_LENGTH,
  MAX_SAFE_STRING_LENGTH,
} from "./classifications.js";
import type { RedactionPolicy } from "./redaction-policy.js";
import { keyIsSensitive } from "./redaction-policy.js";
import { SecretDetector, type SecretSpan } from "./secret-detector.js";

// ---------------------------------------------------------------------------
// Sentinel values
// ---------------------------------------------------------------------------

const SENTINEL_CIRCULAR = "[CIRCULAR_REFERENCE]";
const SENTINEL_MAX_DEPTH = "[MAX_DEPTH_REACHED]";
const SENTINEL_MAX_OUTPUT = "[MAX_OUTPUT_EXCEEDED]";
const SENTINEL_REDACTED_SYMBOL = "[REDACTED_SYMBOL]";
const SENTINEL_REDACTED_BINARY = "[REDACTED_BINARY]";
const SENTINEL_REDACTED_KEY = "[REDACTED]";
const SENTINEL_REDACTION_ERROR = "[REDACTION_ERROR]";
const SENTINEL_REDACTION_FAILED = "[REDACTION_FAILED]";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface RedactorState {
  /** WeakSet tracking already-visited objects (for cycle detection). */
  seen: WeakSet<object>;
  /** Current recursion depth. */
  depth: number;
  /** Cumulative output bytes (approximate, using JSON.stringify length). */
  outputBytes: number;
  /** The active policy. */
  policy: RedactionPolicy;
  /** The secret detector instance. */
  detector: SecretDetector;
  /** Max depth before returning sentinel. */
  maxDepth: number;
  /** Max properties per object before truncation. */
  maxProperties: number;
  /** Max array items before truncation. */
  maxArrayItems: number;
  /** Max output bytes before returning sentinel. */
  maxOutputBytes: number;
}

// ---------------------------------------------------------------------------
// Classification → marker
// ---------------------------------------------------------------------------

/**
 * Build the replacement marker for a given classification under the
 * current profile.
 */
function markerFor(
  classification: RedactionClassification,
  policy: RedactionPolicy,
): string {
  return policy.profile.markerTemplate.replace(
    "{classification}",
    classification.toUpperCase(),
  );
}

/**
 * Return `true` when the profile says this classification should be
 * redacted.
 */
function shouldRedact(
  classification: RedactionClassification,
  policy: RedactionPolicy,
): boolean {
  return policy.profile.redactedClassifications.includes(classification);
}

// ---------------------------------------------------------------------------
// String redaction
// ---------------------------------------------------------------------------

/**
 * Redact secret spans within a single string value.
 *
 * - If the classification is preserved by the profile, the string
 *   passes through unchanged.
 * - If the classification is redacted, matching spans are replaced
 *   with the profile's marker.
 * - If the resulting redacted value exceeds `MAX_SAFE_STRING_LENGTH`
 *   it is truncated to `{MAX_PREVIEW_LENGTH}...<sha256-prefix>`.
 */
function redactString(
  value: string,
  state: RedactorState,
): string {
  try {
    // Skip non-string primitives
    if (typeof value !== "string") return value;
    if (value.length === 0) return value;

    // Scan for secrets
    const spans = state.detector.detect(value);
    if (spans.length === 0) return value;

    // Build result by iterating spans in reverse (so indices stay valid)
    let result = value;
    // Only redact spans whose classification is configured for redaction
    const relevantSpans = spans.filter((s) =>
      shouldRedact(s.classification, state.policy),
    );

    if (relevantSpans.length === 0) return value;

    // Sort by start desc so replacements don't shift indices
    const sorted = [...relevantSpans].sort((a, b) => b.start - a.start);

    let accumulator = "";
    let lastEnd = value.length;

    for (const span of sorted) {
      // Text after this span (already processed or trailing)
      const suffix = accumulator.length > 0
        ? accumulator
        : value.slice(span.end, lastEnd);
      accumulator = markerFor(span.classification, state.policy) + suffix;
      lastEnd = span.start;
    }
    // Prepend text before the first (earliest) span
    if (lastEnd > 0) {
      const prefix = value.slice(0, lastEnd);
      accumulator = prefix + accumulator;
    }

    result = accumulator;

    // Truncate extremely long redacted values
    if (result.length > MAX_SAFE_STRING_LENGTH) {
      const preview = result.slice(0, MAX_PREVIEW_LENGTH);
      const suffix = truncatedSuffix(result);
      result = preview + suffix;
    }

    return result;
  } catch {
    return SENTINEL_REDACTION_ERROR;
  }
}

/**
 * Build a short stable suffix for truncated values.
 * Uses a simple hash so the same input always produces the same suffix.
 */
function truncatedSuffix(value: string): string {
  // Simple DJB2 hash — deterministic, no dependencies
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  const hashHex = (hash >>> 0).toString(16).padStart(8, "0");
  return `...<${hashHex}>`;
}

// ---------------------------------------------------------------------------
// Core recursive redactor
// ---------------------------------------------------------------------------

/**
 * Redact a value according to the given policy and detector.
 *
 * **Never throws.**  If the entire operation fails a safe sentinel
 * (`"[REDACTION_FAILED]"`) is returned.
 *
 * @param value — value to redact.
 * @param policy — redaction policy (profile + limits).
 * @param detector — pre-configured secret detector.
 * @param knownKey — optional property key of the value in its parent
 *   (used for key-based redaction).
 */
export function redactValue<T>(
  value: T,
  policy: RedactionPolicy,
  detector: SecretDetector,
): T {
  const state: RedactorState = {
    seen: new WeakSet(),
    depth: 0,
    outputBytes: 0,
    policy,
    detector,
    maxDepth: policy.maxDepth ?? 12,
    maxProperties: policy.maxProperties ?? 200,
    maxArrayItems: policy.maxArrayItems ?? 1000,
    maxOutputBytes: policy.maxOutputBytes ?? 262144,
  };

  try {
    const result = redactInternal(value, state, undefined);
    // Post-accumulation check: if output bytes exceeded while building
    // the result, return the sentinel instead.
    if (state.outputBytes > state.maxOutputBytes) {
      return SENTINEL_MAX_OUTPUT as unknown as T;
    }
    return result as T;
  } catch {
    return SENTINEL_REDACTION_FAILED as unknown as T;
  }
}

/**
 * Internal recursive redaction.
 *
 * @param value — value to redact.
 * @param state — shared mutable state.
 * @param knownKey — property key under which `value` is known
 *    (or `undefined` for root / array elements).
 */
function redactInternal(
  value: unknown,
  state: RedactorState,
  knownKey: string | undefined,
): unknown {
  // -----------------------------------------------------------------------
  // Limit checks
  // -----------------------------------------------------------------------

  if (state.depth > state.maxDepth) {
    return SENTINEL_MAX_DEPTH;
  }

  if (state.outputBytes > state.maxOutputBytes) {
    return SENTINEL_MAX_OUTPUT;
  }

  // -----------------------------------------------------------------------
  // Null / undefined
  // -----------------------------------------------------------------------

  if (value === null || value === undefined) {
    return value;
  }

  // -----------------------------------------------------------------------
  // Primitives
  // -----------------------------------------------------------------------

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    return value.toString() + "n";
  }

  if (typeof value === "symbol") {
    return SENTINEL_REDACTED_SYMBOL;
  }

  if (typeof value === "string") {
    // Key-based redaction (explicit secret key)
    if (knownKey !== undefined && keyIsSensitive(knownKey)) {
      return SENTINEL_REDACTED_KEY;
    }
    // Scan for patterns (may still redact even if key was allowlisted)
    return redactString(value, state);
  }

  // -----------------------------------------------------------------------
  // Objects (including Date, Error, Buffer, Map, Set, etc.)
  // -----------------------------------------------------------------------

  if (typeof value !== "object") {
    return String(value);
  }

  // Cycle detection
  if (state.seen.has(value)) {
    return SENTINEL_CIRCULAR;
  }
  state.seen.add(value);

  // Increment depth for children
  state.depth++;

  try {
    // --- Date ------------------------------------------------------------
    if (value instanceof Date) {
      state.depth--;
      return new Date(NaN);
    }

    // --- Error -----------------------------------------------------------
    if (value instanceof Error) {
      const result: Record<string, unknown> = {};
      // Redact message
      result.message = redactString(value.message, state);
      // Keep name
      result.name = value.name ?? "Error";
      // Redact stack
      if (value.stack) {
        result.stack = redactString(value.stack, state);
      }
      // If there is a cause property, redact it
      if ("cause" in value && value.cause !== undefined) {
        result.cause = redactInternal(value.cause, state, "cause");
      }
      state.depth--;
      return result;
    }

    // --- Buffer / TypedArray / ArrayBuffer -------------------------------
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      state.depth--;
      return SENTINEL_REDACTED_BINARY;
    }
    // Also catch DataView and older Buffer
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      state.depth--;
      return SENTINEL_REDACTED_BINARY;
    }

    // --- Map -------------------------------------------------------------
    if (value instanceof Map) {
      const result: Record<string, unknown> = {};
      let count = 0;
      for (const [k, v] of value.entries()) {
        if (count >= state.maxProperties) break;
        try {
          const redactedKey = typeof k === "string" ? k : "[MAP_KEY]";
          result[redactedKey] = redactInternal(v, state, redactedKey);
        } catch {
          result[`[key_${count}]`] = SENTINEL_REDACTION_ERROR;
        }
        count++;
      }
      state.depth--;
      updateOutputBytes(state, result);
      return result;
    }

    // --- Set -------------------------------------------------------------
    if (value instanceof Set) {
      const result: unknown[] = [];
      let count = 0;
      for (const v of value.values()) {
        if (count >= state.maxArrayItems) break;
        try {
          result.push(redactInternal(v, state, undefined));
        } catch {
          result.push(SENTINEL_REDACTION_ERROR);
        }
        count++;
      }
      state.depth--;
      updateOutputBytes(state, result);
      return result;
    }

    // --- Array -----------------------------------------------------------
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      const limit = Math.min(value.length, state.maxArrayItems);
      for (let i = 0; i < limit; i++) {
        try {
          result.push(redactInternal(value[i], state, undefined));
        } catch {
          result.push(SENTINEL_REDACTION_ERROR);
        }
      }
      state.depth--;
      updateOutputBytes(state, result);
      return result;
    }

    // --- Plain object (no toJSON invocation) -----------------------------
    // Gather all own property keys (enumerable + non-enumerable)
    const keys = ownKeys(value);

    const result: Record<string, unknown> = {};
    let count = 0;

    // Key-based redaction check first: if the object itself is accessed
    // via a sensitive key, its knownKey will be set.  But for plain objects
    // we already handled that before entering this branch.  Here we check
    // each property key.

    for (const key of keys) {
      if (count >= state.maxProperties) break;

      let propValue: unknown;
      try {
        propValue = (value as Record<string, unknown>)[key];
      } catch {
        // Throwing getter
        result[key] = SENTINEL_REDACTION_ERROR;
        count++;
        continue;
      }

      try {
        result[key] = redactInternal(propValue, state, key);
      } catch {
        result[key] = SENTINEL_REDACTION_ERROR;
      }

      count++;
    }

    state.depth--;
    updateOutputBytes(state, result);
    return result;
  } catch {
    state.depth--;
    return SENTINEL_REDACTION_FAILED;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Accumulate output bytes estimate.
 *
 * Walks the object graph manually without invoking `toJSON()` or any
 * custom serialization.  Counts structural characters (braces, brackets,
 * colons, commas, quotes) and string lengths for primitives.  Not exact
 * — just monotonic and side-effect-free.
 */
function updateOutputBytes(state: RedactorState, obj: unknown): void {
  try {
    state.outputBytes += estimateByteLength(obj, 0);
  } catch {
    // If estimation fails (pathological value), add a conservative guess.
    state.outputBytes += 256;
  }
}

/**
 * Depth-limited byte-length estimator.
 *
 * Counts structural characters (braces, brackets, colons, commas, quotes)
 * and `String(value).length` for primitives.  Never invokes `toJSON()`.
 */
function estimateByteLength(value: unknown, depth: number): number {
  // Cap recursion depth so pathological objects don't hang
  if (depth > 10) return 0;

  if (value === null || value === undefined) return 4; // "null" / "undefined"
  if (typeof value === "boolean") return value ? 4 : 5; // true / false
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value).length;
  }
  if (typeof value === "string") return value.length + 2; // +2 for JSON quotes
  if (typeof value === "symbol") return 0;
  if (typeof value !== "object") return String(value).length;

  // Array
  if (Array.isArray(value)) {
    let size = 1; // '['
    for (let i = 0; i < value.length; i++) {
      if (i > 0) size += 1; // ','
      size += estimateByteLength(value[i], depth + 1);
    }
    size += 1; // ']'
    return size;
  }

  // Plain object (always a plain {} created by redactInternal, so no toJSON)
  let size = 1; // '{'
  const keys = Object.keys(value as Record<string, unknown>);
  for (let i = 0; i < keys.length; i++) {
    if (i > 0) size += 1; // ','
    size += keys[i].length + 2; // quoted key name
    size += 1; // ':'
    size += estimateByteLength(
      (value as Record<string, unknown>)[keys[i]],
      depth + 1,
    );
  }
  size += 1; // '}'
  return size;
}

/**
 * Gather own property keys including non-enumerable ones (but excluding
 * symbols).
 */
function ownKeys(obj: object): string[] {
  try {
    return [
      ...Object.getOwnPropertyNames(obj),
    ];
  } catch {
    return [];
  }
}
