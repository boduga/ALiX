/**
 * coordination-types.ts — Core data model for multi-agent coordination.
 *
 * This sits ABOVE the existing WorkflowRun/TaskGraph system.
 * A CoordinationRun tracks one coordinator orchestration run with
 * multiple WorkerAssignments, each of which maps to a task slot
 * with ownership scopes for conflict detection.
 */

import { randomUUID } from "node:crypto";

export type WorkerStatus =
  | "pending"      // not yet eligible
  | "ready"        // dependencies resolved, waiting for assignment
  | "running"      // actively executing
  | "blocked"      // blocked by dependency failure or resource contention
  | "completed"    // finished successfully
  | "failed"       // finished with error
  | "cancelled";   // cancelled before completion

export type CoordinationRunStatus =
  | "planning"     // coordinator is decomposing the goal
  | "replanning"   // coordinator is re-planning after a worker completed/failed
  | "running"      // one or more workers active
  | "blocked"      // all workers blocked or pending
  | "cancelled"    // operator cancelled the run: terminal, never resumed
  | "completed"    // all workers completed successfully
  | "failed";      // one or more workers failed and cannot proceed

export type WorkerBlockReason =
  | "approval_required" | "authorization_denied" | "ownership_conflict"
  | "dependency_failed" | "orphaned" | "concurrency_limit"
  | "execution_failed" | "lease_lost" | "cancelled"
  | "context_unavailable";

export type WorkerFailureKind =
  | "transient_provider" | "timeout" | "authorization_denied"
  | "approval_required" | "ownership_conflict" | "execution_error"
  | "orphaned" | "dependency_failed" | "lease_lost" | "cancelled";

export type WorkerOwnershipClaim = {
  path: string;
  recursive: boolean;
  sourcePattern?: string;
};

export type CoordinationRunOutcome =
  | "success" | "partial_success" | "failure"
  | "cancelled" | "blocked" | "incomplete";

// ─── Planning / Replanning Types ─────────────────────────────────────────

export type PlanningRoundStatus =
  | "draft" | "bidding" | "finalizing" | "finalized" | "failed";

export type PlanTriggerKind =
  | "worker_completed" | "worker_failed" | "conflict_detected"
  | "finding_published" | "manual";

export interface PlanningProposal {
  id: string;
  taskLabel: string;
  goalPrompt: string;
  requiredCapabilities: string[];
  ownershipClaims: WorkerOwnershipClaim[];
  dependencies: string[];
  riskLevel?: string;
  approvalMode?: string;
}

export interface PlanningBid {
  id: string;
  proposalId: string;
  agentId: string;
  matchedCapabilities: string[];
  unmatchedCapabilities: string[];
  confidence: number;
  message?: string;
  createdAt: string;
}

export interface PlanningAcceptance {
  proposalId: string;
  agentId: string;
  assignedWorkerId: string;
}

export interface PlanningRound {
  id: string;
  coordinationRunId: string;
  roundNumber: number;
  status: PlanningRoundStatus;
  proposals: PlanningProposal[];
  bids: PlanningBid[];
  acceptances: PlanningAcceptance[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanDiffEntry {
  workerId: string;
  change: "added" | "removed" | "modified";
  taskLabel?: string;
  goalPrompt?: string;
  reason: string;
}

export interface PlanRevision {
  revisionNumber: number;
  timestamp: string;
  reason: string;
  triggerKind: PlanTriggerKind;
  triggerWorkerId?: string;
  conflictIds?: string[];
  diff: PlanDiffEntry[];
}

export type WorkerFailureProvenance = {
  directCauseWorkerIds: string[];
  rootCauseWorkerIds: string[];
  propagatedAt: string;
};

export type WorkerCapabilityDecision = {
  capability: string;
  status: "allowed" | "denied" | "approval_required";
  policyRuleId?: string;
  approvalId?: string;
  reason?: string;
};

export type WorkerAuthorizationEvidence = {
  evaluatedAt: string;
  policyRevision?: number;
  decisions: WorkerCapabilityDecision[];
};

export interface WorkerAssignment {
  /** Unique ID for this assignment (uuid) */
  id: string;

  /** Which coordination run owns this worker */
  coordinationRunId: string;

  /** The agent ID that will execute this task */
  agentId: string;

  /** Human-readable task description */
  taskLabel: string;

  /** Detailed goal prompt — what the worker should accomplish */
  goalPrompt: string;

  /** Explicit file outputs of direct graph dependencies, for read-path resolution. */
  inputPaths?: string[];

  /** IDs of other WorkerAssignments that must complete first */
  dependencies: string[];

  /** Ownership scopes for path-based conflict detection.
   *  Each scope is a minimatch pattern (e.g. "src/**"). */
  ownershipScopes: string[];

  /** Current status */
  status: WorkerStatus;

  /** Reference to the persisted result (file path or store key).
   *  Set when status transitions to "completed" or "failed". */
  resultRef?: string;

  /** Error message, set when status is "failed" */
  error?: string;

  sourceNodeId?: string;
  requiredCapabilities: string[];
  riskLevel?: string;
  approvalMode?: string;
  attempt: number;
  maxAttempts: number;
  planOrder?: number;
  nextAttemptAt?: string;
  ownershipClaims: WorkerOwnershipClaim[];
  leaseIds?: string[];
  executionOwnerId?: string;
  replacementForWorkerId?: string;
  supersededByWorkerId?: string;
  lastHeartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
  blockReason?: WorkerBlockReason;
  failureKind?: WorkerFailureKind;
  approvalId?: string;
  authorizationEvidence?: WorkerAuthorizationEvidence;
  failureProvenance?: WorkerFailureProvenance;
  contextManifestRef?: string;
  contextFingerprint?: string;
  contextGeneratedAt?: string;
  contextTokenEstimate?: number;

  /** When this assignment was created */
  createdAt: string;

  /** When this assignment last changed status */
  updatedAt: string;
}

export interface CoordinationRun {
  /** Unique run ID (e.g. "coord_<uuid>") */
  id: string;

  /** Session ID of the coordinator agent */
  sessionId: string;

  /**
   * Which host started (and is responsible for ticking) this run.
   * `inspector` runs are resumed by the Inspector server on restart;
   * `cli`/`daemon` runs are owned by their launching process.
   */
  hostKind?: "inspector" | "daemon" | "cli";

  /**
   * Approval mode this run executes under. Persisted so a resumed run
   * (Inspector restart) keeps the mode it was started with instead of
   * falling back to the on-disk default.
   */
  sessionMode?: "auto" | "ask" | "bypass";

  /** Dispatch concurrency this run was started with (resume default 2). */
  maxConcurrency?: number;

  /** The top-level goal being decomposed */
  rootGoal: string;

  /** Current run status */
  status: CoordinationRunStatus;

  /** Which agent (agentId) is the coordinator */
  coordinatorAgentId: string;

  /** All worker assignments in this run */
  workers: WorkerAssignment[];

  /** Reference to the persisted TaskGraph (planning evidence). */
  taskGraphId?: string;

  /** File path to the persisted TaskGraph, relative to cwd. */
  taskGraphRef?: string;

  aggregateResultRef?: string;
  aggregateGeneratedAt?: string;
  aggregateSourceFingerprint?: string;
  outcome?: CoordinationRunOutcome;

  /** Current plan revision number (increments on each replan). */
  planRevision: number;

  /** History of all plan revisions, oldest first. */
  revisionHistory?: PlanRevision[];

  /** History of planning rounds for this run. */
  planningRounds?: PlanningRound[];

  /** Schema version for forward compatibility */
  schemaVersion: "1.0";

  /** When the run was created */
  createdAt: string;

  /** When the run last changed status */
  updatedAt: string;
}

// ─── Constructors ─────────────────────────────────────────────────────

export function createCoordinationRun(opts: {
  sessionId: string;
  rootGoal: string;
  coordinatorAgentId: string;
  taskGraphId?: string;
  taskGraphRef?: string;
}): CoordinationRun {
  const now = new Date().toISOString();
  return {
    id: `coord_${randomUUID()}`,
    sessionId: opts.sessionId,
    rootGoal: opts.rootGoal,
    status: "planning",
    coordinatorAgentId: opts.coordinatorAgentId,
    workers: [],
    taskGraphId: opts.taskGraphId,
    taskGraphRef: opts.taskGraphRef,
    planRevision: 0,
    schemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
  };
}

export function createWorkerAssignment(opts: {
  id?: string;
  coordinationRunId: string;
  agentId: string;
  taskLabel: string;
  goalPrompt: string;
  inputPaths?: string[];
  dependencies?: string[];
  ownershipScopes?: string[];
  status?: WorkerStatus;
  error?: string;
  resultRef?: string;
  requiredCapabilities?: string[];
  riskLevel?: string;
  approvalMode?: string;
  sourceNodeId?: string;
  attempt?: number;
  maxAttempts?: number;
  planOrder?: number;
  nextAttemptAt?: string;
  ownershipClaims?: WorkerOwnershipClaim[];
  leaseIds?: string[];
  executionOwnerId?: string;
  replacementForWorkerId?: string;
  supersededByWorkerId?: string;
  lastHeartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
  blockReason?: WorkerBlockReason;
  failureKind?: WorkerFailureKind;
  approvalId?: string;
  authorizationEvidence?: WorkerAuthorizationEvidence;
  failureProvenance?: WorkerFailureProvenance;
  contextManifestRef?: string;
  contextFingerprint?: string;
  contextGeneratedAt?: string;
  contextTokenEstimate?: number;
}): WorkerAssignment {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? `worker_${randomUUID()}`,
    coordinationRunId: opts.coordinationRunId,
    agentId: opts.agentId,
    taskLabel: opts.taskLabel,
    goalPrompt: opts.goalPrompt,
    inputPaths: opts.inputPaths,
    dependencies: opts.dependencies ?? [],
    ownershipScopes: opts.ownershipScopes ?? [],
    status: opts.status ?? "pending",
    error: opts.error,
    resultRef: opts.resultRef,
    sourceNodeId: opts.sourceNodeId,
    requiredCapabilities: opts.requiredCapabilities ?? [],
    riskLevel: opts.riskLevel,
    approvalMode: opts.approvalMode,
    attempt: opts.attempt ?? 0,
    maxAttempts: opts.maxAttempts ?? 3,
    planOrder: opts.planOrder,
    nextAttemptAt: opts.nextAttemptAt,
    ownershipClaims: opts.ownershipClaims ?? [],
    leaseIds: opts.leaseIds,
    executionOwnerId: opts.executionOwnerId,
    replacementForWorkerId: opts.replacementForWorkerId,
    supersededByWorkerId: opts.supersededByWorkerId,
    lastHeartbeatAt: opts.lastHeartbeatAt,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt,
    blockReason: opts.blockReason,
    failureKind: opts.failureKind,
    approvalId: opts.approvalId,
    authorizationEvidence: opts.authorizationEvidence,
    failureProvenance: opts.failureProvenance,
    contextManifestRef: opts.contextManifestRef,
    contextFingerprint: opts.contextFingerprint,
    contextGeneratedAt: opts.contextGeneratedAt,
    contextTokenEstimate: opts.contextTokenEstimate,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

export function transitionWorkerStatus(
  worker: WorkerAssignment,
  status: WorkerStatus,
  extra?: { resultRef?: string; error?: string },
): WorkerAssignment {
  return {
    ...worker,
    status,
    resultRef: extra?.resultRef ?? worker.resultRef,
    error: extra?.error ?? worker.error,
    updatedAt: new Date().toISOString(),
  };
}

export function transitionCoordinationRunStatus(
  run: CoordinationRun,
  status: CoordinationRunStatus,
): CoordinationRun {
  return { ...run, status, updatedAt: new Date().toISOString() };
}

/**
 * Compute the coordination run status from its workers' statuses.
 * - all completed → "completed"
 * - any failed and no path forward → "failed"
 * - any running → "running"
 * - all pending/blocked → "blocked"
 * - else → "running"
 */
export function recomputeRunStatus(run: CoordinationRun): CoordinationRunStatus {
  // Guard: preserve replanning when coordinator has explicitly set it.
  // The scheduler sets "replanning" before invoking replan() and expects
  // status to stay "replanning" until replan() completes.
  if (run.status === "replanning") return "replanning";
  // Cancellation is an explicit terminal outcome. Without this guard an
  // all-cancelled run recomputes to "blocked" — not terminal — so a cancelled
  // run would stay in the active set and could be resumed by a host sweep.
  if (run.status === "cancelled") return "cancelled";

  const allCompleted = run.workers.every(w => w.status === "completed");
  if (allCompleted && run.workers.length > 0) return "completed";

  const hasFailed = run.workers.some(w => w.status === "failed");
  const hasRunning = run.workers.some(w => w.status === "running" || w.status === "ready");
  if (hasFailed && !hasRunning) return "failed";

  const allIdle = run.workers.every(w =>
    w.status === "pending" || w.status === "blocked" || w.status === "cancelled"
  );
  if (allIdle && run.workers.length > 0) return "blocked";

  return "running";
}

// ─── Completion semantics ─────────────────────────────────────────────
//
// `completed` is the run's TERMINAL EXECUTION state, derived from worker
// statuses by `recomputeRunStatus` above. It deliberately says nothing about
// whether the results were aggregated, what the aggregate outcome was, or
// whether anything was verified. Those are separate dimensions, derived here
// from persisted fields so legacy records stay readable with no migration.
//
// Invariants (pinned by tests/kernel/coordination-types.test.ts):
//   status === "completed"  ⇏  aggregation = "generated"
//   status === "completed"  ⇏  outcome = "success"
//   status === "completed"  ⇏  verification = "verified"
//   verification = "verified" requires explicit aggregate EVENT evidence — a
//   non-null `aggregateResultRef` alone is not sufficient.

export type CoordinationExecutionState = "running" | "completed" | "failed" | "cancelled";

export type CoordinationAggregationState = "not_required" | "pending" | "generated" | "failed";

export type CoordinationOutcomeState = "unknown" | CoordinationRunOutcome;

export type CoordinationVerificationState = "unverified" | "verified" | "failed";

export type CoordinationCompletion = {
  execution: CoordinationExecutionState;
  aggregation: CoordinationAggregationState;
  outcome: CoordinationOutcomeState;
  verification: CoordinationVerificationState;
};

/**
 * Evidence a run record cannot carry itself. Callers that can observe the
 * event log or the completing session supply it; callers that cannot get the
 * conservative reading (unverified).
 */
export type CoordinationCompletionEvidence = {
  /** `coordination.aggregate.completed` was observed for this run. */
  aggregateEventPresent?: boolean;
  /** A terminal finalization attempt ran and threw. */
  aggregationFailed?: boolean;
  /** Terminal the completing session reported. */
  sessionTerminal?: "completed" | "completed_unverified" | "cancelled" | "failed";
};

type CompletionRunFields = Pick<CoordinationRun, "status" | "outcome" | "aggregateResultRef">;

/**
 * Map persisted run fields (+ optional evidence) onto the four dimensions.
 * Pure and decision-free: it never mutates the run and never rewrites a
 * legacy record — a `completed` run with no aggregate reads as
 * `aggregation: "pending"`, `outcome: "unknown"`, `verification: "unverified"`.
 */
export function deriveCoordinationCompletion(
  run: CompletionRunFields,
  evidence: CoordinationCompletionEvidence = {},
): CoordinationCompletion {
  const execution: CoordinationExecutionState =
    run.status === "completed" ? "completed"
      : run.status === "failed" ? "failed"
        : run.status === "cancelled" ? "cancelled"
          : "running"; // planning | replanning | running | blocked are all non-terminal

  const terminal = execution === "completed" || execution === "failed" || execution === "cancelled";
  const aggregation: CoordinationAggregationState =
    evidence.aggregationFailed === true ? "failed"
      : run.aggregateResultRef ? "generated"
        : terminal ? "pending"
          : "not_required";

  const outcome: CoordinationOutcomeState = run.outcome ?? "unknown";

  const verification: CoordinationVerificationState =
    aggregation === "failed" ? "failed"
      : outcome === "failure" || outcome === "blocked" || outcome === "cancelled" ? "failed"
        : aggregation === "generated"
          && outcome === "success"
          && evidence.aggregateEventPresent === true
          && evidence.sessionTerminal !== "completed_unverified"
          ? "verified"
          : "unverified";

  return { execution, aggregation, outcome, verification };
}

/**
 * Derived, user-facing label. Renderers use this instead of inventing another
 * boolean; the legacy `status` stays visible for compatibility.
 */
export function coordinationCompletionLabel(completion: CoordinationCompletion): string {
  const { execution, aggregation, outcome, verification } = completion;
  if (execution === "failed") return "failed";
  if (execution === "cancelled") return "cancelled";
  if (execution === "running") return "in progress";
  if (aggregation === "failed") return "workers finished; aggregation failed";
  if (aggregation !== "generated") return "workers finished; results not aggregated";
  if (verification === "verified") return "verified completion";
  if (outcome === "success") return "completed; not verified";
  if (outcome === "partial_success") return "completed with failures";
  if (outcome === "failure" || outcome === "blocked" || outcome === "cancelled") {
    return "completed with a failed outcome";
  }
  return "aggregated; outcome unknown";
}
