/**
 * P4.3-Sa1 — Redaction Foundation
 *
 * Safe error projection.  Internal exceptions are mapped to stable
 * error codes.  Stack traces and internal details are NEVER returned
 * to callers — they are redacted before local logging.
 *
 * @module
 */

import type { SecretDetector } from "./secret-detector.js";
import type { RedactionPolicy } from "./redaction-policy.js";
import { redactValue } from "./redactor.js";
import { DEFAULT_PROFILE } from "./profiles.js";

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Stable error codes for the ALiX public API.
 *
 * Every external-facing error must be projected through one of these
 * codes so consumers can reliably switch/handle without parsing
 * human-readable messages.
 */
export const ErrorCodes = {
  /** Internal / unexpected error. */
  INTERNAL_ERROR: "ALIX_001",
  /** Resource not found. */
  NOT_FOUND: "ALIX_002",
  /** Invalid input provided. */
  INVALID_INPUT: "ALIX_003",
  /** Rate limited. */
  RATE_LIMITED: "ALIX_004",
  /** Authentication / authorization required. */
  UNAUTHORIZED: "ALIX_005",
  /** Forbidden (authenticated but not permitted). */
  FORBIDDEN: "ALIX_006",
  /** Configuration error. */
  CONFIG_ERROR: "ALIX_007",

  // Security subsystem
  /** Redaction failure (see Sa1). */
  REDACTION_FAILED: "ALIX_100",
  /** Audit log write failure. */
  AUDIT_FAILED: "ALIX_200",
} as const;

/** Union type of all stable error code strings. */
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// ---------------------------------------------------------------------------
// SafeError
// ---------------------------------------------------------------------------

/**
 * A safe, stable error that can be returned to external callers.
 *
 * - `code` — one of the `ErrorCodes` values.
 * - `message` — human-readable description (already redacted).
 * - `requestId` — optional correlation ID for operator debug.
 *
 * NEVER includes a stack trace or internal implementation details.
 */
export interface SafeError {
  code: ErrorCode;
  message: string;
  requestId?: string;
}

// ---------------------------------------------------------------------------
// Error code mapping
// ---------------------------------------------------------------------------

/**
 * Map an internal exception to a stable error code.
 *
 * Heuristic-based: checks `message` and `code` / `statusCode` / `status`
 * properties for well-known patterns.  Falls back to `INTERNAL_ERROR`.
 */
function classifyError(error: unknown): ErrorCode {
  const err = error as Record<string, unknown> | undefined;
  if (!err || typeof err !== "object") return ErrorCodes.INTERNAL_ERROR;

  const message = typeof err.message === "string" ? err.message : "";
  const code = typeof err.code === "string" ? err.code : "";
  const statusCode = typeof err.statusCode === "number" ? err.statusCode : typeof err.status === "number" ? (err.status as number) : 0;

  // HTTP-like status codes
  if (statusCode === 404 || code === "NOT_FOUND" || code === "ENOENT") {
    return ErrorCodes.NOT_FOUND;
  }
  if (statusCode === 429 || code === "RATE_LIMITED" || message.toLowerCase().includes("rate limit")) {
    return ErrorCodes.RATE_LIMITED;
  }
  if (statusCode === 401 || code === "UNAUTHORIZED" || message.toLowerCase().includes("unauthorized")) {
    return ErrorCodes.UNAUTHORIZED;
  }
  if (statusCode === 403 || code === "FORBIDDEN" || message.toLowerCase().includes("forbidden")) {
    return ErrorCodes.FORBIDDEN;
  }
  if (code === "CONFIG_ERROR" || message.toLowerCase().includes("config")) {
    return ErrorCodes.CONFIG_ERROR;
  }

  // Input validation
  if (
    code === "INVALID_INPUT" ||
    code === "ERR_INVALID_ARG_TYPE" ||
    code === "ERR_INVALID_ARG_VALUE" ||
    statusCode === 400
  ) {
    return ErrorCodes.INVALID_INPUT;
  }

  return ErrorCodes.INTERNAL_ERROR;
}

/**
 * Extract a stable message from an error.
 */
function extractMessage(error: unknown): string {
  if (error === null || error === undefined) return "Unknown error";
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    const s = String(error);
    return s.length > 200 ? s.slice(0, 200) + "..." : s;
  } catch {
    return "Unknown error";
  }
}

// ---------------------------------------------------------------------------
// toSafeError
// ---------------------------------------------------------------------------

/**
 * Convert an internal exception to a `SafeError`.
 *
 * The returned error NEVER contains stack trace or internal details.
 * When `messageOverride` is provided it is used instead of the raw error
 * message, allowing callers to supply a pre-redacted message.
 *
 * @param error — the original thrown value.
 * @param requestId — optional correlation ID for operator tracing.
 * @param messageOverride — optional pre-redacted message.  When omitted the
 *   raw error message is used (only use when the error is known to be free
 *   of secrets, or before a redactor has had a chance to run).
 */
export function toSafeError(
  error: unknown,
  requestId?: string,
  messageOverride?: string,
): SafeError {
  try {
    const code = classifyError(error);
    const message = messageOverride ?? extractMessage(error);

    return {
      code,
      message,
      ...(requestId ? { requestId } : {}),
    };
  } catch {
    // Paranoia: the error projector itself must never throw.
    return {
      code: ErrorCodes.INTERNAL_ERROR,
      message: "An internal error occurred",
      ...(requestId ? { requestId } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// redactAndLog
// ---------------------------------------------------------------------------

/**
 * Redact internal error details, log them (if a logger is available),
 * then return a `SafeError` for the caller.
 *
 * @param error — the original thrown value.
 * @param redactor — the `redactValue` function to sanitise details.
 * @param policy — redaction policy.
 * @param detector — secret detector.
 * @param logger — optional logger (e.g. `console`).
 */
export function redactAndLog(
  error: unknown,
  redactorImpl: typeof redactValue,
  policy: RedactionPolicy,
  detector: SecretDetector,
  logger?: { error: (msg: string) => void },
): SafeError {
  try {
    // Build a structured payload for internal logging
    const errorPayload: Record<string, unknown> = {
      message: extractMessage(error),
      code: classifyError(error),
    };

    // Add safe metadata
    if (error instanceof Error) {
      errorPayload.name = error.name;
    }

    // Redact the payload before logging
    let redactedPayload: unknown;
    try {
      redactedPayload = redactorImpl(errorPayload, policy, detector);
    } catch {
      redactedPayload = "[REDACTED]";
    }

    // Log (if logger provided)
    if (logger?.error) {
      try {
        logger.error(`[SafeError] ${JSON.stringify(redactedPayload)}`);
      } catch {
        // Best-effort logging
      }
    }

    // Build SafeError from the redacted payload so the caller never
    // receives the original unredacted message.
    const safeCode: ErrorCode = typeof redactedPayload === "object" && redactedPayload !== null
      ? (redactedPayload as Record<string, unknown>).code as ErrorCode ?? classifyError(error)
      : classifyError(error);

    const safeMessage: string = typeof redactedPayload === "object" && redactedPayload !== null
      ? String((redactedPayload as Record<string, unknown>).message ?? "An internal error occurred")
      : "An internal error occurred";

    return {
      code: safeCode,
      message: safeMessage,
    };
  } catch {
    return {
      code: ErrorCodes.INTERNAL_ERROR,
      message: "An internal error occurred",
    };
  }
}
