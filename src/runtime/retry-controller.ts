/**
 * X4.2 — Retry Controller
 *
 * Adds bounded retry capability to the ExecutionStateMachine.
 * Manages attempt tracking, backoff strategies, and retry boundaries
 * for execution attempts under a single ExecutionIntent.
 *
 * X4.3 adds cooperative cancellation via CancellationToken.
 * External actors call cancel() to signal in-progress executions
 * and prevent further retries.
 *
 * Retries never modify the original intent. Each attempt creates a new
 * execution context with an incremented attemptNumber.
 *
 * @invariant maxAttempts >= 1 (at least one attempt always runs)
 * @invariant Retries create new executions under the same intentId
 * @invariant Every retry event emits ExecutionEvidence
 */

import {
  ExecutionState,
  type ExecutionEvidenceEmitter,
  type ExecutionEventType,
  type RetryPolicy,
  type ExecutionResult,
} from "./contracts/execution-runtime-contract.js";
import type { ExecutionIntent, ExecutionEvidence } from "./contracts/execution-intent-contract.js";
import { ExecutionStateMachine } from "./execution-state-machine.js";
import { CancellationToken, ExecutionCancelledError } from "./cancellation-token.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffMs(attempt: number, policy: RetryPolicy): number {
  const s = policy.backoffStrategy;
  switch (s.kind) {
    case "immediate":
      return 0;
    case "fixed":
      return s.intervalMs;
    case "exponential": {
      const delay = s.baseMs * Math.pow(2, attempt - 1);
      return Math.min(delay, s.maxMs);
    }
  }
}

function isRetryable(executionId: string, policy: RetryPolicy): boolean {
  // If retryableFailures is empty, all failures are retryable
  if (policy.retryableFailures.length === 0) return true;
  // ExecutionId-based check — in future this will examine failure type
  return policy.retryableFailures.includes("*");
}

// ---------------------------------------------------------------------------
// Evidence ID generation for retry events
// ---------------------------------------------------------------------------

const RETRY_EVIDENCE_PREFIX = "rtev-";
let retryCounter = 0;

function generateRetryEvidenceId(): string {
  retryCounter++;
  return `${RETRY_EVIDENCE_PREFIX}${Date.now().toString(36)}-${retryCounter}`;
}

// ---------------------------------------------------------------------------
// RetryController
// ---------------------------------------------------------------------------

export class RetryController {
  private readonly emitter: ExecutionEvidenceEmitter;
  /** Cancellation tokens keyed by executionId. */
  private readonly tokens = new Map<string, CancellationToken>();
  /** Set to true when cancel() is called — prevents further retries. */
  private retryAborted = false;
  /** Set to true when the loop breaks due to an unknown executor error. */
  private loopAborted = false;

  constructor(
    private readonly stateMachine: ExecutionStateMachine,
    private readonly policy: RetryPolicy,
    emitter?: ExecutionEvidenceEmitter,
  ) {
    this.emitter = emitter ?? {
      emit(_eventType: ExecutionEventType, _evidence: ExecutionEvidence): void {
        // No-op fallback
      },
    };
  }

  // -----------------------------------------------------------------------
  // Cancellation API
  // -----------------------------------------------------------------------

  /**
   * Request cancellation of an in-progress or pending execution attempt.
   *
   * Signals the CancellationToken for the given execution (enabling
   * cooperative cancellation in the executor) and transitions the
   * execution state to CANCELLED.
   *
   * Also marks the retry sequence as aborted so no further attempts
   * will be started.
   *
   * @param executionId - The execution attempt to cancel.
   * @param reason - Optional reason for cancellation (default: "user requested").
   * @throws {UnknownExecutionError} If executionId does not exist.
   * @throws {IllegalStateTransitionError} If execution is in a terminal state.
   */
  async cancel(executionId: string, reason = "user requested"): Promise<void> {
    // Signal the token first for cooperative cancellation
    const token = this.tokens.get(executionId);
    if (token && !token.isCancelled) {
      token.cancel(reason);
    }

    // Prevent any future retry from starting
    this.retryAborted = true;

    // Delegate state transition to the state machine
    await this.stateMachine.cancel(executionId);
  }

  // -----------------------------------------------------------------------
  // Execution with retry
  // -----------------------------------------------------------------------

  /**
   * Execute an intent with retry and cancellation support.
   *
   * Each attempt follows the full lifecycle through the state machine.
   * On failure, the policy determines whether to retry and with what
   * backoff. On exhaustion, returns FAILED with retry-exhausted evidence.
   *
   * The executor may accept an optional CancellationToken to support
   * cooperative cancellation. If the token is cancelled during execution,
   * the executor should return early or throw ExecutionCancelledError.
   *
   * @param intent - The execution intent to execute.
   * @param executor - Async function that performs the actual execution work.
   *   May accept an optional CancellationToken. Should return true for
   *   success, false for failure.
   * @returns The terminal ExecutionResult from the final attempt.
   */
  async executeWithRetry(
    intent: ExecutionIntent,
    executor: (token?: CancellationToken) => Promise<boolean>,
  ): Promise<ExecutionResult> {
    let lastResult: ExecutionResult | undefined;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      // Check cancellation before starting a new attempt
      if (this.retryAborted) {
        return lastResult ?? {
          executionId: "",
          intentId: intent.intentId,
          state: ExecutionState.CANCELLED,
        };
      }

      const exId = this.stateMachine.createExecution(intent, attempt);
      const token = new CancellationToken();
      this.tokens.set(exId, token);

      // Drive lifecycle through to RUNNING
      this.stateMachine.transitionTo(exId, ExecutionState.VALIDATING);
      this.stateMachine.transitionTo(exId, ExecutionState.READY);
      this.stateMachine.transitionTo(exId, ExecutionState.RUNNING);

      // Execute the action with cancellation support
      let success: boolean;
      try {
        success = await executor(token);
      } catch (err) {
        // If the executor threw due to cancellation, handle gracefully
        if (err instanceof ExecutionCancelledError) {
          // Transition the state machine to CANCELLED so the execution
          // isn't left dangling in RUNNING
          try {
            await this.stateMachine.cancel(exId);
          } catch {
            // Best-effort: the state machine may have already transitioned
          }
          return {
            executionId: exId,
            intentId: intent.intentId,
            state: ExecutionState.CANCELLED,
            evidenceId: this.stateMachine.getLatestEvidenceId(exId),
          };
        }
        // Unknown error — treat as failure
        this.stateMachine.transitionTo(exId, ExecutionState.FAILED);
        this.loopAborted = true;
        lastResult = {
          executionId: exId,
          intentId: intent.intentId,
          state: ExecutionState.FAILED,
          evidenceId: this.stateMachine.getLatestEvidenceId(exId),
        };
        // Don't retry on unknown errors
        break;
      }

      if (success) {
        this.stateMachine.transitionTo(exId, ExecutionState.SUCCEEDED);
        return {
          executionId: exId,
          intentId: intent.intentId,
          state: ExecutionState.SUCCEEDED,
          evidenceId: this.stateMachine.getLatestEvidenceId(exId),
        };
      }

      // Attempt failed — transition to FAILED
      this.stateMachine.transitionTo(exId, ExecutionState.FAILED);

      lastResult = {
        executionId: exId,
        intentId: intent.intentId,
        state: ExecutionState.FAILED,
        evidenceId: this.stateMachine.getLatestEvidenceId(exId),
      };

      // Check retry eligibility (respect cancellation)
      if (
        attempt < this.policy.maxAttempts &&
        isRetryable(exId, this.policy) &&
        !this.retryAborted
      ) {
        this.emitRetryEvidence(
          intent,
          attempt,
          this.policy.maxAttempts,
          `retrying attempt ${attempt}/${this.policy.maxAttempts}`,
        );

        const delay = computeBackoffMs(attempt, this.policy);
        if (delay > 0) {
          // Check cancellation during backoff
          const cancelled = await this.sleepWithCancellation(delay, token);
          if (cancelled) {
            // If retry was aborted via controller.cancel(), return CANCELLED
            // rather than FAILED, so the caller knows cancellation won
            if (this.retryAborted) {
              return {
                executionId: lastResult?.executionId ?? "",
                intentId: intent.intentId,
                state: ExecutionState.CANCELLED,
              };
            }
            return lastResult;
          }
        }
      }
    }

    // All retries exhausted (only if we had retries to exhaust
    // and the loop wasn't aborted by an unknown error)
    if (this.policy.maxAttempts > 1 && !this.loopAborted) {
      this.emitRetryEvidence(
        intent,
        this.policy.maxAttempts,
        this.policy.maxAttempts,
        "retries exhausted",
        "ExecutionRetryExhausted",
      );
    }

    return lastResult!;
  }

  // -----------------------------------------------------------------------
  // Internal — cancellation-aware sleep
  // -----------------------------------------------------------------------

  /**
   * Sleep for the given duration but wake early if the retry sequence
   * has been cancelled. Returns true if cancelled during sleep.
   */
  private async sleepWithCancellation(ms: number, token?: CancellationToken): Promise<boolean> {
    if (this.retryAborted) return true;

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        clearInterval(interval);
        resolve(false);
      }, ms);

      // Poll cancellation every 50ms to keep latency low.
      // Checks both the runtime-level abort flag and the
      // executor-level token.
      const interval = setInterval(() => {
        if (this.retryAborted || (token && token.isCancelled)) {
          clearTimeout(timer);
          clearInterval(interval);
          resolve(true);
        }
      }, 50);
    });
  }

  // -----------------------------------------------------------------------
  // Internal — retry evidence
  // -----------------------------------------------------------------------

  private emitRetryEvidence(
    intent: ExecutionIntent,
    attempt: number,
    maxAttempts: number,
    summary: string,
    eventType: ExecutionEventType = "ExecutionRetryAttempted",
  ): void {
    const now = new Date().toISOString();
    const evidence: ExecutionEvidence = {
      evidenceId: generateRetryEvidenceId(),
      intentId: intent.intentId,
      startedAt: now,
      completedAt: now,
      outcome: "PARTIAL",
      summary: `Execution ${eventType}: ${summary}`,
      artifacts: [],
      verificationPassed: false,
      evidenceHash: "",
    };

    this.emitter.emit(eventType, evidence);
  }
}
