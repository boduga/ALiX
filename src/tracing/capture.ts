/**
 * src/tracing/capture.ts
 *
 * ALiX-owned capture policy: pure, copy-producing mandatory redaction +
 * truncation. No Langfuse SDK dependency and no dependency on the (later)
 * tracing config module — the policy is driven by an explicit {@link CaptureLevel}
 * plus {@link CaptureLimits} so it is independently testable and reusable.
 *
 * Security-critical pipeline (design §6-8) — ordering is mandatory and cannot
 * be reconfigured:
 *
 * ```text
 * raw value
 *     ↓
 * mandatory redaction   (always on, non-disableable, ALiX-owned, best-effort)
 *     ↓
 * truncation            (only at level "truncated")
 *     ↓
 * capture               ("full" = full value after redaction; never unredacted)
 * ```
 *
 * Redaction runs before truncation so a credential cut across a truncation
 * boundary cannot dodge the detector.
 *
 * The detector covers the initial common secret shapes (see {@link redactString})
 * and is deliberately NON-exhaustive. The contract is best-effort:
 *
 * > Capture policy provides best-effort built-in secret redaction. Callers
 * > remain responsible for not intentionally supplying sensitive data for
 * > capture.
 *
 * Level semantics:
 * - `"full"`      → full value after mandatory redaction (never bypasses it).
 * - `"truncated"` → redaction, then truncation (per-string `maxChars`, plus
 *                   structural caps on arrays/objects/depth).
 * - `"off"`       → the payload is not captured: every capture function returns
 *                   `undefined`. Facade callers treat `undefined` as "field
 *                   omitted" and must not pass it as a captured value.
 *
 * Immutability: the policy never mutates caller-owned objects. It walks the
 * input and returns fresh arrays/objects; every string leaf is redacted in the
 * copy. Callers may keep and reuse their original payloads freely.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Created by: Task 5 (implement capture policy) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

import type { NormalizedMessage } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How much of a payload is captured after mandatory redaction.
 *
 * Controls only whether data is captured and how much; it NEVER controls
 * whether mandatory secret redaction occurs.
 */
export type CaptureLevel = "full" | "truncated" | "off";

/**
 * Truncation limits applied at level `"truncated"`. All are optional; omitted
 * limits fall back to the module defaults. Limits are ignored at `"full"`
 * (full = full value after redaction) and at `"off"`.
 */
export interface CaptureLimits {
  /** Maximum characters kept per string leaf. @default 4000 */
  maxChars?: number;
  /** Maximum elements kept per array. @default 1000 */
  maxItems?: number;
  /** Maximum own-key values kept per object. @default 200 */
  maxProperties?: number;
  /** Maximum container nesting depth kept. @default 12 */
  maxDepth?: number;
}

/** Replacement emitted for every detected secret. */
export const REDACTED = "<redacted>";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LIMITS: Required<CaptureLimits> = {
  maxChars: 4000,
  maxItems: 1000,
  maxProperties: 200,
  maxDepth: 12,
};

/** Structural markers emitted when a container cannot be represented. */
const MARK_CIRCULAR = "[circular]";
const MARK_MAX_DEPTH = "[max-depth]";

// ---------------------------------------------------------------------------
// Secret detection (best-effort, non-exhaustive)
// ---------------------------------------------------------------------------

/**
 * Whole PEM private/public key blocks. Matches the full block so no body line
 * survives; replaced by {@link REDACTED}.
 */
const PEM_BLOCK_RE =
  /-----BEGIN (?:[A-Z0-9]+ )*(?:PRIVATE|PUBLIC) KEY-----[^]*?-----END (?:[A-Z0-9]+ )*(?:PRIVATE|PUBLIC) KEY-----/g;

/**
 * `cred://<provider>/<key>` store references. The whole reference is replaced
 * because the key label is part of the sensitive store address.
 */
const CRED_REF_RE = /cred:\/\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+/g;

/** `Authorization: <everything to end of line>` — label preserved. */
const AUTH_HEADER_RE =
  /((?:authorization|proxy-authorization)\s*:\s*)[^\r\n]+/gi;

/** `Bearer <token>` (any casing) — label preserved, token replaced. */
const BEARER_TOKEN_RE = /(\bbearer\s+)[A-Za-z0-9._~\-=]{10,}/gi;

/** `Basic <base64>` — label preserved, payload replaced. */
const BASIC_AUTH_RE = /(\bbasic\s+)[A-Za-z0-9+/=]{10,}/gi;

/**
 * Known OpenAI/Anthropic/Langfuse-style key prefixes. Redacts even short
 * bodies after a well-known label (a long-bodied `sk-`/`pk-` key is already
 * caught by the generic rule below).
 */
const PREFIXED_KEY_RE =
  /(?<![A-Za-z0-9])(?:sk-(?:proj|svcacct|admin|redacted|ant|lf|or|live)|pk-(?:lf|live))-[A-Za-z0-9_\-]{2,}/gi;

/** Generic `sk-` / `pk-` style tokens with a long body. */
const GENERIC_KEY_RE = /(?<![A-Za-z0-9])(?:sk|pk)-[A-Za-z0-9_\-]{8,}/gi;

/**
 * `api_key` / `api-key` / `apikey` assignments (any casing, optional quotes,
 * JSON or plaintext). The whole assignment value is replaced; surrounding
 * label, quotes, and trailing context are preserved.
 */
const API_KEY_ASSIGNMENT_RE =
  /(?<![A-Za-z0-9])("?)(api[_-]?key)("?)(\s*[:=]\s*)(["']?)([A-Za-z0-9_\-./+=]{12,})(["']?)/gi;

/** Other common secret assignments (password/secret/token/…), same shape. */
const SECRET_ASSIGNMENT_RE =
  /(?<![A-Za-z0-9])("?)(password|passwd|pwd|secret|token|client[_-]?secret|api[_-]?secret|auth[_-]?token|refresh[_-]?token|access[_-]?key|private[_-]?key)("?)(\s*[:=]\s*)(["']?)([A-Za-z0-9_\-./@+]{6,})(["']?)/gi;

/**
 * Redact known secret shapes from a single string. Always on and non-disableable.
 *
 * Best-effort and deliberately non-exhaustive: absence of a match does NOT
 * prove a value is safe to share. Callers remain responsible for not
 * intentionally supplying sensitive data for capture.
 *
 * Never mutates the input; returns a new string.
 */
export function redactString(input: string): string {
  if (input.length === 0) return input;
  let result = input;

  // Whole-block / whole-reference replacements.
  result = result.replace(PEM_BLOCK_RE, REDACTED);
  result = result.replace(CRED_REF_RE, REDACTED);

  // Label-preserving header/scheme replacements (run before generic tokens so
  // an auth line is consumed wholesale rather than piecemeal).
  result = result.replace(AUTH_HEADER_RE, (_m, label: string) => `${label}${REDACTED}`);
  result = result.replace(BEARER_TOKEN_RE, (_m, label: string) => `${label}${REDACTED}`);
  result = result.replace(BASIC_AUTH_RE, (_m, label: string) => `${label}${REDACTED}`);

  // Token bodies.
  result = result.replace(PREFIXED_KEY_RE, REDACTED);
  result = result.replace(GENERIC_KEY_RE, REDACTED);

  // Assignment values (labels + surrounding context preserved).
  result = result.replace(
    API_KEY_ASSIGNMENT_RE,
    (_m, q1: string, label: string, q2: string, sep: string, openQ: string, _value: string, closeQ: string) =>
      `${q1}${label}${q2}${sep}${openQ}${REDACTED}${closeQ}`,
  );
  result = result.replace(
    SECRET_ASSIGNMENT_RE,
    (_m, q1: string, label: string, q2: string, sep: string, openQ: string, _value: string, closeQ: string) =>
      `${q1}${label}${q2}${sep}${openQ}${REDACTED}${closeQ}`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Sensitive object keys
// ---------------------------------------------------------------------------

/**
 * Canonical sensitive key names: lower-cased with all non-alphanumerics
 * removed so `api_key`, `api-key`, `APIKey`, and `apiKey` all canonicalize to
 * the same entry. Comparison is exact on the canonical form — never substring
 * matching — mirroring the prior-art rule that `keyboardLayout` is not a
 * sensitive key while `token` is.
 */
const SENSITIVE_KEYS = new Set([
  "authorization",
  "proxyauthorization",
  "apikey",
  "xapikey",
  "token",
  "accesstoken",
  "authtoken",
  "refreshtoken",
  "sessiontoken",
  "sessionkey",
  "secret",
  "apisecret",
  "clientsecret",
  "clientkey",
  "password",
  "passwd",
  "pwd",
  "privatekey",
  "credential",
  "credentials",
  "cookie",
  "setcookie",
]);

function keyIsSensitive(key: string): boolean {
  const canonical = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEYS.has(canonical);
}

// ---------------------------------------------------------------------------
// Capture pipeline
// ---------------------------------------------------------------------------

function resolveLimits(limits: CaptureLimits | undefined): Required<CaptureLimits> {
  return {
    maxChars: limits?.maxChars ?? DEFAULT_LIMITS.maxChars,
    maxItems: limits?.maxItems ?? DEFAULT_LIMITS.maxItems,
    maxProperties: limits?.maxProperties ?? DEFAULT_LIMITS.maxProperties,
    maxDepth: limits?.maxDepth ?? DEFAULT_LIMITS.maxDepth,
  };
}

function truncateTo(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

/**
 * Capture a single string. Returns `undefined` at level `"off"`.
 *
 * At `"full"` the value is redacted but never truncated; at `"truncated"` it
 * is redacted first, then cut to `limits.maxChars`. The security-critical
 * redaction-before-truncation order is applied here.
 */
export function captureString(
  text: string,
  level: CaptureLevel,
  limits?: CaptureLimits,
): string | undefined {
  if (level === "off") return undefined;
  const redacted = redactString(text);
  if (level === "full") return redacted;
  return truncateTo(redacted, resolveLimits(limits).maxChars);
}

/**
 * Capture an arbitrary JSON-compatible value.
 *
 * Returns `undefined` at level `"off"`. Otherwise returns a NEW structure:
 * arrays/objects are recreated (never the caller's references), every string
 * leaf is redacted, and at `"truncated"` strings/arrays/objects are capped per
 * {@link CaptureLimits}.
 *
 * Only plain objects (`Object.prototype` or `null` prototype) and arrays are
 * deep-copied. Exotic objects (Date, Map, class instances) pass through by
 * reference and are never mutated — capture targets normalized runtime
 * payloads, which are JSON-compatible.
 *
 * @see captureMessages, captureToolArgs for typed entry points
 */
export function captureValue(
  value: unknown,
  level: CaptureLevel,
  limits?: CaptureLimits,
): unknown {
  if (level === "off") return undefined;
  return processNode(value, level, resolveLimits(limits), 0, new WeakSet());
}

function processNode(
  value: unknown,
  level: Exclude<CaptureLevel, "off">,
  limits: Required<CaptureLimits>,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null) return null;

  switch (typeof value) {
    case "string":
      return level === "truncated"
        ? truncateTo(redactString(value), limits.maxChars)
        : redactString(value);
    case "number":
    case "boolean":
    case "bigint":
    case "undefined":
      return value;
    case "object": {
      if (Array.isArray(value)) {
        return copyArray(value, level, limits, depth, seen);
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return value;
      return copyObject(value, level, limits, depth, seen);
    }
    default:
      // function / symbol — pass through by reference, never mutated.
      return value;
  }
}

function copyArray(
  value: unknown[],
  level: Exclude<CaptureLevel, "off">,
  limits: Required<CaptureLimits>,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (level === "truncated" && depth >= limits.maxDepth) return MARK_MAX_DEPTH;
  if (seen.has(value)) return MARK_CIRCULAR;
  seen.add(value);

  const items = level === "truncated" ? value.slice(0, limits.maxItems) : value;
  const out: unknown[] = new Array(items.length);
  for (let i = 0; i < items.length; i++) {
    out[i] = processNode(items[i], level, limits, depth + 1, seen);
  }

  seen.delete(value);
  return out;
}

function copyObject(
  value: object,
  level: Exclude<CaptureLevel, "off">,
  limits: Required<CaptureLimits>,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (level === "truncated" && depth >= limits.maxDepth) return MARK_MAX_DEPTH;
  if (seen.has(value)) return MARK_CIRCULAR;
  seen.add(value);

  const keys =
    level === "truncated"
      ? Object.keys(value).slice(0, limits.maxProperties)
      : Object.keys(value);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of keys) {
    const raw = source[key];
    // Whole-value redaction for strings under a sensitive key (structured
    // JSON that the inline string patterns cannot see).
    out[key] =
      keyIsSensitive(key) && typeof raw === "string"
        ? REDACTED
        : processNode(raw, level, limits, depth + 1, seen);
  }

  seen.delete(value);
  return out;
}

// ---------------------------------------------------------------------------
// Typed entry points for the runtime seams (Tasks 7/11/12)
// ---------------------------------------------------------------------------

/**
 * Capture normalized model messages (`ModelSpanInput.messages`).
 *
 * `"off"` → `undefined` (messages not captured). Otherwise returns a NEW
 * array: message objects, content parts, and string leaves are copied and
 * every string is redacted (+ truncated at `"truncated"`).
 */
export function captureMessages(
  messages: readonly NormalizedMessage[],
  level: CaptureLevel,
  limits?: CaptureLimits,
): NormalizedMessage[] | undefined {
  const captured = captureValue(messages, level, limits);
  return captured === undefined ? undefined : (captured as NormalizedMessage[]);
}

/**
 * Capture tool call arguments (`ToolSpanInput.args`).
 *
 * `"off"` → `undefined` (args not captured). Otherwise returns a NEW record
 * with string values redacted (+ truncated at `"truncated"`), including
 * whole-value redaction of values under sensitive keys.
 */
export function captureToolArgs(
  args: Readonly<Record<string, unknown>>,
  level: CaptureLevel,
  limits?: CaptureLimits,
): Record<string, unknown> | undefined {
  const captured = captureValue(args, level, limits);
  if (captured === undefined) return undefined;
  return captured && typeof captured === "object" && !Array.isArray(captured)
    ? (captured as Record<string, unknown>)
    : undefined;
}
