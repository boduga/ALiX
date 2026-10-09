/**
 * rollback-executor.ts — Execute a RollbackPlan with dry-run or approved-live modes.
 *
 * Dry-run: shows what would be restored/deleted without mutations.
 * Approved-live: restores from before snapshots / deletes created files with approval.
 *
 * Idempotency (approved-live):
 *   - "rollback-completed" state → no-op result (all done)
 *   - "rollback-partial" without --resume → refuse with suggestion
 *   - Lock acquired before execution, released after completion
 *   - Step-level progress tracked for crash recovery
 *   - Completed paths skipped on resume
 */

import { existsSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EventLog } from "../events/event-log.js";
import { ROLLBACK_EVENT_TYPES } from "../events/types.js";
import type { RollbackPlan, RollbackStepAction, RollbackMode } from "./rollback-plan.js";
import type { ReplayStatusIndex } from "./replay-status-index.js";
import type { ReplayLock } from "./replay-lock.js";
import type { RollbackProgressStore } from "./rollback-progress.js";

// ─── Types ───────────────────────────────────────────────────────────

export type RollbackStepResult = {
  index: number;
  path: string;
  action: RollbackStepAction;
  status: "completed" | "blocked" | "skipped";
  output?: string;
  error?: string;
  blockReason?: string;
  durationMs?: number;
};

export type RollbackResult = {
  rollbackId: string;
  replayId: string;
  mode: RollbackMode;
  steps: RollbackStepResult[];
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  totalSteps: number;
  successCount: number;
  blockedCount: number;
  skippedCount: number;
  warnings: string[];
  resumed?: boolean;
  completionStatus?: "completed" | "partial" | "noop" | "blocked";
};

export type RollbackExecuteOptions = {
  approvalStore?: any;
  resume?: boolean;
  statusIndex?: ReplayStatusIndex;
  replayLock?: ReplayLock;
  progressStore?: RollbackProgressStore;
};

// ─── RollbackExecutor ────────────────────────────────────────────────

export class RollbackExecutor {
  constructor(
    private cwd: string,
    private eventLog: EventLog,
  ) {}

  private sessionId(): string {
    const parts = this.eventLog.sessionDir.split("sessions/");
    return parts.length > 1 ? parts[1] : "unknown";
  }

  private async logEvent(type: string, payload: Record<string, unknown>): Promise<void> {
    await this.eventLog.append({ sessionId: this.sessionId(), actor: "system", type, payload });
  }

  async execute(plan: RollbackPlan, opts?: RollbackExecuteOptions): Promise<RollbackResult> {
    // Dry-run mode — simple, no locking or idempotency needed
    if (plan.mode === "dry-run") {
      return this.executeDryRun(plan, opts);
    }

    // Approved-live mode — full idempotency, locking, progress tracking
    return this.executeApprovedLive(plan, opts);
  }

  private async executeDryRun(plan: RollbackPlan, opts?: RollbackExecuteOptions): Promise<RollbackResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    await this.logEvent(ROLLBACK_EVENT_TYPES.STARTED, {
      rollbackId: plan.rollbackId,
      replayId: plan.replayId,
      mode: plan.mode,
    });

    // Update status to rollback-dry-run if status index available
    if (opts?.statusIndex) {
      await opts.statusIndex.setStatus(plan.replayId, "rollback-dry-run");
    }

    const stepResults: RollbackStepResult[] = [];
    let successCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepStart = Date.now();
      const stepResult: RollbackStepResult = {
        index: i + 1,
        path: step.path,
        action: step.action,
        status: "completed",
      };

      await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_STARTED, {
        rollbackId: plan.rollbackId,
        replayId: plan.replayId,
        path: step.path,
        action: step.action,
      });

      if (step.action === "skip") {
        await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_SKIPPED, {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          path: step.path,
          reason: step.reason,
        });
        stepResult.status = "skipped";
        stepResult.durationMs = 0;
        skippedCount++;
        stepResults.push(stepResult);
        continue;
      }

      const output = step.action === "restore"
        ? `[DRY-RUN] Would restore: ${step.path}`
        : `[DRY-RUN] Would delete: ${step.path}`;

      await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_COMPLETED, {
        rollbackId: plan.rollbackId,
        replayId: plan.replayId,
        path: step.path,
        action: step.action,
        status: "completed",
        outputPreview: output.slice(0, 200),
      });
      stepResult.status = "completed";
      stepResult.output = output;
      stepResult.durationMs = Date.now() - stepStart;
      successCount++;
      stepResults.push(stepResult);
    }

    const totalDurationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    await this.logEvent(ROLLBACK_EVENT_TYPES.COMPLETED, {
      rollbackId: plan.rollbackId,
      replayId: plan.replayId,
      mode: plan.mode,
      stepCount: plan.steps.length,
      successCount,
      blockedCount: 0,
      skippedCount,
      totalDurationMs,
    });

    return {
      rollbackId: plan.rollbackId,
      replayId: plan.replayId,
      mode: plan.mode,
      steps: stepResults,
      startedAt,
      completedAt,
      totalDurationMs,
      totalSteps: plan.steps.length,
      successCount,
      blockedCount: 0,
      skippedCount,
      warnings: [],
      completionStatus: "completed",
    };
  }

  private async executeApprovedLive(plan: RollbackPlan, opts?: RollbackExecuteOptions): Promise<RollbackResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const statusIndex = opts?.statusIndex;
    const replayLock = opts?.replayLock;
    const progressStore = opts?.progressStore;

    // ── Step 1: Check status index for idempotency ──────────────
    if (statusIndex) {
      const status = await statusIndex.getStatus(plan.replayId);

      if (status === "rollback-completed") {
        // Already done — return no-op result
        const completedAt = new Date().toISOString();
        await this.logEvent(ROLLBACK_EVENT_TYPES.STARTED, {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          mode: plan.mode,
          note: "noop — rollback already completed",
        });
        await this.logEvent(ROLLBACK_EVENT_TYPES.COMPLETED, {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          mode: plan.mode,
          stepCount: 0,
          successCount: 0,
          blockedCount: 0,
          skippedCount: 0,
          totalDurationMs: 0,
          note: "noop — rollback already completed",
        });
        return {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          mode: plan.mode,
          steps: [],
          startedAt,
          completedAt,
          totalDurationMs: 0,
          totalSteps: 0,
          successCount: 0,
          blockedCount: 0,
          skippedCount: 0,
          warnings: ["Rollback already completed — no action taken"],
          completionStatus: "noop",
        };
      }

      if (status === "rollback-partial" && !opts?.resume) {
        // Partial rollback without resume — refuse
        const completedAt = new Date().toISOString();
        await this.logEvent(ROLLBACK_EVENT_TYPES.STARTED, {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          mode: plan.mode,
          note: "refused — partial rollback requires --resume",
        });
        return {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          mode: plan.mode,
          steps: [],
          startedAt,
          completedAt,
          totalDurationMs: 0,
          totalSteps: 0,
          successCount: 0,
          blockedCount: 0,
          skippedCount: 0,
          warnings: [
            `Rollback for ${plan.replayId} is in "rollback-partial" state. Use --resume to continue from the last incomplete step, or forceRelease if the lock is stale.`,
          ],
          completionStatus: "blocked",
        };
      }
    }

    // ── Step 2: Acquire lock ──────────────────────────────────
    if (replayLock) {
      const acquired = await replayLock.acquire(plan.replayId, "rollback");
      if (!acquired) {
        const completedAt = new Date().toISOString();
        await this.logEvent(ROLLBACK_EVENT_TYPES.STARTED, {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          mode: plan.mode,
          note: "blocked — another process holds the lock",
        });
        return {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          mode: plan.mode,
          steps: [],
          startedAt,
          completedAt,
          totalDurationMs: 0,
          totalSteps: 0,
          successCount: 0,
          blockedCount: 0,
          skippedCount: 0,
          warnings: ["Another process holds the lock for this replayId. Try again later or use --resume to force-release a stale lock."],
          completionStatus: "blocked",
        };
      }
    }

    try {
      // ── Step 3: Initialize/load progress ─────────────────────
      let isResumed = false;
      let completedPaths: string[] = [];
      let lastCompletedIndex = -1;

      if (progressStore) {
        const existing = await progressStore.load(plan.replayId);
        if (existing && existing.status === "partial" && opts?.resume) {
          isResumed = true;
          completedPaths = existing.completedPaths;
          lastCompletedIndex = existing.lastCompletedStepIndex;
          // Reset status to running for the resumed execution
          await progressStore.initProgress(plan.replayId, plan.rollbackId);
        } else if (!existing) {
          await progressStore.initProgress(plan.replayId, plan.rollbackId);
        } else if (existing.status === "completed") {
          // Progress says completed but status index should have caught this.
          // Belt-and-suspenders: treat as no-op.
          const completedAt = new Date().toISOString();
          return {
            rollbackId: plan.rollbackId,
            replayId: plan.replayId,
            mode: plan.mode,
            steps: [],
            startedAt,
            completedAt,
            totalDurationMs: 0,
            totalSteps: 0,
            successCount: 0,
            blockedCount: 0,
            skippedCount: 0,
            warnings: ["Rollback progress indicates already completed — no action taken"],
            completionStatus: "noop",
          };
        }
      }

      // ── Step 4: Set status to rollback-running ───────────────
      if (statusIndex) {
        await statusIndex.setStatus(plan.replayId, "rollback-running");
      }

      await this.logEvent(ROLLBACK_EVENT_TYPES.STARTED, {
        rollbackId: plan.rollbackId,
        replayId: plan.replayId,
        mode: plan.mode,
        resumed: isResumed,
      });

      // ── Step 5: Execute steps ────────────────────────────────
      const stepResults: RollbackStepResult[] = [];
      let successCount = 0;
      let blockedCount = 0;
      let skippedCount = 0;
      let hadError = false;

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        const stepIndex = i + 1;
        const stepStart = Date.now();
        const stepResult: RollbackStepResult = {
          index: stepIndex,
          path: step.path,
          action: step.action,
          status: "completed",
        };

        // Skip already-completed paths on resume
        if (isResumed && completedPaths.includes(step.path)) {
          await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_SKIPPED, {
            rollbackId: plan.rollbackId,
            replayId: plan.replayId,
            path: step.path,
            action: step.action,
            reason: "already completed in previous run",
          });
          stepResult.status = "skipped";
          stepResult.output = "Skipped (already completed)";
          stepResult.durationMs = 0;
          skippedCount++;
          stepResults.push(stepResult);
          continue;
        }

        // Skip resumed steps before the lastCompletedIndex + 1
        // (index is 1-based, lastCompletedStepIndex is 0-based)
        if (isResumed && stepIndex <= lastCompletedIndex) {
          await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_SKIPPED, {
            rollbackId: plan.rollbackId,
            replayId: plan.replayId,
            path: step.path,
            action: step.action,
            reason: "before resume point",
          });
          stepResult.status = "skipped";
          stepResult.output = "Skipped (before resume point)";
          stepResult.durationMs = 0;
          skippedCount++;
          stepResults.push(stepResult);
          continue;
        }

        if (step.action === "skip") {
          await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_SKIPPED, {
            rollbackId: plan.rollbackId,
            replayId: plan.replayId,
            path: step.path,
            reason: step.reason,
          });
          stepResult.status = "skipped";
          stepResult.durationMs = 0;
          skippedCount++;
          stepResults.push(stepResult);
          continue;
        }

        await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_STARTED, {
          rollbackId: plan.rollbackId,
          replayId: plan.replayId,
          path: step.path,
          action: step.action,
        });

        // Check for approval
        const store = opts?.approvalStore;
        if (store) {
          const allApprovals = store.list();
          const toolId = step.action === "restore" ? "file.restore" : "file.delete";
          const matching = allApprovals.find((a: any) =>
            a.toolId === toolId
          );

          if (!matching || matching.status !== "approved") {
            const created = await store.request({
              reason: `Rollback ${plan.rollbackId}: ${step.action} ${step.path}`,
              capability: "file.write",
              sessionId: this.sessionId(),
              toolId,
            });

            await this.logEvent("approval.created", {
              approvalId: created.id,
              rollbackId: plan.rollbackId,
              replayId: plan.replayId,
              path: step.path,
              action: step.action,
              status: "pending",
            });

            stepResult.status = "blocked";
            stepResult.blockReason = `Approval required: ${created.id}`;
            stepResult.durationMs = Date.now() - stepStart;
            blockedCount++;
            stepResults.push(stepResult);
            continue;
          }
        } else {
          stepResult.status = "blocked";
          stepResult.blockReason = "Approval store required for approved-live rollback";
          stepResult.durationMs = Date.now() - stepStart;
          blockedCount++;
          stepResults.push(stepResult);
          continue;
        }

        // Execute the rollback action
        try {
          if (step.action === "restore" && step.beforeSnapshotPath) {
            const resolvedPath = resolve(this.cwd, step.path);
            mkdirSync(dirname(resolvedPath), { recursive: true });
            copyFileSync(step.beforeSnapshotPath, resolvedPath);

            await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_COMPLETED, {
              rollbackId: plan.rollbackId,
              replayId: plan.replayId,
              path: step.path,
              action: step.action,
              status: "completed",
              outputPreview: "File restored from snapshot",
            });
            stepResult.status = "completed";
            stepResult.output = "File restored: " + step.path;
            successCount++;
          } else if (step.action === "delete-created") {
            const resolvedPath = resolve(this.cwd, step.path);
            if (existsSync(resolvedPath)) {
              rmSync(resolvedPath);
            }

            await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_COMPLETED, {
              rollbackId: plan.rollbackId,
              replayId: plan.replayId,
              path: step.path,
              action: step.action,
              status: "completed",
              outputPreview: "File deleted (was created during replay)",
            });
            stepResult.status = "completed";
            stepResult.output = "File deleted: " + step.path;
            successCount++;
          }
        } catch (err: any) {
          await this.logEvent(ROLLBACK_EVENT_TYPES.STEP_BLOCKED, {
            rollbackId: plan.rollbackId,
            replayId: plan.replayId,
            path: step.path,
            action: step.action,
            error: err.message,
          });
          stepResult.status = "blocked";
          stepResult.error = err.message;
          blockedCount++;
          hadError = true;
        }

        stepResult.durationMs = Date.now() - stepStart;
        stepResults.push(stepResult);

        // Track progress if store available
        if (progressStore && stepResult.status === "completed") {
          await progressStore.markStepCompleted(plan.replayId, plan.rollbackId, stepIndex - 1, step.path);
        } else if (progressStore && hadError) {
          await progressStore.markFailed(plan.replayId, plan.rollbackId, step.path);
        }

        // Stop on error
        if (hadError) break;
      }

      // ── Step 6: Determine completion status ─────────────────
      let completionStatus: "completed" | "partial" = "completed";
      if (hadError) {
        completionStatus = "partial";
      }

      if (statusIndex) {
        const newStatus = completionStatus === "completed" ? "rollback-completed" : "rollback-partial";
        await statusIndex.setStatus(plan.replayId, newStatus);
      }

      if (progressStore && completionStatus === "completed") {
        await progressStore.markCompleted(plan.replayId, plan.rollbackId);
      }

      const totalDurationMs = Date.now() - startTime;
      const completedAt = new Date().toISOString();

      await this.logEvent(ROLLBACK_EVENT_TYPES.COMPLETED, {
        rollbackId: plan.rollbackId,
        replayId: plan.replayId,
        mode: plan.mode,
        stepCount: plan.steps.length,
        successCount,
        blockedCount,
        skippedCount,
        totalDurationMs,
        completionStatus,
        resumed: isResumed,
      });

      return {
        rollbackId: plan.rollbackId,
        replayId: plan.replayId,
        mode: plan.mode,
        steps: stepResults,
        startedAt,
        completedAt,
        totalDurationMs,
        totalSteps: plan.steps.length,
        successCount,
        blockedCount,
        skippedCount,
        warnings: [],
        resumed: isResumed,
        completionStatus,
      };

    } finally {
      // ── Step 7: Release lock ────────────────────────────────
      if (replayLock) {
        await replayLock.release(plan.replayId);
      }
    }
  }
}
