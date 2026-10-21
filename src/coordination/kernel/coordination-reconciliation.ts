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
import { releaseWorkerLeases } from "./coordination-ownership.js";

export interface Clock {
  now(): Date;
}

export type ReconciliationResult = {
  runId: string;
  orphaned: string[];
  dependencyBlocked: string[];
  approvalResumed: string[];
  /** Workers failed because an operator explicitly DENIED their approval. */
  approvalDenied: string[];
  status: string;
};

/**
 * Durable evidence that a worker's execution was refused by an operator denial.
 *
 * The denied attempt must never resume: the worker is terminal `failed`, and
 * dependents are attributed through the ordinary dependency-failure path.
 */
export type WorkerApprovalDenial = {
  approvalId: string;
  capability: string;
  /** When the operator's denial was recorded. */
  deniedAt?: string;
  /** The status observed on the bound record. Always `denied` for this path. */
  status: "denied";
};

export type ReconciliationDeps = {
  store: CoordinationStore;
  ownershipRegistry: OwnershipRegistry;
  orphanThresholdMs: number;
  clock?: Clock;
  isApproved?: (worker: WorkerAssignment, run: CoordinationRun) => Promise<boolean>;
  /**
   * Returns evidence when a currently-bound approval for this worker was
   * explicitly DENIED by an operator, otherwise null.
   *
   * Deliberately separate from `isApproved`: `pending`, `expired`, `revoked`,
   * `invalidated` and stale/mismatched records are NOT denials and must keep
   * their own semantics (keep waiting, or fail closed with their own reason).
   */
  approvalDenial?: (worker: WorkerAssignment, run: CoordinationRun) => Promise<WorkerApprovalDenial | null>;
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
    approvalDenied: [],
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
    const release = await releaseWorkerLeases(deps.ownershipRegistry, worker);
    // RESET FOR A BOUNDED RETRY, do not terminate.
    //
    // The root AGENTS contract is explicit: reclaim "reset workers to pending
    // and increment attempts within their limit". This path marked them
    // `failed`, which is terminal — so a host crash permanently destroyed the
    // worker's work instead of retrying it, and the run then reported `failed`
    // even when every artifact landed on disk. Observed on a real gpt-4o restart
    // scenario: worker failed with "host cli-107336 is dead" at attempt 1 of 3,
    // while its artifact was already correct.
    //
    // `coordination-resume.ts` already does this correctly (pending + attempt+1,
    // failed lease releases retained). This mirrors it so the two reclaim paths
    // cannot diverge. Attempts stay bounded by `maxAttempts` in the scheduler.
    const nextAttempt = (worker.attempt ?? 0) + 1;
    const exhausted = nextAttempt > (worker.maxAttempts ?? 3);
    await deps.store.patchWorker(runId, worker.id, exhausted
      ? {
          status: "failed",
          blockReason: "orphaned",
          failureKind: "orphaned",
          leaseIds: release.failed,
          error: `Worker orphaned and out of attempts (${nextAttempt - 1}/${worker.maxAttempts ?? 3}) — host ${worker.executionOwnerId ?? "unknown"} is dead`,
        }
      : {
          status: "pending",
          executionOwnerId: undefined,
          leaseIds: release.failed,
          blockReason: undefined,
          failureKind: undefined,
          attempt: nextAttempt,
          error: worker.executionOwnerId
            ? `Reclaimed after host ${worker.executionOwnerId} stopped`
            : `Reclaimed after heartbeat ${worker.lastHeartbeatAt} exceeded threshold`,
        });
  }

  // Approval resolution
  if (deps.isApproved || deps.approvalDenial) {
    const renewedRun = await deps.store.load(runId);
    if (renewedRun) {
      for (const worker of renewedRun.workers) {
        if (worker.status === "blocked" && worker.blockReason === "approval_required" && worker.approvalId) {
          // An operator DENIAL is terminal and takes precedence over resumption:
          // a definitive refusal must never be re-read as an approval on a later
          // tick, and the denied attempt must never redispatch.
          const denial = deps.approvalDenial ? await deps.approvalDenial(worker, renewedRun) : null;
          if (denial) {
            await deps.store.patchWorker(runId, worker.id, {
              status: "failed",
              blockReason: "execution_failed",
              failureKind: "approval_denied",
              // Preserve the exact authorization evidence the decision was made
              // against: which approval, which capability, and the observed
              // denial. This is the durable record a later reader reconstructs
              // the refusal from.
              approvalId: denial.approvalId,
              error: `Approval ${denial.approvalId} denied for capability ${denial.capability}`,
              completedAt: new Date().toISOString(),
              approvalDeniedAt: denial.deniedAt,
              approvalDeniedCapability: denial.capability,
            } as any);
            result.approvalDenied.push(worker.id);
            continue;
          }

          if (deps.isApproved && await deps.isApproved(worker, renewedRun)) {
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

  // Reload for final status
  const finalRun = await deps.store.load(runId);
  result.status = finalRun?.status ?? "unknown";
  return result;
}
