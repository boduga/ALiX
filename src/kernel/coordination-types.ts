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
  | "running"      // one or more workers active
  | "blocked"      // all workers blocked or pending
  | "completed"    // all workers completed successfully
  | "failed";      // one or more workers failed and cannot proceed

export type WorkerBlockReason =
  | "approval_required" | "authorization_denied" | "ownership_conflict"
  | "dependency_failed" | "orphaned" | "concurrency_limit"
  | "execution_failed" | "lease_lost" | "cancelled";

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
  lastHeartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
  blockReason?: WorkerBlockReason;
  failureKind?: WorkerFailureKind;
  approvalId?: string;
  authorizationEvidence?: WorkerAuthorizationEvidence;
  failureProvenance?: WorkerFailureProvenance;

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
  lastHeartbeatAt?: string;
  startedAt?: string;
  completedAt?: string;
  blockReason?: WorkerBlockReason;
  failureKind?: WorkerFailureKind;
  approvalId?: string;
  authorizationEvidence?: WorkerAuthorizationEvidence;
  failureProvenance?: WorkerFailureProvenance;
}): WorkerAssignment {
  const now = new Date().toISOString();
  return {
    id: opts.id ?? `worker_${randomUUID()}`,
    coordinationRunId: opts.coordinationRunId,
    agentId: opts.agentId,
    taskLabel: opts.taskLabel,
    goalPrompt: opts.goalPrompt,
    dependencies: opts.dependencies ?? [],
    ownershipScopes: opts.ownershipScopes ?? [],
    status: opts.status ?? "pending",
    error: opts.error,
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
    lastHeartbeatAt: opts.lastHeartbeatAt,
    startedAt: opts.startedAt,
    completedAt: opts.completedAt,
    blockReason: opts.blockReason,
    failureKind: opts.failureKind,
    approvalId: opts.approvalId,
    authorizationEvidence: opts.authorizationEvidence,
    failureProvenance: opts.failureProvenance,
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
