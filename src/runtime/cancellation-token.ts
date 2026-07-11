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
