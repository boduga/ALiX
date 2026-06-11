/**
 * rollback-executor.ts — Execute a RollbackPlan with dry-run or approved-live modes.
 *
 * Dry-run: shows what would be restored/deleted without mutations.
 * Approved-live: restores from before snapshots / deletes created files with approval.
 */

import { existsSync, copyFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { EventLog } from "../events/event-log.js";
import { ROLLBACK_EVENT_TYPES } from "../events/types.js";
import type { RollbackPlan, RollbackStepAction, RollbackMode } from "./rollback-plan.js";

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
};

export type RollbackExecuteOptions = {
  approvalStore?: any;
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
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    await this.logEvent(ROLLBACK_EVENT_TYPES.STARTED, {
      rollbackId: plan.rollbackId,
      replayId: plan.replayId,
      mode: plan.mode,
    });

    const stepResults: RollbackStepResult[] = [];
    let successCount = 0;
    let blockedCount = 0;
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

      // Dry-run mode: show what would happen
      if (plan.mode === "dry-run") {
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
        continue;
      }

      // Approved-live mode: check for approval, then execute
      if (plan.mode === "approved-live") {
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
        }

        stepResult.durationMs = Date.now() - stepStart;
        stepResults.push(stepResult);
        continue;
      }

      // Fallback
      stepResult.status = "skipped";
      stepResult.durationMs = 0;
      skippedCount++;
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
      blockedCount,
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
      blockedCount,
      skippedCount,
      warnings: [],
    };
  }
}
