/**
 * replan-applier.ts — History-Preserving CAS Applier for coordination replans.
 *
 * Applies a validated PlanRevisionDraft (with associated SimulatedGraph) to a
 * CoordinationRun, enforcing history-preservation rules:
 * - Never splice workers — use supersededByWorkerId / replacementForWorkerId lineage
 * - Only cancel pending/ready/blocked workers
 * - Every replacement gets fresh execution state
 * - Automatic downstream dependency rewiring for replacements
 * - Atomic CAS commit via updateRunWithRevisionCheck
 *
 * All imports use .js extensions (NodeNext).
 */

import type { CoordinationRun, PlanRevision, PlanDiffEntry, WorkerAssignment } from "./coordination-types.js";
import { createWorkerAssignment } from "./coordination-types.js";
import type { PlanRevisionDraft, SimulatedGraph } from "./replan-types.js";
import { CoordinationStore } from "./coordination-store.js";

// ── Types ───────────────────────────────────────────────────────────────

export interface ApplyResult {
  applied: boolean;
  run: CoordinationRun | null;
  revision: PlanRevision | null;
  errors: string[];
}

// ── Fresh execution state template ──────────────────────────────────────
// Applied to every replacement worker to reset all execution-sensitive fields.
// This ensures no stale auth, lease, or result data carries over.

const FRESH_EXECUTION_STATE: Partial<WorkerAssignment> = {
  status: "pending",
  attempt: 0,
  approvalId: undefined,
  authorizationEvidence: undefined,
  leaseIds: [],
  executionOwnerId: undefined,
  resultRef: undefined,
  error: undefined,
  startedAt: undefined,
  completedAt: undefined,
  lastHeartbeatAt: undefined,
};

// ── Cancel guard set ────────────────────────────────────────────────────

const CANCEL_ALLOWED_STATUSES = new Set(["pending", "ready", "blocked"]);

// ── ReplanApplier ───────────────────────────────────────────────────────

export class ReplanApplier {
  constructor(private store: CoordinationStore) {}

  /**
   * Apply a validated replan draft to the given coordination run.
   * Uses CAS (compare-and-swap) via planRevision to ensure no concurrent
   * replan has been applied while this one was being computed.
   *
   * The draft must have passed structural validation and graph simulation
   * before being passed to apply().
   */
  async apply(
    draft: PlanRevisionDraft,
    graph: SimulatedGraph,
    runId: string,
  ): Promise<ApplyResult> {
    const run = await this.store.load(runId);
    if (!run) {
      return { applied: false, run: null, revision: null, errors: ["Run not found"] };
    }

    const expectedRev = run.planRevision ?? 0;

    try {
      const updated = await this.store.updateRunWithRevisionCheck(
        runId,
        expectedRev,
        (r) => this.applyDraft(r, draft, graph),
      );

      if (!updated) {
        return {
          applied: false,
          run: null,
          revision: null,
          errors: ["CAS conflict — planRevision mismatch"],
        };
      }

      // Extract the latest revision from history
      const history = updated.revisionHistory ?? [];
      const revision = history.length > 0 ? history[history.length - 1] : null;
      return { applied: true, run: updated, revision, errors: [] };
    } catch (err) {
      return {
        applied: false,
        run: null,
        revision: null,
        errors: [err instanceof Error ? err.message : String(err)],
      };
    }
  }

  // ── Private ───────────────────────────────────────────────────────────

  /**
   * Core mutation logic: applies all draft operations inside the CAS callback.
   *
   * Throws on missing workers or invalid status transitions so that the CAS
   * callback aborts without writing any partial state (no partial commit).
   */
  private applyDraft(
    run: CoordinationRun,
    draft: PlanRevisionDraft,
    graph: SimulatedGraph,
  ): void {
    const diffs: PlanDiffEntry[] = [];

    // ── 1. Cancel workers ───────────────────────────────────────────────
    // Only pending/ready/blocked workers may be cancelled. Any other status
    // causes a hard abort — we never silently skip.

    for (const workerId of draft.workersToCancel) {
      const worker = run.workers.find((w) => w.id === workerId);
      if (!worker) {
        throw new Error(`Worker not found for cancellation: ${workerId}`);
      }
      if (!CANCEL_ALLOWED_STATUSES.has(worker.status as string)) {
        throw new Error(
          `Cannot cancel worker ${workerId} in status "${worker.status}" — ` +
            "only pending/ready/blocked allowed",
        );
      }
      worker.status = "cancelled";
      worker.updatedAt = new Date().toISOString();
      diffs.push({
        workerId,
        change: "removed",
        taskLabel: worker.taskLabel,
        reason: `Cancelled by replan (${draft.triggerKind})`,
      });
    }

    // ── 2. Replace workers ──────────────────────────────────────────────
    // The existing worker is never spliced — it stays in the array with
    // supersededByWorkerId set. A brand-new replacement worker is pushed
    // with replacementForWorkerId for lineage tracing.

    for (const replaceSpec of draft.workersToReplace) {
      const targetWorker = run.workers.find(
        (w) => w.id === replaceSpec.targetWorkerId,
      );
      if (!targetWorker) {
        throw new Error(
          `Worker not found for replacement: ${replaceSpec.targetWorkerId}`,
        );
      }

      const durableId = graph.idMap[replaceSpec.replacement.draftWorkerId];
      if (!durableId) {
        throw new Error(
          `No durable ID mapping for draftWorkerId: ${replaceSpec.replacement.draftWorkerId}`,
        );
      }

      // Mark the existing worker as superseded — lineage preserved
      targetWorker.supersededByWorkerId = durableId;
      targetWorker.updatedAt = new Date().toISOString();

      // Map dependencies through idMap (draftWorkerId → durable ID)
      const mappedDeps = replaceSpec.replacement.dependencies.map(
        (d) => graph.idMap[d] ?? d,
      );

      const replacementWorker = createWorkerAssignment({
        id: durableId,
        coordinationRunId: run.id,
        agentId: "unassigned",
        taskLabel: replaceSpec.replacement.taskLabel,
        goalPrompt: replaceSpec.replacement.goalPrompt,
        dependencies: mappedDeps,
        requiredCapabilities: replaceSpec.replacement.requiredCapabilities,
        replacementForWorkerId: replaceSpec.targetWorkerId,
      });

      // Wipe execution state — no stale data carries over
      Object.assign(replacementWorker, FRESH_EXECUTION_STATE);
      replacementWorker.updatedAt = new Date().toISOString();

      run.workers.push(replacementWorker);

      diffs.push({
        workerId: durableId,
        change: "added",
        taskLabel: replacementWorker.taskLabel,
        reason: replaceSpec.reason,
      });
    }

    // Auto-rewire downstream dependencies for replacements.
    // This updates every existing worker whose dependencies reference a
    // replaced worker ID, UNLESS an explicit DependencyRewire overrides
    // that specific pair.
    this.autoRewireDependencies(run, draft, graph);

    // ── 3. Add new workers ──────────────────────────────────────────────

    for (const addSpec of draft.workersToAdd) {
      const durableId = graph.idMap[addSpec.draftWorkerId];
      if (!durableId) {
        throw new Error(
          `No durable ID mapping for draftWorkerId: ${addSpec.draftWorkerId}`,
        );
      }

      const mappedDeps = addSpec.dependencies.map(
        (d) => graph.idMap[d] ?? d,
      );

      const newWorker = createWorkerAssignment({
        id: durableId,
        coordinationRunId: run.id,
        agentId: "unassigned",
        taskLabel: addSpec.taskLabel,
        goalPrompt: addSpec.goalPrompt,
        dependencies: mappedDeps,
        requiredCapabilities: addSpec.requiredCapabilities,
      });

      // Fresh execution state applies to new workers too
      Object.assign(newWorker, FRESH_EXECUTION_STATE);
      newWorker.updatedAt = new Date().toISOString();

      run.workers.push(newWorker);

      diffs.push({
        workerId: durableId,
        change: "added",
        taskLabel: addSpec.taskLabel,
        reason: "Added by replan",
      });
    }

    // ── 4. Modify workers ───────────────────────────────────────────────

    for (const modifySpec of draft.workersToModify) {
      const worker = run.workers.find((w) => w.id === modifySpec.workerId);
      if (!worker) {
        throw new Error(
          `Worker not found for modification: ${modifySpec.workerId}`,
        );
      }
      if (modifySpec.goalPrompt !== undefined) {
        worker.goalPrompt = modifySpec.goalPrompt;
      }
      if (modifySpec.dependencies !== undefined) {
        worker.dependencies = [...modifySpec.dependencies];
      }
      worker.updatedAt = new Date().toISOString();

      diffs.push({
        workerId: modifySpec.workerId,
        change: "modified",
        taskLabel: worker.taskLabel,
        goalPrompt: modifySpec.goalPrompt,
        reason: "Modified by replan",
      });
    }

    // ── 5. Apply explicit dependency rewiring ───────────────────────────

    for (const rewire of draft.dependencyRewiring) {
      const dependent = run.workers.find(
        (w) => w.id === rewire.dependentWorkerRef,
      );
      if (!dependent) {
        throw new Error(
          `Dependent worker not found for dependency rewiring: ${rewire.dependentWorkerRef}`,
        );
      }
      // Remove the old dependency if present
      if (rewire.removeDependencyRef) {
        const idx = dependent.dependencies.indexOf(
          rewire.removeDependencyRef,
        );
        if (idx !== -1) {
          dependent.dependencies.splice(idx, 1);
        }
      }
      // Add the new dependency if specified and not already present
      if (
        rewire.addDependencyRef &&
        !dependent.dependencies.includes(rewire.addDependencyRef)
      ) {
        dependent.dependencies.push(rewire.addDependencyRef);
      }
      dependent.updatedAt = new Date().toISOString();

      diffs.push({
        workerId: rewire.dependentWorkerRef,
        change: "modified",
        reason: `Dependency rewired: removed "${rewire.removeDependencyRef}", added "${rewire.addDependencyRef}"`,
      });
    }

    // ── 6. Build and append PlanRevision ────────────────────────────────

    const revision: PlanRevision = {
      revisionNumber: run.planRevision + 1,
      timestamp: new Date().toISOString(),
      reason:
        draft.expectedBenefit ||
        `Replan triggered by ${draft.triggerKind}`,
      triggerKind: draft.triggerKind,
      triggerWorkerId: draft.triggerEvidence.workerId,
      conflictIds:
        draft.triggerEvidence.conflictIds?.length
          ? draft.triggerEvidence.conflictIds
          : undefined,
      diff: diffs,
    };

    run.revisionHistory = run.revisionHistory ?? [];
    run.revisionHistory.push(revision);

    // ── 7. Advance status to running ────────────────────────────────────
    // (planRevision is incremented by the store after this callback returns)

    run.status = "running";
    run.updatedAt = new Date().toISOString();
  }

  /**
   * Automatically rewire downstream dependencies for replaced workers.
   *
   * For each replaced worker (targetWorkerId → replacement durable ID),
   * find every existing worker that depends on targetWorkerId and update
   * that dependency to point to the replacement, UNLESS an explicit
   * DependencyRewire in the draft already handles that specific pair.
   *
   * This ensures downstream workers continue to express the intended
   * ordering constraint without requiring every replacement to include
   * explicit rewiring entries.
   */
  private autoRewireDependencies(
    run: CoordinationRun,
    draft: PlanRevisionDraft,
    graph: SimulatedGraph,
  ): void {
    // Build index of explicit rewire entries so we skip auto-rewiring
    // for pairs the draft author deliberately handled.
    const explicitRewires = new Set<string>();
    for (const rw of draft.dependencyRewiring) {
      explicitRewires.add(`${rw.dependentWorkerRef}:${rw.removeDependencyRef}`);
    }

    for (const replaceSpec of draft.workersToReplace) {
      const targetId = replaceSpec.targetWorkerId;
      const replacementId =
        graph.idMap[replaceSpec.replacement.draftWorkerId];

      // If the draft created no durable mapping for this replacement,
      // skip auto-rewiring (the earlier replace step would have thrown,
      // so this is defensive only).
      if (!replacementId) continue;

      // Scan every worker — if it depends on the replaced worker and
      // doesn't have an explicit rewire entry, update the dependency.
      for (const worker of run.workers) {
        const depIdx = worker.dependencies.indexOf(targetId);
        if (depIdx === -1) continue;

        // Explicit override present?  Skip auto-rewiring.
        if (explicitRewires.has(`${worker.id}:${targetId}`)) continue;

        worker.dependencies[depIdx] = replacementId;
        worker.updatedAt = new Date().toISOString();
      }
    }
  }
}
