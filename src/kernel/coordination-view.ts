/**
 * coordination-view.ts — Shared read model for coordination visibility.
 *
 * Composes CoordinationStore, ApprovalStore, OwnershipRegistry,
 * CoordinationAggregateStore, and failure-chain builder into a
 * single CoordinationRunView. CLI, TUI, and Inspector all use this.
 */

import { CoordinationStore } from "./coordination-store.js";
import { CoordinationAggregateStore } from "./coordination-aggregate-store.js";
import { buildFailureChains } from "./coordination-failure-chain.js";
import { computeAggregationSourceFingerprint } from "./coordination-aggregation-fingerprint.js";
import type { CoordinationRunStatus, CoordinationRunOutcome, WorkerStatus, WorkerBlockReason, WorkerFailureKind, WorkerFailureProvenance } from "./coordination-types.js";
import type { FailureChain, RunResultSummary } from "./coordination-result-types.js";

// ─── View types ────────────────────────────────────────────────────

export type RunSummary = {
  id: string;
  goal: string;
  status: CoordinationRunStatus;
  outcome?: CoordinationRunOutcome;
  workerCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkerView = {
  id: string;
  taskLabel: string;
  agentId: string;
  status: WorkerStatus;
  attempt: number;
  maxAttempts: number;
  planOrder?: number;
  outcome?: "success" | "failure";
  summary?: string;
  error?: string;
  failureKind?: WorkerFailureKind;
  blockReason?: WorkerBlockReason;
  failureProvenance?: WorkerFailureProvenance;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  ownershipScopes: string[];
  leaseIds?: string[];
  approvalId?: string;
  resultRef?: string;
};

export type ApprovalView = {
  id: string;
  status: string;
  capabilities: string[];
  bindingKey: string;
  workerId?: string;
  createdAt: string;
  expiresAt: string;
};

export type OwnershipLeaseView = {
  id: string;
  agentId: string;
  scope: string;
  mode: string;
  status: string;
  acquiredAt: string;
  ttlMs: number;
  taskId?: string;
};

export type CoordinationEventView = {
  type: string;
  timestamp: string;
  workerId?: string;
  payload: Record<string, unknown>;
};

export type CoordinationRunView = {
  run: RunSummary;
  workers: WorkerView[];
  approvals: ApprovalView[];
  ownershipLeases: OwnershipLeaseView[];
  failureChains: FailureChain[];
  aggregate?: RunResultSummary;
  freshness: "fresh" | "stale" | "missing";
  events: CoordinationEventView[];
};

// ─── Helpers ───────────────────────────────────────────────────────

function deriveWorkerOutcome(worker: {
  status: WorkerStatus;
  error?: string;
}): "success" | "failure" | undefined {
  if (worker.status === "completed") return "success";
  if (worker.status === "failed" || worker.status === "cancelled") return "failure";
  if (worker.error) return "failure";
  return undefined;
}

// ─── View builder ──────────────────────────────────────────────────

export async function buildCoordinationRunView(
  runId: string,
  cwd: string,
): Promise<CoordinationRunView | null> {
  const store = new CoordinationStore(cwd);
  const run = await store.load(runId);
  if (!run) return null;

  // Run summary
  const runSummary: RunSummary = {
    id: run.id,
    goal: run.rootGoal,
    status: run.status,
    outcome: run.outcome,
    workerCount: run.workers.length,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };

  // Workers
  const workers: WorkerView[] = run.workers.map(w => ({
    id: w.id,
    taskLabel: w.taskLabel,
    agentId: w.agentId,
    status: w.status,
    attempt: w.attempt,
    maxAttempts: w.maxAttempts,
    planOrder: w.planOrder,
    outcome: deriveWorkerOutcome(w),
    error: w.error,
    failureKind: w.failureKind,
    blockReason: w.blockReason,
    failureProvenance: w.failureProvenance,
    startedAt: w.startedAt,
    completedAt: w.completedAt,
    durationMs: w.startedAt && w.completedAt
      ? new Date(w.completedAt).getTime() - new Date(w.startedAt).getTime()
      : undefined,
    ownershipScopes: w.ownershipScopes ?? [],
    leaseIds: w.leaseIds,
    approvalId: w.approvalId,
    resultRef: w.resultRef,
  }));

  // Approvals
  const approvals: ApprovalView[] = [];

  // Ownership leases
  const ownershipLeases: OwnershipLeaseView[] = [];

  // Aggregate and freshness
  const aggregateStore = new CoordinationAggregateStore(cwd);
  const aggregate = await aggregateStore.load(runId);
  const currentFingerprint = computeAggregationSourceFingerprint(run);

  let freshness: "fresh" | "stale" | "missing" = "missing";
  if (aggregate) {
    freshness = aggregate.sourceFingerprint === currentFingerprint ? "fresh" : "stale";
  }

  // Failure chains
  const failureChains = buildFailureChains(run);

  // Events
  const events: CoordinationEventView[] = [];

  return {
    run: runSummary,
    workers,
    approvals,
    ownershipLeases,
    failureChains,
    aggregate: aggregate ?? undefined,
    freshness,
    events,
  };
}
