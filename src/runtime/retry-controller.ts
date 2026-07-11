/**
 * X4.2 — Retry Controller
 *
 * Adds bounded retry capability to the ExecutionStateMachine.
 * Manages attempt tracking, backoff strategies, and retry boundaries
 * for execution attempts under a single ExecutionIntent.
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

  /**
   * Execute an intent with retry support.
   *
   * Each attempt follows the full lifecycle through the state machine.
   * On failure, the policy determines whether to retry and with what
   * backoff. On exhaustion, returns FAILED with retry-exhausted evidence.
   *
   * @param intent - The execution intent to execute.
   * @param executor - Async function that performs the actual execution work.
   *   Should return true for success, false for failure.
   * @returns The terminal ExecutionResult from the final attempt.
   */
  async executeWithRetry(
    intent: ExecutionIntent,
    executor: () => Promise<boolean>,
  ): Promise<ExecutionResult> {
    let lastResult: ExecutionResult | undefined;

    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt++) {
      const exId = this.stateMachine.createExecution(intent, attempt);

      // Drive lifecycle through to RUNNING
      this.stateMachine.transitionTo(exId, ExecutionState.VALIDATING);
      this.stateMachine.transitionTo(exId, ExecutionState.READY);
      this.stateMachine.transitionTo(exId, ExecutionState.RUNNING);

      // Execute the action
      const success = await executor();

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

      // Check retry eligibility
      if (attempt < this.policy.maxAttempts && isRetryable(exId, this.policy)) {
        this.emitRetryEvidence(
          intent,
          attempt,
          this.policy.maxAttempts,
          `retrying attempt ${attempt}/${this.policy.maxAttempts}`,
        );

        const delay = computeBackoffMs(attempt, this.policy);
        if (delay > 0) {
          await sleep(delay);
        }
      }
    }

    // All retries exhausted (only if we had retries to exhaust)
    if (this.policy.maxAttempts > 1) {
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
