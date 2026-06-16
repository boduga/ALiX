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
import { existsSync } from "node:fs";
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

  // Approvals — load from ApprovalStore by run ID
  const { ApprovalStore } = await import("../approvals/approval-store.js");
  const approvalStore = new ApprovalStore(cwd);
  await approvalStore.load();
  const approvals: ApprovalView[] = approvalStore.listByRun(runId).map(a => ({
    id: a.id,
    status: a.status,
    capabilities: a.capabilities,
    bindingKey: a.bindingKey,
    workerId: a.workerId,
    createdAt: a.createdAt,
    expiresAt: a.expiresAt,
  }));

  // Ownership leases — load from registry and filter by worker IDs in this run
  const workerIds = new Set(run.workers.map(w => w.id));
  const { OwnershipRegistry } = await import("../ownership/ownership-registry.js");
  const registry = new OwnershipRegistry(cwd, { sessionId: run.sessionId });
  await registry.refresh();
  const allRecords = registry.list();
  const ownershipLeases: OwnershipLeaseView[] = allRecords
    .filter(r => r.taskId && workerIds.has(r.taskId))
    .map(r => ({
      id: r.id,
      agentId: r.agentId,
      scope: r.scope && typeof r.scope === "object" ? (r.scope as any).root ?? JSON.stringify(r.scope) : JSON.stringify(r.scope ?? ""),
      mode: r.mode,
      status: r.status,
      acquiredAt: r.acquiredAt,
      ttlMs: 0,
      taskId: r.taskId,
    }));

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

  // Events — read from EventLog session
  let events: CoordinationEventView[] = [];
  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const eventPath = join(cwd, ".alix", "sessions", run.sessionId, "events.jsonl");
    if (existsSync(eventPath)) {
      const raw = readFileSync(eventPath, "utf-8");
      events = raw.trim().split("\n").filter(Boolean).map(line => {
        try {
          const parsed = JSON.parse(line);
          return {
            type: parsed.type ?? "unknown",
            timestamp: parsed.timestamp ?? parsed.createdAt ?? "",
            workerId: parsed.payload?.workerId,
            payload: parsed.payload ?? {},
          };
        } catch { return null; }
      }).filter(Boolean).slice(-100) as CoordinationEventView[]; // last 100 events
    }
  } catch { /* events are best-effort */ }

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
