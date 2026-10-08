/**
 * coordination-reconciliation.ts — Restart-safe reconciliation for coordination runs.
 *
 * Responsibilities:
 *   - Orphan recovery via the ONE liveness verdict
 *     (`owner-liveness.shouldReclaimWorker`: provably dead owner, or
 *     ownerless + stale heartbeat; never locally active workers)
 *   - Transitive dependency failure propagation
 *   - Approval resolution (resume workers when approved)
 *   - Ownership conflict retry state reset
 *
 * Reconciliation is the source of truth for scheduler correctness.
 * Events improve responsiveness but are never correctness dependencies.
 */

import type { CoordinationStore } from "./coordination-store.js";
import type { CoordinationRun, WorkerAssignment, WorkerFailureProvenance } from "./coordination-types.js";
import type { OwnershipRegistry } from "../ownership/ownership-registry.js";
import { shouldReclaimWorker } from "./owner-liveness.js";

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
  ownershipRegistry: OwnershipRegistry;
  orphanThresholdMs: number;
  clock?: Clock;
  isApproved?: (worker: WorkerAssignment, run: CoordinationRun) => Promise<boolean>;
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

  // Orphan recovery — ONE shared liveness verdict (R3.3). The pre-R3 rule
  // ("stale heartbeat + any other owner") reclaimed workers from live-but-
  // slow foreign hosts; shouldReclaimWorker requires a provably dead owner
  // (or ownerless + stale heartbeat), matching coordination-resume.
  const run = await deps.store.load(runId);
  if (!run) { result.status = "not_found"; return result; }

  for (const worker of run.workers) {
    const locallyActive = deps.activeExecutionIds?.has(worker.id) ?? false;
    if (!shouldReclaimWorker({
      status: worker.status,
      lastHeartbeatAt: worker.lastHeartbeatAt,
      executionOwnerId: worker.executionOwnerId,
      locallyActive,
      orphanThresholdMs: deps.orphanThresholdMs,
      now,
    })) continue;

    result.orphaned.push(worker.id);
    await releaseWorkerLeases(deps, runId, worker);
    await deps.store.patchWorker(runId, worker.id, {
      status: "failed",
      blockReason: "orphaned" as any,
      failureKind: "orphaned" as any,
      error: worker.executionOwnerId
        ? `Worker orphaned — host ${worker.executionOwnerId} is dead`
        : `Worker orphaned — heartbeat ${worker.lastHeartbeatAt} exceeded threshold`,
    });
  }

  // Transitive dependency failure propagation — fixpoint loop
  let changed = true;
  while (changed) {
    changed = false;
    const currentRun = await deps.store.load(runId);
    if (!currentRun) break;

    for (const worker of currentRun.workers) {
      if (worker.status !== "pending") continue;

      const failedDeps = worker.dependencies
        .map(id => currentRun.workers.find(w => w.id === id))
        .filter((dep): dep is NonNullable<typeof dep> =>
          dep !== undefined && (
            dep.status === "failed" ||
            dep.status === "cancelled" ||
            (dep.status === "blocked" && dep.blockReason === "dependency_failed")
          )
        );

      if (failedDeps.length > 0) {
        const directCauseWorkerIds = [...new Set(failedDeps.map(d => d.id))].sort();
        const rootCauseWorkerIds = [...new Set(
          failedDeps.flatMap(d =>
            d.failureProvenance?.rootCauseWorkerIds ?? [d.id]
          )
        )].sort();

        const failureProvenance: WorkerFailureProvenance = {
          directCauseWorkerIds,
          rootCauseWorkerIds,
          propagatedAt: new Date().toISOString(),
        };

        await deps.store.patchWorker(runId, worker.id, {
          status: "blocked",
          blockReason: "dependency_failed" as any,
          error: `Dependency ${failedDeps[0].id} failed: ${failedDeps[0].error ?? "unknown"}`,
          failureProvenance,
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
          if (await deps.isApproved(worker, renewedRun)) {
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

async function releaseWorkerLeases(deps: ReconciliationDeps, runId: string, worker: WorkerAssignment): Promise<void> {
  if (worker.leaseIds && worker.leaseIds.length > 0) {
    const { releaseWorkerOwnership } = await import("./coordination-ownership.js");
    await releaseWorkerOwnership(deps.ownershipRegistry, worker.leaseIds);
    await deps.store.patchWorker(runId, worker.id, { leaseIds: [] } as any);
  }
}
