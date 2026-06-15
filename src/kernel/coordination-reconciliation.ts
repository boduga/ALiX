/**
 * coordination-reconciliation.ts — Restart-safe reconciliation for coordination runs.
 *
 * Responsibilities:
 *   - Orphan recovery (stale heartbeat + different execution owner)
 *   - Transitive dependency failure propagation
 *   - Approval resolution (resume workers when approved)
 *   - Ownership conflict retry state reset
 *
 * Reconciliation is the source of truth for scheduler correctness.
 * Events improve responsiveness but are never correctness dependencies.
 */

import type { CoordinationStore } from "./coordination-store.js";
import type { WorkerAssignment } from "./coordination-types.js";

export interface Clock {
  now(): Date;
}

export type ReconciliationResult = {
  runId: string;
  orphaned: string[];
  dependencyBlocked: string[];
  approvalResumed: string[];
  status: string;
};

export type ReconciliationDeps = {
  store: CoordinationStore;
  daemonInstanceId: string;
  orphanThresholdMs: number;
  clock?: Clock;
  isApproved?: (approvalId: string) => Promise<boolean>;
  activeExecutionIds?: Set<string>;
};

/**
 * Reconcile a coordination run: recover orphans, propagate failures, resume approvals.
 */
export async function reconcileCoordinationRun(
  deps: ReconciliationDeps,
  runId: string,
): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    runId,
    orphaned: [],
    dependencyBlocked: [],
    approvalResumed: [],
    status: "unknown",
  };

  const now = deps.clock?.now() ?? new Date();
  const staleCutoff = new Date(now.getTime() - deps.orphanThresholdMs).toISOString();

  // Orphan recovery: workers running with stale heartbeat and not locally active
  const run = await deps.store.load(runId);
  if (!run) { result.status = "not_found"; return result; }

  for (const worker of run.workers) {
    if (worker.status !== "running") continue;
    if (!worker.lastHeartbeatAt || worker.lastHeartbeatAt >= staleCutoff) continue;

    const locallyActive = deps.activeExecutionIds?.has(worker.id) ?? false;
    if (locallyActive) continue;

    // Different execution owner or no owner — orphaned
    if (worker.executionOwnerId && worker.executionOwnerId !== deps.daemonInstanceId) {
      result.orphaned.push(worker.id);
      await releaseWorkerLeases(deps.store, runId, worker);
      await deps.store.patchWorker(runId, worker.id, {
        status: "failed",
        blockReason: "orphaned" as any,
        failureKind: "orphaned" as any,
        error: `Worker orphaned — heartbeat ${worker.lastHeartbeatAt} exceeded threshold`,
      });
    }
  }

  // Transitive dependency failure propagation — fixpoint loop
  let changed = true;
  while (changed) {
    changed = false;
    const currentRun = await deps.store.load(runId);
    if (!currentRun) break;

    for (const worker of currentRun.workers) {
      if (worker.status !== "pending") continue;

      const failedDep = worker.dependencies
        .map(id => currentRun.workers.find(w => w.id === id))
        .find(dep =>
          dep && (
            dep.status === "failed" ||
            dep.status === "cancelled" ||
            (dep.status === "blocked" && dep.blockReason === "dependency_failed")
          )
        );

      if (failedDep) {
        await deps.store.patchWorker(runId, worker.id, {
          status: "blocked",
          blockReason: "dependency_failed" as any,
          error: `Dependency ${failedDep.id} failed: ${failedDep.error ?? "unknown"}`,
        });
        result.dependencyBlocked.push(worker.id);
        changed = true;
      }
    }
  }

  // Approval resolution
  if (deps.isApproved) {
    const renewedRun = await deps.store.load(runId);
    if (renewedRun) {
      for (const worker of renewedRun.workers) {
        if (worker.status === "blocked" && worker.blockReason === "approval_required" && worker.approvalId) {
          if (await deps.isApproved(worker.approvalId)) {
            await deps.store.patchWorker(runId, worker.id, {
              status: "pending",
              blockReason: undefined,
              approvalId: undefined,
              authorizationEvidence: undefined,
              error: undefined,
            } as any);
            result.approvalResumed.push(worker.id);
          }
        }
      }
    }
  }

  // Reload for final status
  const finalRun = await deps.store.load(runId);
  result.status = finalRun?.status ?? "unknown";
  return result;
}

async function releaseWorkerLeases(store: CoordinationStore, runId: string, worker: WorkerAssignment): Promise<void> {
  if (worker.leaseIds && worker.leaseIds.length > 0) {
    await store.patchWorker(runId, worker.id, { leaseIds: [] } as any);
  }
}
