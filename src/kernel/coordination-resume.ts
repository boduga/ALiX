/**
 * coordination-resume.ts — Reclaim runs whose host process died.
 *
 * A run executes in the process that started it (Inspector server, TUI
 * tool, CLI). If that process restarts, its `running` workers keep a dead
 * `executionOwnerId` and nothing ticks them. This module reclaims exactly
 * those workers — and only those, since an unknown owner is treated as
 * alive — resetting them to `pending` so a fresh scheduler re-dispatches
 * them. Retries stay bounded by `maxAttempts`.
 */

import { isOwnerAlive } from "./owner-liveness.js";
import type { CoordinationStore } from "./coordination-store.js";

export type ReclaimResult = {
  runId: string;
  reclaimedWorkerIds: string[];
};

/**
 * Reclaim dead-owner workers for one run. Returns the worker ids reset to
 * `pending` (empty when nothing was reclaimable).
 */
export async function reclaimDeadOwnerWorkers(
  store: CoordinationStore,
  runId: string,
): Promise<ReclaimResult> {
  const run = await store.load(runId);
  if (!run) return { runId, reclaimedWorkerIds: [] };

  const reclaimedWorkerIds: string[] = [];
  for (const worker of run.workers) {
    if (worker.status !== "running") continue;
    if (isOwnerAlive(worker.executionOwnerId)) continue;
    // Owner process is provably gone: reset for a bounded retry.
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
): Promise<string[]> {
  const runs = await store.list();
  const cancelled: string[] = [];
  for (const run of runs) {
    if (!ACTIVE_RUN_STATUSES.has(run.status)) continue;
    if (hostKinds.length > 0 && (run.hostKind === undefined || !hostKinds.includes(run.hostKind))) continue;
    const runningWorkers = run.workers.filter(w => w.status === "running");
    if (runningWorkers.length === 0) continue;
    if (!runningWorkers.every(w => !isOwnerAlive(w.executionOwnerId))) continue;
    const deadOwner = runningWorkers[0]?.executionOwnerId ?? "unknown";
    await store.updateRun(run.id, (current) => {
      for (const worker of current.workers) {
        if (worker.status === "running" || worker.status === "pending") {
          worker.status = "cancelled";
          worker.blockReason = "cancelled";
          worker.leaseIds = [];
          worker.error = `Run abandoned — host ${deadOwner} stopped`;
        }
      }
    });
    cancelled.push(run.id);
  }
  return cancelled;
}
