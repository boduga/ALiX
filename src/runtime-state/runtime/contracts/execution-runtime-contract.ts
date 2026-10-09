/**
 * X4 — Governed Execution Runtime Contracts
 *
 * Defines the execution lifecycle state machine, runtime controller interface,
 * and supporting types for governed execution.
 *
 * Invariant: X4 controls execution mechanics. Governance remains
 * observational and external.
 *
 * @module execution-runtime-contract
 */

import type { ExecutionIntent, ExecutionEvidence } from "./execution-intent-contract.js";

// ─── Execution State ─────────────────────────────────────────────────

/**
 * Lifecycle states for a governed execution.
 *
 * Transitions follow a directed graph:
 *
 *   CREATED → VALIDATING → READY → RUNNING → SUCCEEDED
 *                              ↘         ↘
 *                            CANCELLED   FAILED → ROLLED_BACK
 *
 * Terminal states: SUCCEEDED, FAILED, CANCELLED, ROLLED_BACK
 */
export enum ExecutionState {
  CREATED = "CREATED",
  VALIDATING = "VALIDATING",
  READY = "READY",
  RUNNING = "RUNNING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  ROLLED_BACK = "ROLLED_BACK",
}

// ─── Execution Context ───────────────────────────────────────────────

/**
 * Runtime context for a single execution attempt.
 *
 * Tracks identity, current state, attempt number, timing, and
 * arbitrary metadata for the duration of the execution lifecycle.
 */
export interface ExecutionContext {
  /** Unique identifier for this execution attempt. */
  executionId: string;
  /** The intent this execution belongs to. */
  intentId: string;
  /** Current lifecycle state. */
  state: ExecutionState;
  /** Which attempt this is within the intent's retry sequence. */
  attemptNumber: number;
  /** When this execution context was created. */
  createdAt: Date;
  /** When execution entered RUNNING state (if applicable). */
  startedAt?: Date;
  /** When execution reached a terminal state (if applicable). */
  completedAt?: Date;
  /** Extensible metadata for consumers. */
  metadata: Record<string, unknown>;
}

// ─── Execution Result ────────────────────────────────────────────────

/**
 * Terminal outcome of an execution attempt.
 */
export interface ExecutionResult {
  executionId: string;
  intentId: string;
  state: ExecutionState.SUCCEEDED | ExecutionState.FAILED | ExecutionState.CANCELLED | ExecutionState.ROLLED_BACK;
  /** Evidence ID of the terminal transition evidence record. */
  evidenceId?: string;
}

// ─── Evidence Emission ───────────────────────────────────────────────

/**
 * Event types emitted by the runtime at each lifecycle transition.
 *
 * Maps one-to-one with ExecutionState transitions.
 */
export type ExecutionEventType =
  | "ExecutionCreated"
  | "ExecutionValidationStarted"
  | "ExecutionReady"
  | "ExecutionStarted"
  | "ExecutionCompleted"
  | "ExecutionFailed"
  | "ExecutionCancelled"
  | "ExecutionRollbackCompleted"
  | "ExecutionRetryAttempted"
  | "ExecutionRetryExhausted";

/**
 * Boundary interface between the runtime and evidence persistence.
 *
 * X4 emits evidence through this interface. Persistence is X3b's
 * responsibility and is wired separately (X4.5).
 */
export interface ExecutionEvidenceEmitter {
  /**
   * Emit one execution evidence record.
   *
   * Implementations may write to X3b store, buffer for batch
   * persistence, or collect in memory for testing.
   */
  emit(eventType: ExecutionEventType, evidence: ExecutionEvidence): void;
}

// ─── Retry Policy ─────────────────────────────────────────────────────

/**
 * Backoff strategy between retry attempts.
 */
export type BackoffStrategy =
  | { kind: "fixed"; intervalMs: number }
  | { kind: "exponential"; baseMs: number; maxMs: number }
  | { kind: "immediate" };

/**
 * Retry policy for execution attempts.
 *
 * Defines boundaries and backoff behavior when an execution attempt
 * reaches the FAILED state.
 *
 * @invariant maxAttempts >= 1
 */
export interface RetryPolicy {
  /** Maximum number of execution attempts (including the first). */
  maxAttempts: number;
  /** Failure types eligible for retry (match against summary prefix). */
  retryableFailures: string[];
  /** Backoff strategy between attempts. */
  backoffStrategy: BackoffStrategy;
}

// ─── Rollback Intent ──────────────────────────────────────────────────

/**
 * Describes a rollback action to undo a previous execution.
 *
 * X4 does not decide when rollback is appropriate — that decision
 * belongs to governance. X4 records and executes the supplied
 * RollbackIntent.
 */
export interface RollbackIntent {
  /** The FAILED execution to roll back. */
  executionId: string;
  /** The original intent ID. */
  intentId: string;
  /** Description of the rollback action to perform. */
  action: string;
  /** Parameters for the rollback action. */
  parameters: Record<string, unknown>;
  /** Why rollback was requested. */
  reason: string;
  /** When the rollback intent was created. */
  createdAt: string;
  /** Evidence ID that triggered the rollback decision. */
  sourceEvidenceId: string;
}

// ─── Runtime Controller Interface ────────────────────────────────────

/**
 * Governed execution runtime controller.
 *
 * Manages the full execution lifecycle for approved ExecutionIntent
 * contracts. Every state transition emits evidence through the
 * configured emitter.
 *
 * @invariant Every execution follows deterministic state transitions.
 * @invariant Terminal states are immutable.
 * @invariant Every transition emits ExecutionEvidence.
 */
export interface ExecutionRuntime {
  /**
   * Execute an approved ExecutionIntent through the full lifecycle.
   *
   * Lifecycle: CREATED → VALIDATING → READY → RUNNING → SUCCEEDED
   * Failure:   RUNNING → FAILED
   *
   * @param intent - Approved execution intent to execute.
   * @returns Terminal execution result.
   * @throws {DuplicateExecutionError} If the intent is already being executed.
   */
  execute(intent: ExecutionIntent): Promise<ExecutionResult>;

  /**
   * Request cancellation of a READY or RUNNING execution.
   *
   * Allowed: READY → CANCELLED, RUNNING → CANCELLED
   *
   * @param executionId - Execution attempt to cancel.
   * @throws {UnknownExecutionError} If executionId does not exist.
   * @throws {IllegalStateTransitionError} If execution is in a terminal state.
   */
  cancel(executionId: string): Promise<void>;

  /**
   * Request rollback of a FAILED execution.
   *
   * Allowed: FAILED → ROLLED_BACK
   *
   * @param executionId - Execution attempt to roll back.
   * @throws {UnknownExecutionError} If executionId does not exist.
   * @throws {IllegalStateTransitionError} If execution is not in FAILED state.
   */
  rollback(executionId: string): Promise<void>;

  /**
   * Get the current lifecycle state of an execution.
   *
   * @param executionId - Execution attempt to query.
   * @returns Current ExecutionState.
   * @throws {UnknownExecutionError} If executionId does not exist.
   */
  getStatus(executionId: string): ExecutionState;
}

// ─── Runtime Errors ──────────────────────────────────────────────────

/**
 * Error thrown when an illegal state transition is attempted.
 */
export class IllegalStateTransitionError extends Error {
  readonly kind = "IllegalStateTransitionError";
  readonly executionId: string;
  readonly currentState: ExecutionState;
  readonly requestedState: ExecutionState;

  constructor(
    executionId: string,
    currentState: ExecutionState,
    requestedState: ExecutionState,
  ) {
    super(
      `Illegal transition: ${currentState} → ${requestedState} for execution ${executionId}`,
    );
    this.name = "IllegalStateTransitionError";
    this.executionId = executionId;
    this.currentState = currentState;
    this.requestedState = requestedState;
  }
}

/**
 * Error thrown when an operation targets a non-existent execution.
 */
export class UnknownExecutionError extends Error {
  readonly kind = "UnknownExecutionError";
  readonly executionId: string;

  constructor(executionId: string) {
    super(`Unknown execution: ${executionId}`);
    this.name = "UnknownExecutionError";
    this.executionId = executionId;
  }
}

/**
 * Error thrown when an execution context already exists for the given
 * intent or executionId.
 */
export class DuplicateExecutionError extends Error {
  readonly kind = "DuplicateExecutionError";
  readonly executionId: string;

  constructor(executionId: string) {
    super(`Duplicate execution: ${executionId}`);
    this.name = "DuplicateExecutionError";
    this.executionId = executionId;
  }
}
