/**
 * #172 — Typed timeout primitive for external side effects.
 *
 * Wraps a Promise-returning operation with a configurable timeout.
 * Intended as the foundation for hardening shell, file, provider, and
 * MCP call boundaries — no wiring into those boundaries yet.
 */

import { buildRuntimeDiagnostic, type RuntimeDiagnostic } from "./runtime-diagnostics.js";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class SideEffectTimeoutError extends Error {
  readonly kind = "SideEffectTimeoutError";
  public readonly operation: string;
  public readonly timeoutMs: number;
  public readonly cause?: Error;

  constructor(operation: string, timeoutMs: number, cause?: Error) {
    super(`Side-effect "${operation}" timed out after ${timeoutMs}ms`);
    this.name = "SideEffectTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Primitive
// ---------------------------------------------------------------------------

/**
 * Wraps a Promise-returning side effect with a timeout.
 *
 * - Resolves with the effect's result if it completes before the timeout.
 * - Rejects with `SideEffectTimeoutError` if the timeout expires.
 * - Rejects with the original error if the effect throws before timeout.
 *
 * The underlying operation is NOT cancelled — the returned promise
 * rejects, but the operation continues executing (fire-and-forget).
 * True cancellation requires an `AbortSignal` passed into the operation,
 * which is the responsibility of the caller to coordinate.
 *
 * @param operation — Human-readable label (e.g. "shell.run", "file.read")
 * @param timeoutMs — Maximum wall-clock time in milliseconds
 * @param effect — Zero-argument async function returning T
 */
export function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  effect: () => Promise<T>,
  onDiagnostic?: (diag: RuntimeDiagnostic) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (onDiagnostic) {
        onDiagnostic(buildRuntimeDiagnostic("timeout", operation, `timed out after ${timeoutMs}ms`, { timeoutMs }));
      }
      reject(new SideEffectTimeoutError(operation, timeoutMs));
    }, timeoutMs);

    Promise.resolve()
      .then(() => effect())
      .then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err);
        },
      );
  });
}
