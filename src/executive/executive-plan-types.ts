/**
 * P10.4a — Executive plan types.
 *
 * All types for PlanStore, ExecutionStateStore, PlanApprovalGate,
 * StepRunner, and ExecutionEngine. Shared across all P10.4a files.
 *
 * @module
 */

import type { ExecutionPlan, ExecutionStep, ExecutionStepAction } from "./planning-engine.js";

// ---------------------------------------------------------------------------
// Persisted plan (immutable)
// ---------------------------------------------------------------------------

export interface PersistedExecutionPlan extends ExecutionPlan {
  /** SHA-256 of the canonical JSON content; verified on every load. */
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Execution state (mutable)
// ---------------------------------------------------------------------------

export type PlanStatus =
  | "draft"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "rejected";

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface PlanApproval {
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export type StepRuntimeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked"
  | "waiting_for_bridge"
  | "failed";

export interface GeneratedArtifactRef {
  type: "proposal" | "report" | "investigation" | "document" | "evidence" | "other";
  /**
   * Stable forever — used as a cross-reference key across all execution
   * phases. Once assigned, an artifact ID MUST NEVER change. Future
   * proposal IDs, investigation IDs, evidence IDs, and report IDs are
   * expected to remain stable for the entire lifecycle of the artifact.
   */
  id: string;
  /** Optional URI for external artifacts. Reserved, not populated in P10.4a. */
  uri?: string;
}

export interface StepRuntimeState {
  status: StepRuntimeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  evidenceIds: string[];
  summary?: string;
  generatedArtifacts: GeneratedArtifactRef[];
  warnings: string[];
  /** Which executionId last touched this step. */
  lastExecutionId?: string;
}

export interface PlanTransition {
  /** Monotonically increasing — canonical ordering key, not timestamp-based. */
  sequence: number;
  from: PlanStatus;
  to: PlanStatus;
  at: string;
  executionId?: string;
  reason?: string;
}

export interface PlanExecutionState {
  planId: string;
  status: PlanStatus;
  approval: PlanApproval;
  /** Single canonical source of step runtime state. */
  stepStates: Record<string, StepRuntimeState>;
  /** Append-only transition history (managed by ExecutionStateStore). */
  planTransitions: PlanTransition[];
  timestamps: {
    createdAt: string;
    approvedAt?: string;
    runningAt?: string;
    completedAt?: string;
    failedAt?: string;
    blockedAt?: string;
    cancelledAt?: string;
  };
  lastExecutionId?: string;
}

// ---------------------------------------------------------------------------
// Correlation IDs
// ---------------------------------------------------------------------------

export interface ExecutiveCorrelation {
  planId: string;
  stepId?: string;
  /** One executionId = one ExecutionEngine entry-point invocation. */
  executionId: string;
}

// ---------------------------------------------------------------------------
// Execution results
// ---------------------------------------------------------------------------

export interface ExecutiveStepExecutionResult {
  stepId: string;
  status: StepRuntimeStatus;
  durationMs: number;
  evidenceIds: string[];
  executionId: string;
}

export interface StepRunnerResult {
  outcome: "executed" | "intent_recorded";
  durationMs: number;
  summary?: string;
  generatedArtifacts: GeneratedArtifactRef[];
  evidenceIds: string[];
  warnings: string[];
  /** Reserved for P10.4c retry logic — always false in P10.4a. */
  retryable: boolean;
  newStepStatus: StepRuntimeStatus;
}

// ---------------------------------------------------------------------------
// Step ID immutability
// ---------------------------------------------------------------------------

/** All known step IDs for a plan. Pure helper. */
export function allStepIds(plan: PersistedExecutionPlan): string[] {
  return plan.steps.map(s => s.id);
}

/** Validates that a state's step IDs match the plan's step IDs. Fail closed. */
/**
 * Validates that every plan step has exactly one StepRuntimeState and
 * no extra step IDs exist in the state map.
 *
 * Checks both directions:
 *   plan ⊆ state   (every plan step must have a runtime state)
 *   state ⊆ plan   (no unknown step IDs in the runtime state)
 *
 * This is a constitutional invariant — enforced at init time and at
 * every ExecutionEngine entry point.
 */
export function validateStateStepIds(
  plan: PersistedExecutionPlan,
  state: PlanExecutionState,
): void {
  const planIds = new Set(plan.steps.map(s => s.id));
  const stateIds = new Set(Object.keys(state.stepStates));

  // Cardinality guard: exact 1:1 match expected
  if (plan.steps.length !== stateIds.size) {
    throw new Error(
      `StepRuntimeState cardinality mismatch: plan has ${plan.steps.length} steps but state has ${stateIds.size} entries for plan "${plan.id}"`,
    );
  }

  // Direction 1: every plan step has exactly one state entry
  for (const stepId of planIds) {
    if (!stateIds.has(stepId)) {
      throw new Error(
        `Plan step "${stepId}" has no runtime state in plan "${plan.id}" — every plan step must have exactly one StepRuntimeState`,
      );
    }
  }

  // Direction 2: no unknown step IDs in state
  for (const stepId of stateIds) {
    if (!planIds.has(stepId)) {
      throw new Error(
        `State step ID "${stepId}" not found in plan "${plan.id}" — step IDs are immutable`,
      );
    }
  }
}
