/**
 * X4.3 — Cancellation Token
 *
 * Cooperative cancellation primitive for governed execution.
 *
 * Enables external cancellation requests to propagate to in-progress
 * async executions without requiring thread interruption or forced
 * termination. Executors periodically check the token and stop
 * gracefully when cancellation is signalled.
 *
 * @invariant Token transitions from active → cancelled once, irreversibly.
 * @invariant Cancellation does not modify execution state — that is
 *   the responsibility of the state machine's cancel() transition.
 */

// ---------------------------------------------------------------------------
// CancelledError
// ---------------------------------------------------------------------------

/**
 * Error thrown when an operation is cancelled via CancellationToken.
 *
 * Different from IllegalStateTransitionError: this signals that the
 * *work* was cancelled, not that a state transition was illegal.
 * The state machine's cancel() handles the state transition separately.
 */
export class ExecutionCancelledError extends Error {
  readonly kind = "ExecutionCancelledError";
  readonly reason: string;

  constructor(reason: string) {
    super(`Execution cancelled: ${reason}`);
    this.name = "ExecutionCancelledError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// CancellationToken
// ---------------------------------------------------------------------------

export class CancellationToken {
  private _cancelled = false;
  private _reason = "";

  /** Whether cancellation has been requested. */
  get isCancelled(): boolean {
    return this._cancelled;
  }

  /** The reason provided when cancellation was requested. */
  get reason(): string {
    return this._reason;
  }

  /**
   * Request cancellation of the operation associated with this token.
   *
   * Idempotent — subsequent calls are no-ops.
   *
   * @param reason - Human-readable reason for cancellation.
   */
  cancel(reason: string): void {
    if (!this._cancelled) {
      this._cancelled = true;
      this._reason = reason;
    }
  }

  /**
   * Check cancellation and throw if the token has been cancelled.
   *
   * Callers (executors) invoke this at safe stopping points to
   * gracefully halt execution.
   *
   * @throws {ExecutionCancelledError} If the token has been cancelled.
   */
  throwIfCancelled(): void {
    if (this._cancelled) {
      throw new ExecutionCancelledError(this._reason);
    }
  }
}

// ---------------------------------------------------------------------------
// AbortSignal → ExecutionCancelledError bridge
// ---------------------------------------------------------------------------

/**
 * Derive the human reason from an aborted signal. Callers abort with a string
 * reason (see AgentSession.cancelActiveTurn); the default (AbortController
 * without a reason) yields `undefined`.
 */
function signalReason(signal: AbortSignal): string | undefined {
  const r = (signal as AbortSignal & { reason?: unknown }).reason;
  return typeof r === "string" && r.length > 0 ? r : undefined;
}

function cancelledError(signal: AbortSignal, fallbackReason?: string): ExecutionCancelledError {
  return new ExecutionCancelledError(
    signalReason(signal) ?? fallbackReason ?? "operation cancelled",
  );
}

/**
 * Await `operation`, racing it against an operator-cancel `signal`.
 *
 * Resolves with the operation's value when it settles first; rejects with an
 * `ExecutionCancelledError` the instant `signal` aborts (or immediately when
 * it already has). Exactly ONE abort listener is attached per call, and it is
 * removed when EITHER side settles — so racing a per-chunk/per-iteration
 * operation (provider `complete()` / each stream `next()`) never accumulates
 * listeners for the lifetime of a long turn.
 *
 * A genuine abort still rejects promptly: when the signal fires, the abort
 * handler detaches itself and rejects before any settled-operation race can
 * win. No wall-clock deadline is imposed — the pending operation itself is not
 * force-killed; the caller abandons it and its own transport contract
 * (idle/timeout) bounds it. Transport safety stays intact.
 */
export function raceWithCancellation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  fallbackReason?: string,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(cancelledError(signal, fallbackReason));
  }
  return new Promise<T>((resolve, reject) => {
    // `detached` guards double-detach when both sides settle in the same tick
    // (abort fires while the operation resolves). The operation's own
    // then-handler always runs, so it must never double-remove or resolve
    // after the abort rejection.
    let detached = false;
    const detach = (): void => {
      if (!detached) {
        detached = true;
        signal.removeEventListener("abort", onAbort);
      }
    };
    const onAbort = (): void => {
      // Abort won the race: reject now. The `once: true` registration already
      // removed the listener; mark detached so the operation's settle handler
      // (which may run later) does not try again or resolve the promise.
      detached = true;
      reject(cancelledError(signal, fallbackReason));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        detach();
        resolve(value);
      },
      (err: unknown) => {
        detach();
        reject(err);
      },
    );
  });
}
