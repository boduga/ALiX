/**
 * X4.1 — Execution State Machine
 *
 * In-memory implementation of the governed execution runtime controller.
 * Manages deterministic state transitions, execution context tracking,
 * and evidence emission for every lifecycle event.
 *
 * @invariant Every execution follows explicit, validated state transitions.
 * @invariant Terminal states are immutable.
 * @invariant Every transition emits ExecutionEvidence.
 */

import { randomUUID } from "node:crypto";
import {
  ExecutionState,
  IllegalStateTransitionError,
  UnknownExecutionError,
  DuplicateExecutionError,
  type ExecutionContext,
  type ExecutionEvidenceEmitter,
  type ExecutionResult,
  type ExecutionRuntime,
  type ExecutionEventType,
} from "./contracts/execution-runtime-contract.js";
import type { ExecutionIntent, ExecutionEvidence } from "./contracts/execution-intent-contract.js";

// ---------------------------------------------------------------------------
// Domain prefix for evidence IDs
// ---------------------------------------------------------------------------

const EXECUTION_ID_PREFIX = "exec-";

// ---------------------------------------------------------------------------
// Transition table
// ---------------------------------------------------------------------------

/**
 * Adjacency list of all allowed state transitions.
 * Any transition not in this table is illegal.
 */
const ALLOWED_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  [ExecutionState.CREATED]: [ExecutionState.VALIDATING],
  [ExecutionState.VALIDATING]: [ExecutionState.READY, ExecutionState.FAILED],
  [ExecutionState.READY]: [ExecutionState.RUNNING, ExecutionState.CANCELLED],
  [ExecutionState.RUNNING]: [ExecutionState.SUCCEEDED, ExecutionState.FAILED, ExecutionState.CANCELLED],
  [ExecutionState.SUCCEEDED]: [],
  [ExecutionState.FAILED]: [ExecutionState.ROLLED_BACK],
  [ExecutionState.CANCELLED]: [],
  [ExecutionState.ROLLED_BACK]: [],
};

/**
 * States that cannot transition further.
 *
 * FAILED is intentionally excluded: it is terminal for execution outcome
 * but can still transition to ROLLED_BACK.
 */
const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  ExecutionState.SUCCEEDED,
  ExecutionState.CANCELLED,
  ExecutionState.ROLLED_BACK,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateExecutionId(): string {
  return `${EXECUTION_ID_PREFIX}${randomUUID().slice(0, 8)}`;
}

/**
 * Map the target state of a transition to the corresponding
 * event type for evidence emission.
 *
 * Uses target state rather than (from, to) pairs because multiple
 * sources can lead to the same target (e.g., both VALIDATING and
 * RUNNING can transition to FAILED).
 */
function targetToEventType(to: ExecutionState): ExecutionEventType {
  switch (to) {
    case ExecutionState.CREATED: return "ExecutionCreated";
    case ExecutionState.VALIDATING: return "ExecutionValidationStarted";
    case ExecutionState.READY: return "ExecutionReady";
    case ExecutionState.RUNNING: return "ExecutionStarted";
    case ExecutionState.SUCCEEDED: return "ExecutionCompleted";
    case ExecutionState.FAILED: return "ExecutionFailed";
    case ExecutionState.CANCELLED: return "ExecutionCancelled";
    case ExecutionState.ROLLED_BACK: return "ExecutionRollbackCompleted";
  }
}

function stateToOutcome(state: ExecutionState): "SUCCESS" | "FAILED" | "PARTIAL" {
  switch (state) {
    case ExecutionState.SUCCEEDED: return "SUCCESS";
    case ExecutionState.FAILED:
    case ExecutionState.CANCELLED: return "FAILED";
    case ExecutionState.ROLLED_BACK: return "PARTIAL";
    default: return "PARTIAL";
  }
}

function stateToVerificationPassed(state: ExecutionState): boolean {
  return state === ExecutionState.SUCCEEDED || state === ExecutionState.ROLLED_BACK;
}

// ---------------------------------------------------------------------------
// ExecutionStateMachine
// ---------------------------------------------------------------------------

export class ExecutionStateMachine implements ExecutionRuntime {
  private readonly contexts = new Map<string, ExecutionContext>();
  private readonly latestEvidenceIds = new Map<string, string>();
  private readonly emitter: ExecutionEvidenceEmitter;

  constructor(emitter: ExecutionEvidenceEmitter) {
    this.emitter = emitter;
  }

  // -----------------------------------------------------------------------
  // Execution creation
  // -----------------------------------------------------------------------

  /**
   * Create a new execution in CREATED state without running through
   * the full lifecycle.
   *
   * This is the low-level entry point for creating executions at a
   * specific state. Use `execute()` for the full lifecycle.
   *
   * @param intent - The execution intent.
   * @param attemptNumber - Optional attempt number (defaults to 1).
   *   Used by RetryController to track retry sequence.
   */
  createExecution(intent: ExecutionIntent, attemptNumber?: number): string {
    const executionId = generateExecutionId();

    if (this.contexts.has(executionId)) {
      throw new DuplicateExecutionError(executionId);
    }

    const now = new Date();
    const context: ExecutionContext = {
      executionId,
      intentId: intent.intentId,
      state: ExecutionState.CREATED,
      attemptNumber: attemptNumber ?? 1,
      createdAt: now,
      metadata: {},
    };

    this.contexts.set(executionId, context);
    this.emitEvidence(context, ExecutionState.CREATED, ExecutionState.CREATED, now.toISOString());
    return executionId;
  }

  // -----------------------------------------------------------------------
  // ExecutionRuntime — execute
  // -----------------------------------------------------------------------

  async execute(intent: ExecutionIntent): Promise<ExecutionResult> {
    const executionId = this.createExecution(intent);

    // CREATED → VALIDATING
    this.transitionTo(executionId, ExecutionState.VALIDATING);
    // VALIDATING → READY
    this.transitionTo(executionId, ExecutionState.READY);
    // READY → RUNNING (transitionTo auto-sets startedAt)
    this.transitionTo(executionId, ExecutionState.RUNNING);
    // RUNNING → SUCCEEDED (transitionTo auto-sets completedAt)
    this.transitionTo(executionId, ExecutionState.SUCCEEDED);

    return {
      executionId,
      intentId: intent.intentId,
      state: ExecutionState.SUCCEEDED,
      evidenceId: this.latestEvidenceIds.get(executionId),
    };
  }

  // -----------------------------------------------------------------------
  // ExecutionRuntime — cancel
  // -----------------------------------------------------------------------

  async cancel(executionId: string): Promise<void> {
    const context = this.getContextOrThrow(executionId);
    const current = context.state;

    if (current === ExecutionState.READY) {
      this.updateContext(executionId, { completedAt: new Date() });
      this.transitionTo(executionId, ExecutionState.CANCELLED);
    } else if (current === ExecutionState.RUNNING) {
      this.updateContext(executionId, { completedAt: new Date() });
      this.transitionTo(executionId, ExecutionState.CANCELLED);
    } else {
      throw new IllegalStateTransitionError(executionId, current, ExecutionState.CANCELLED);
    }
  }

  // -----------------------------------------------------------------------
  // ExecutionRuntime — rollback
  // -----------------------------------------------------------------------

  async rollback(executionId: string): Promise<void> {
    const context = this.getContextOrThrow(executionId);

    if (context.state !== ExecutionState.FAILED) {
      throw new IllegalStateTransitionError(executionId, context.state, ExecutionState.ROLLED_BACK);
    }

    this.updateContext(executionId, { completedAt: new Date() });
    this.transitionTo(executionId, ExecutionState.ROLLED_BACK);
  }

  // -----------------------------------------------------------------------
  // ExecutionRuntime — getStatus
  // -----------------------------------------------------------------------

  getStatus(executionId: string): ExecutionState {
    return this.getContextOrThrow(executionId).state;
  }

  // -----------------------------------------------------------------------
  // Public — accessors
  // -----------------------------------------------------------------------

  /**
   * Return the latest evidenceId emitted for the given execution.
   * Returns undefined if no evidence has been emitted yet.
   */
  getLatestEvidenceId(executionId: string): string | undefined {
    return this.latestEvidenceIds.get(executionId);
  }

  // -----------------------------------------------------------------------
  // Public — transition engine (testable)
  // -----------------------------------------------------------------------

  /**
   * Execute a validated state transition.
   *
   * Checks legality, updates context state, emits evidence.
   * Throws if the transition is not in the allowed table or
   * if the current state is terminal.
   */
  transitionTo(executionId: string, to: ExecutionState): void {
    const context = this.getContextOrThrow(executionId);
    const from = context.state;

    if (TERMINAL_STATES.has(from)) {
      throw new IllegalStateTransitionError(executionId, from, to);
    }

    const allowed = ALLOWED_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new IllegalStateTransitionError(executionId, from, to);
    }

    // Auto-set timestamps on lifecycle boundaries
    if (to === ExecutionState.RUNNING && !context.startedAt) {
      this.updateContext(executionId, { startedAt: new Date() });
    }
    if (TERMINAL_STATES.has(to) || to === ExecutionState.FAILED) {
      // FAILED is terminal for execution outcome though it can transition to ROLLED_BACK
      this.updateContext(executionId, { completedAt: new Date() });
    }

    this.updateContext(executionId, { state: to });
    const now = new Date().toISOString();
    this.emitEvidence(context, from, to, now);
  }

  // -----------------------------------------------------------------------
  // Internal — context helpers
  // -----------------------------------------------------------------------

  private getContextOrThrow(executionId: string): ExecutionContext {
    const context = this.contexts.get(executionId);
    if (!context) {
      throw new UnknownExecutionError(executionId);
    }
    return context;
  }

  private updateContext(executionId: string, patch: Partial<ExecutionContext>): void {
    const existing = this.contexts.get(executionId);
    if (!existing) return;
    this.contexts.set(executionId, { ...existing, ...patch });
  }

  // -----------------------------------------------------------------------
  // Internal — evidence emission
  // -----------------------------------------------------------------------

  private emitEvidence(
    context: ExecutionContext,
    from: ExecutionState,
    to: ExecutionState,
    timestamp: string,
  ): void {
    const evidenceId = `${EXECUTION_ID_PREFIX}ev-${randomUUID().slice(0, 8)}`;
    this.latestEvidenceIds.set(context.executionId, evidenceId);

    const eventType = targetToEventType(to);

    const evidence: ExecutionEvidence = {
      evidenceId,
      intentId: context.intentId,
      startedAt: context.startedAt?.toISOString() ?? timestamp,
      completedAt: context.completedAt?.toISOString() ?? timestamp,
      outcome: stateToOutcome(to),
      summary: `Execution ${eventType}: ${from} → ${to}`,
      artifacts: [],
      verificationPassed: stateToVerificationPassed(to),
      evidenceHash: "",
    };

    this.emitter.emit(eventType, evidence);
  }
}
