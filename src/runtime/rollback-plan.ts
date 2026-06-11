/**
 * rollback-plan.ts — Build an executable rollback plan from a ReplayDiffSet.
 *
 * Maps each ReplayDiffRecord to a RollbackStep:
 * - modified/deleted with rollbackable=true → "restore"
 * - created → "delete-created"
 * - not rollbackable or missing before snapshot → "skip"
 */

import type { ReplayDiffSet, ReplayDiffRecord } from "./replay-diff-store.js";

// ─── Types ───────────────────────────────────────────────────────────

export type RollbackMode = "dry-run" | "approved-live";

export type RollbackStepAction = "restore" | "delete-created" | "skip";

export type RollbackStep = {
  path: string;
  action: RollbackStepAction;
  rollbackable: boolean;
  reason?: string;
  beforeSnapshotPath?: string;
  afterSnapshotPath?: string;
};

export type RollbackPlan = {
  rollbackId: string;
  replayId: string;
  mode: RollbackMode;
  steps: RollbackStep[];
  createdAt: string;
};

// ─── Builder ─────────────────────────────────────────────────────────

/**
 * Build a RollbackPlan from a ReplayDiffSet.
 */
export function buildRollbackPlan(
  replayId: string,
  diffSet: ReplayDiffSet,
  mode: RollbackMode,
): RollbackPlan {
  const rollbackId = `rollback_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const steps: RollbackStep[] = [];

  for (const record of diffSet.records) {
    let action: RollbackStepAction;
    let reason: string | undefined;

    if (record.changeType === "created") {
      action = "delete-created";
      reason = "File was created during replay — will be deleted";
    } else if ((record.changeType === "modified" || record.changeType === "deleted") && record.rollbackable && record.beforeSnapshotPath) {
      action = "restore";
      reason = `File was ${record.changeType} during replay — will restore from before snapshot`;
    } else {
      action = "skip";
      reason = record.beforeSnapshotPath
        ? "File is not rollbackable"
        : `No before snapshot available for ${record.changeType} file`;
    }

    steps.push({
      path: record.filePath,
      action,
      rollbackable: record.rollbackable,
      reason,
      beforeSnapshotPath: record.beforeSnapshotPath,
      afterSnapshotPath: record.afterSnapshotPath,
    });
  }

  return {
    rollbackId,
    replayId,
    mode,
    steps,
    createdAt: new Date().toISOString(),
  };
}
