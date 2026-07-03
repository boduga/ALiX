/**
 * #175 — Typed retry primitive for external side effects.
 *
 * Wraps a Promise-returning operation with exponential backoff retry.
 * Intended for idempotent boundaries where transient failures can be
 * safely retried — not wired into any boundary yet.
 */

import { buildRuntimeDiagnostic, type RuntimeDiagnostic } from "./runtime-diagnostics.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class RetryError extends Error {
  readonly kind = "RetryError";
  public readonly operation: string;
  public readonly attempts: number;
  public readonly lastError: unknown;

  constructor(operation: string, attempts: number, lastError: unknown) {
    super(`Operation "${operation}" failed after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    this.name = "RetryError";
    this.operation = operation;
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Maximum number of retry attempts (not counting the initial try). */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (caps exponential growth). */
  maxDelayMs: number;
  /**
   * Optional predicate to decide whether an error is retryable.
   * Default: retry on SideEffectTimeoutError, reject everything else.
   */
  shouldRetry?: (error: unknown) => boolean;
}

const DEFAULT_POLICY: RetryPolicy = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the delay before the next retry attempt using exponential backoff
 * with full jitter: delay = random(0, min(base * 2^attempt, max)).
 */
function computeDelay(attempt: number, policy: RetryPolicy): number {
  const base = policy.baseDelayMs * Math.pow(2, attempt);
  const cap = Math.min(base, policy.maxDelayMs);
  return Math.random() * cap;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Primitive
// ---------------------------------------------------------------------------

/**
 * Wraps a Promise-returning operation with exponential backoff retry.
 *
 * - Calls the effect function.
 * - On success: returns the result.
 * - On failure: checks `policy.shouldRetry`. If retryable, waits with
 *   exponential backoff and retries. If not retryable, rejects immediately.
 * - After exhausting all retries, rejects with `RetryError` wrapping the
 *   last error.
 *
 * @param operation — Human-readable label (e.g. "shell.run", "provider.complete")
 * @param policy — RetryPolicy config (defaults: 2 retries, 500ms base, 10s max)
 * @param effect — Zero-argument async function returning T
 */
export async function withRetry<T>(
  operation: string,
  effect: () => Promise<T>,
  policy: Partial<RetryPolicy> = {},
  onDiagnostic?: (diag: RuntimeDiagnostic) => void,
): Promise<T> {
  const merged: RetryPolicy = { ...DEFAULT_POLICY, ...policy };
  const shouldRetry = merged.shouldRetry ?? ((err) => err instanceof Error && err.name === "SideEffectTimeoutError");

  let lastError: unknown;

  for (let attempt = 0; attempt <= merged.maxRetries; attempt++) {
    try {
      return await effect();
    } catch (err: unknown) {
      // Non-retryable error — reject immediately with the original error
      if (!shouldRetry(err)) {
        throw err;
      }
      // Exhausted retries — emit diagnostic, wrap in RetryError
      if (attempt >= merged.maxRetries) {
        if (onDiagnostic) {
          onDiagnostic(buildRuntimeDiagnostic(
            "retry.exhausted",
            operation,
            `failed after ${attempt + 1} attempt(s)`,
            { attempt: attempt + 1, maxRetries: merged.maxRetries },
          ));
        }
        throw new RetryError(operation, attempt + 1, err);
      }
      // Emit diagnostic on retry attempt
      if (onDiagnostic) {
        onDiagnostic(buildRuntimeDiagnostic(
          "retry.attempt",
          operation,
          `retrying after error: ${err instanceof Error ? err.message : String(err)}`,
          { attempt: attempt + 1, maxRetries: merged.maxRetries },
        ));
      }
      // Retry with backoff
      const delay = computeDelay(attempt, merged);
      await sleep(delay);
    }
  }

  // Fallback — should not reach if loop handles all cases
  throw new RetryError(operation, merged.maxRetries + 1, lastError);
}
