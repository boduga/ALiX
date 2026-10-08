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
import {
  coordinationCompletionLabel,
  deriveCoordinationCompletion,
  matchesAttachedAggregateEvent,
  type CoordinationCompletion,
} from "./coordination-types.js";
import { existsSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import type { CoordinationRun, CoordinationRunStatus, CoordinationRunOutcome, WorkerStatus, WorkerBlockReason, WorkerFailureKind, WorkerFailureProvenance } from "./coordination-types.js";
import type { FailureChain, RunResultSummary } from "./coordination-result-types.js";
import { CollaborationStore } from "./collaboration-store.js";
import type { ConflictStatus, ConflictType, DetectionMethod } from "./collaboration-conflict-types.js";

// ─── View types ────────────────────────────────────────────────────

export type RunSummary = {
  id: string;
  goal: string;
  /** Legacy terminal execution state, kept for compatibility. */
  status: CoordinationRunStatus;
  outcome?: CoordinationRunOutcome;
  /**
   * The four completion dimensions. `status` alone never implies aggregation,
   * a success outcome or verification (see `deriveCoordinationCompletion`).
   */
  completion: CoordinationCompletion;
  /** Derived, user-facing label. Never a stored boolean. */
  completionLabel: string;
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
  expiresAt: string;
  expiresInMs: number;
  taskId?: string;
};

export type CoordinationEventView = {
  type: string;
  timestamp: string;
  workerId?: string;
  payload: Record<string, unknown>;
};

export type CoordinationConflictView = {
  id: string;
  topicKey: string;
  type: ConflictType;
  status: ConflictStatus;
  criticality: "info" | "warning" | "critical";
  findingCount: number;
  evidenceRecommendation: "prefer_stronger_evidence" | "request_more_evidence" | "accept_divergence" | "human_review";
  evidenceConfidence: "high" | "medium" | "low";
  scoreMargin: number;
  detectedBy: DetectionMethod[];
  updatedAt: string;
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
  conflictCount?: number;
  criticalConflictCount?: number;
  conflicts?: CoordinationConflictView[];
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

/**
 * Read a run's recorded session events. Best-effort: a missing or unreadable
 * session log yields no events, which reads as "no evidence" (fail-closed)
 * rather than as verification.
 */
export async function readRunSessionEvents(
  cwd: string,
  sessionId: string,
): Promise<Array<{ type: string; payload?: Record<string, unknown> }>> {
  try {
    const sessionsRoot = resolve(cwd, ".alix", "sessions");
    const sessionDir = resolve(sessionsRoot, sessionId);
    const rel = relative(sessionsRoot, sessionDir);
    if (rel.startsWith("..") || isAbsolute(rel) || rel === "..") return [];
    const eventPath = join(sessionDir, "events.jsonl");
    if (!existsSync(eventPath)) return [];
    const { readFileSync } = await import("node:fs");
    const events: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    for (const line of readFileSync(eventPath, "utf-8").trim().split("\n")) {
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string; payload?: Record<string, unknown> };
        events.push({
          type: parsed.type ?? "unknown",
          ...(parsed.payload !== undefined ? { payload: parsed.payload } : {}),
        });
      } catch {
        // A malformed line is not evidence; skip it.
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * THE single coordination-completion derivation (R3.6). Reads the run's
 * session events, pairs the aggregate-event match with the current source
 * fingerprint, and derives execution/aggregation/outcome/verification. Every
 * reader (task-loop completion, coordination tools/CLI, collaboration
 * context, this view) uses this instead of re-assembling the evidence pair —
 * a site that assembles its own pair can silently drop the fingerprint check
 * or read a stale event set. `status`, worker prose, and any stored
 * verified flag are never inputs.
 */
export async function deriveRunCompletion(
  cwd: string,
  run: CoordinationRun,
): Promise<{ completion: CoordinationCompletion; label: string }> {
  const rawSessionEvents = await readRunSessionEvents(cwd, run.sessionId);
  const completion = deriveCoordinationCompletion(run, {
    currentFingerprint: computeAggregationSourceFingerprint(run),
    aggregateEventMatches: matchesAttachedAggregateEvent(run, rawSessionEvents),
  });
  return { completion, label: coordinationCompletionLabel(completion) };
}

export async function buildCoordinationRunView(
  runId: string,
  cwd: string,
): Promise<CoordinationRunView | null> {
  const store = new CoordinationStore(cwd);
  const run = await store.load(runId);
  if (!run) return null;

  // Completion dimensions. `status` is the legacy terminal execution state;
  // aggregation, outcome and verification are derived from the run record plus
  // the durable aggregate event, never from status alone.
  const { completion, label: completionLabel } = await deriveRunCompletion(cwd, run);

  // Run summary
  const runSummary: RunSummary = {
    id: run.id,
    goal: run.rootGoal,
    status: run.status,
    outcome: run.outcome,
    completion,
    completionLabel,
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
      expiresAt: r.expiresAt,
      expiresInMs: Number.isFinite(Date.parse(r.expiresAt)) ? Math.max(0, Date.parse(r.expiresAt) - Date.now()) : 0,
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

  // Events — read from EventLog session with path containment validation
  let events: CoordinationEventView[] = [];
  try {
    const sessionsRoot = resolve(cwd, ".alix", "sessions");
    const sessionDir = resolve(sessionsRoot, run.sessionId);
    const rel = relative(sessionsRoot, sessionDir);
    if (!rel.startsWith("..") && !isAbsolute(rel) && rel !== "..") {
      const eventPath = join(sessionDir, "events.jsonl");
      if (existsSync(eventPath)) {
        const { readFileSync } = await import("node:fs");
        const raw = readFileSync(eventPath, "utf-8");
        events = raw.trim().split("\n").filter(Boolean).map(line => {
          try {
            const parsed = JSON.parse(line);
            const p = parsed.payload ?? {};
            // Filter to only coordination-run events unless worker-matched
            if (p.coordinationRunId !== runId && !(p.workerId && workerIds.has(p.workerId))) return null;
            return {
              type: parsed.type ?? "unknown",
              timestamp: parsed.timestamp ?? parsed.createdAt ?? "",
              workerId: p.workerId,
              payload: {}, // redacted — full payload available via diagnostic flag
            };
          } catch { return null; }
        }).filter(Boolean).slice(-100) as CoordinationEventView[];
      }
    }
  } catch { /* events are best-effort */ }

  // Conflicts — unresolved conflicts from the run's collaboration store
  let conflictCount: number | undefined;
  let criticalConflictCount: number | undefined;
  let conflicts: CoordinationConflictView[] | undefined;
  try {
    const collabStore = new CollaborationStore(cwd, runId);
    const unresolved = await collabStore.queryConflicts({ statuses: ["detected", "under_review"] });
    conflictCount = unresolved.length;
    conflicts = unresolved.map(c => ({
      id: c.id,
      topicKey: c.topicKey,
      type: c.type,
      status: c.status,
      criticality: c.criticality,
      findingCount: c.findingIds.length,
      evidenceRecommendation: c.evidenceComparison.recommendation,
      evidenceConfidence: c.evidenceComparison.confidence,
      scoreMargin: c.evidenceComparison.scoreMargin,
      detectedBy: c.detectedBy,
      updatedAt: c.updatedAt,
    }));
    criticalConflictCount = conflicts.filter(c => c.criticality === "critical").length;
  } catch { /* conflicts are best-effort */ }

  return {
    run: runSummary,
    workers,
    approvals,
    ownershipLeases,
    failureChains,
    aggregate: aggregate ?? undefined,
    freshness,
    events,
    conflictCount,
    criticalConflictCount,
    conflicts,
  };
}
