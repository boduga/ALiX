/**
 * P4.3-Sb1 — Secure JSON Response API
 *
 * Replaces raw `res.end(JSON.stringify(...))` with redaction-aware
 * JSON responders.  Every response passes through:
 *
 * 1. Structural redaction (secrets, depth, size limits)
 * 2. Content-Type and Cache-Control headers
 * 3. Safe error fallback on serialization failure
 *
 * @module
 */

import type { ServerResponse } from "node:http";
import { redactValue } from "../security/redaction/redactor.js";
import { createRedactionPolicy } from "../security/redaction/redaction-policy.js";
import { SecretDetector } from "../security/redaction/secret-detector.js";
import { DEFAULT_PROFILE } from "../security/redaction/profiles.js";
import { API_CACHE_HEADERS } from "./security-headers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Secure JSON responder returned by `createSecureResponder`.
 *
 * Every call to `ok()` or `error()` sends exactly one HTTP response
 * and terminates the response stream.
 */
export interface SecureJsonResponder {
  /**
   * Send a successful JSON response.
   *
   * - Redacts the value through the configured redaction profile.
   * - Sets `Content-Type: application/json` and `Cache-Control: no-store`.
   * - On serialization failure, falls back to `error("ALIX_100", 500)`.
   *
   * @param value - The value to serialize and send.
   * @param profileName - Optional redaction profile name (default: "operational").
   */
  ok(value: unknown, profileName?: string): void;

  /**
   * Send an error JSON response.
   *
   * - Builds `{ error: code, requestId?: string, details?: unknown }`.
   * - Redacts `details` before including them.
   * - Sets status code and content-type.
   *
   * @param code - Stable error code (e.g. "ALIX_100").
   * @param status - HTTP status code.
   * @param details - Optional details to redact and include.
   */
  error(code: string, status: number, details?: unknown): void;
}

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface SecureResponderOptions {
  /** Request id for error correlation. */
  requestId?: string;
  /** When true, enforce output byte limits (additional safety net). */
  enforceOutputLimit?: boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `SecureJsonResponder` bound to a specific HTTP response.
 *
 * ```ts
 * const responder = createSecureResponder(res, registry, detector, {
 *   requestId: ctx.requestId,
 * });
 * responder.ok({ data: 42 });
 * ```
 *
 * @param res - Node.js ServerResponse (already had security headers applied).
 * @param _registry - Route policy registry (reserved for future use).
 * @param detector - Pre-configured secret detector.
 * @param opts - Optional request id and output-limit flag.
 */
export function createSecureResponder(
  res: ServerResponse,
  _registry: unknown,
  detector: SecretDetector,
  opts?: SecureResponderOptions,
): SecureJsonResponder {
  const requestId = opts?.requestId;

  return {
    ok(value: unknown, profileName?: string): void {
      try {
        // 1. Determine profile
        const profile = profileName ?? "operational";

        // 2. Create redaction policy
        const policy = createRedactionPolicy(profile);

        // 3. Redact the value (never throws — returns sentinel on failure)
        const redacted = redactValue(value, policy, detector);

        // 4. Set headers
        if (!res.hasHeader("content-type")) {
          res.setHeader("content-type", "application/json");
        }
        Object.entries(API_CACHE_HEADERS).forEach(([k, v]) => {
          if (!res.hasHeader(k)) res.setHeader(k, v);
        });

        // 5. Serialize (redacted is always a plain object/array/primitive —
        //    no toJSON on the result, so JSON.stringify is safe)
        const body = JSON.stringify(redacted);

        // 6. Send
        res.end(body);
      } catch {
        // Serialization failure — fall back to structured error.
        // Do NOT expose the original value or the serialization error.
        respondError(res, "ALIX_100", 500, requestId);
      }
    },

    error(code: string, status: number, details?: unknown): void {
      respondError(res, code, status, requestId, details, detector);
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build and send a structured error response.
 *
 * Redacts `details` before including them so secrets in error payloads
 * never reach the client.
 */
function respondError(
  res: ServerResponse,
  code: string,
  status: number,
  requestId?: string,
  details?: unknown,
  detector?: SecretDetector,
): void {
  try {
    const payload: Record<string, unknown> = { error: code };

    if (requestId) {
      payload.requestId = requestId;
    }

    if (details !== undefined) {
      // Redact details before including them
      if (detector) {
        const policy = createRedactionPolicy("public");
        payload.details = redactValue(details, policy, detector);
      } else {
        // No detector available — strip details entirely (safe default)
        // Don't include raw, unredacted details
      }
    }

    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(payload));
  } catch {
    // Absolute last resort — send a minimal plain-text error
    try {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "ALIX_100", requestId: requestId ?? undefined }));
    } catch {
      // Nothing more we can do
    }
  }
}
