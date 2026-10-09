/**
 * coordination-resume.ts — Reclaim runs whose host process died.
 *
 * A run executes in the process that started it (Inspector server, TUI
 * tool, CLI). If that process restarts, its `running` workers keep a dead
 * `executionOwnerId` and nothing ticks them. This module reclaims exactly
 * those workers — via the shared `shouldReclaimWorker` verdict (R3.3):
 * provably dead PID owners, plus ownerless workers whose heartbeat went
 * stale; unknown owners are treated as alive and never stolen — resetting
 * them to `pending` so a fresh scheduler re-dispatches them. Retries stay
 * bounded by `maxAttempts`.
 */

import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { DEFAULT_ORPHAN_THRESHOLD_MS, shouldReclaimWorker } from "./owner-liveness.js";
import { releaseWorkerLeases } from "./coordination-ownership.js";
import type { CoordinationStore } from "./coordination-store.js";
import type { CoordinationRun } from "./coordination-types.js";
import type { OwnershipRegistry } from "../ownership/ownership-registry.js";
import type { TaskGraph } from "./task-graph.js";
import { mirrorGraphToLedger } from "./graph-ledger.js";

/**
 * Mark the run's persisted TaskGraph cancelled so the inspector and any
 * graph listing agree with the run record. Best-effort: a graph that cannot
 * be read or written never blocks cancellation.
 */
export async function markRunGraphCancelled(cwd: string, run: CoordinationRun): Promise<void> {
  if (!run.taskGraphId) return;
  try {
    const graphPath = join(cwd, ".alix", "graphs", `${run.taskGraphId}.json`);
    const graph = JSON.parse(await readFile(graphPath, "utf-8")) as TaskGraph;
    if (graph.status === "cancelled") return;
    graph.status = "cancelled";
    graph.updatedAt = new Date().toISOString();
    // R2.13: append first (counted even though this helper is best-effort),
    // then the projection — outer catch keeps cancellation non-blocking.
    mirrorGraphToLedger(cwd, graph);
    await writeFile(graphPath, JSON.stringify(graph, null, 2), "utf-8");
  } catch {
    // Observability only.
  }
}

export type ReclaimResult = {
  runId: string;
  reclaimedWorkerIds: string[];
};

/**
 * Reclaim dead-owner workers for one run. Returns the worker ids reset to
 * `pending` (empty when nothing was reclaimable). Uses the ONE liveness
 * verdict (`shouldReclaimWorker`): provably dead owner, or ownerless with a
 * stale heartbeat — same rule reconciliation applies (R3.3).
 *
 * R3.4: the registry is REQUIRED. The old signature cleared `leaseIds`
 * without releasing them, leaving active records that blocked later runs in
 * the workspace until the TTL expired.
 */
export async function reclaimDeadOwnerWorkers(
  store: CoordinationStore,
  runId: string,
  ownershipRegistry: OwnershipRegistry,
  orphanThresholdMs: number = DEFAULT_ORPHAN_THRESHOLD_MS,
): Promise<ReclaimResult> {
  const run = await store.load(runId);
  if (!run) return { runId, reclaimedWorkerIds: [] };

  const reclaimedWorkerIds: string[] = [];
  for (const worker of run.workers) {
    if (!shouldReclaimWorker({
      status: worker.status,
      lastHeartbeatAt: worker.lastHeartbeatAt,
      executionOwnerId: worker.executionOwnerId,
      locallyActive: false,
      orphanThresholdMs,
    })) continue;
    // Owner provably gone (or ownerless + stale): release its leases BEFORE
    // clearing them, then reset for a bounded retry.
    await releaseWorkerLeases(ownershipRegistry, worker);
    await store.patchWorker(runId, worker.id, {
      status: "pending",
      executionOwnerId: undefined,
      leaseIds: [],
      blockReason: undefined,
      failureKind: undefined,
      error: `Reclaimed after host ${worker.executionOwnerId} stopped`,
      attempt: (worker.attempt ?? 0) + 1,
    });
    reclaimedWorkerIds.push(worker.id);
  }
  return { runId, reclaimedWorkerIds };
}

const ACTIVE_RUN_STATUSES = new Set(["planning", "running", "blocked"]);

/**
 * Find runs a host should resume: active, with one of the given host
 * kinds, and not already held by a live owner. Pure read — no mutation.
 * An empty `hostKinds` matches every host.
 */
export async function findResumableRuns(
  store: CoordinationStore,
  hostKinds: readonly string[],
): Promise<string[]> {
  const runs = await store.list();
  return runs
    .filter(run => ACTIVE_RUN_STATUSES.has(run.status))
    .filter(run => hostKinds.length === 0 || (run.hostKind !== undefined && hostKinds.includes(run.hostKind)))
    .map(run => run.id);
}

/**
 * Finalize abandoned runs whose host died mid-execution (SIGKILL — no
 * shutdown handler could run). Only runs with at least one `running`
 * worker whose owner is provably dead are touched; their running+pending
 * workers and the run are marked cancelled. Pending-only runs (never
 * started, or queued) are left alone — a live host may still claim them.
 *
 * Used by the CLI on start to self-heal a stranded foreground run.
 */
export async function cancelDeadOwnerRuns(
  store: CoordinationStore,
  hostKinds: readonly string[],
  ownershipRegistry?: OwnershipRegistry,
  orphanThresholdMs: number = DEFAULT_ORPHAN_THRESHOLD_MS,
): Promise<string[]> {
  const runs = await store.list();
  const cancelled: string[] = [];
  for (const run of runs) {
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
    if (hostKinds.length > 0 && (run.hostKind === undefined || !hostKinds.includes(run.hostKind))) continue;
    const runningWorkers = run.workers.filter(w => w.status === "running");
    if (runningWorkers.length === 0) continue;
    // Same ONE verdict as reconciliation/reclaim (R3.3): every running
    // worker must be reclaimable — provably dead owner, or ownerless+stale.
    if (!runningWorkers.every(w => shouldReclaimWorker({
      status: w.status,
      lastHeartbeatAt: w.lastHeartbeatAt,
      executionOwnerId: w.executionOwnerId,
      locallyActive: false,
      orphanThresholdMs,
    }))) continue;
    const deadOwner = runningWorkers[0]?.executionOwnerId ?? "unknown";
    // Release the leases the dead host held through the single release path
    // (R3.4). Clearing `leaseIds` without releasing them leaves active
    // registry records behind, and every later run in the workspace collides
    // with them until the TTL expires.
    if (ownershipRegistry) {
      for (const worker of run.workers) {
        await releaseWorkerLeases(ownershipRegistry, worker);
      }
    }
    const updated = await store.updateRun(run.id, (current) => {
      for (const worker of current.workers) {
        if (worker.status === "running" || worker.status === "pending") {
          worker.status = "cancelled";
          worker.blockReason = "cancelled";
          worker.leaseIds = [];
          worker.error = `Run abandoned — host ${deadOwner} stopped`;
        }
      }
      // Explicit terminal status: recomputeRunStatus would otherwise map an
      // all-cancelled run back to "blocked" and keep it in the active set.
      current.status = "cancelled";
    });
    if (updated) await markRunGraphCancelled(store.cwd, updated);
    cancelled.push(run.id);
  }
  return cancelled;
}
