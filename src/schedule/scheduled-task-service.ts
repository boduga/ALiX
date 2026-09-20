/**
 * scheduled-task-service.ts — materializes approved schedules and ticks due jobs.
 *
 * Mirrors CoordinationSchedulerService: the daemon owns the timer, this owns the
 * logic. Two phases, both idempotent:
 *   materializeApproved() — an approved `schedule.propose` approval becomes one
 *     active job (keyed by approvalId, so re-approval or restart never doubles it).
 *   tick() — due active jobs are enqueued on the daemon task queue and their
 *     next run is advanced; expired jobs are retired.
 *
 * Dependency-injected so it is unit-testable without a daemon or filesystem.
 */

import { advanceNextRun, nextRunAfter, MAX_ACTIVE_JOBS } from "./schedule-spec.js";
import { SCHEDULE_CAPABILITY, validateProposal } from "./propose.js";
import type { ScheduledTaskStore } from "./scheduled-task-store.js";
import type { ApprovalStore } from "../approvals/approval-store.js";

export type ScheduleServiceDeps = {
  approvals: ApprovalStore;
  tasks: ScheduledTaskStore;
  /** Queue a task for execution (daemon: TaskRegistry.create). */
  enqueue: (task: string, cwd: string) => void;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
};

export type MaterializeSummary = { created: string[]; skipped: string[] };
export type TickSummary = { enqueued: string[]; expired: string[] };

export class ScheduledTaskService {
  private readonly deps: ScheduleServiceDeps;

  constructor(deps: ScheduleServiceDeps) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** Turn each newly approved schedule into exactly one active job. */
  async materializeApproved(): Promise<MaterializeSummary> {
    const now = this.now();
    const created: string[] = [];
    const skipped: string[] = [];

    const approved = this.deps.approvals
      .list()
      .filter((a) => a.status === "approved" && a.capabilities.includes(SCHEDULE_CAPABILITY));

    for (const approval of approved) {
      if (this.deps.tasks.findByApprovalId(approval.id)) {
        skipped.push(approval.id);
        continue;
      }
      const validated = validateProposal(approval.metadata?.scheduleProposal, now);
      if (!validated.ok) {
        skipped.push(approval.id);
        continue;
      }
      if (this.deps.tasks.activeCount() >= MAX_ACTIVE_JOBS) {
        skipped.push(approval.id);
        continue;
      }
      const p = validated.proposal;
      this.deps.tasks.create({
        name: p.name,
        task: p.task,
        cwd: p.cwd,
        schedule: p.schedule,
        status: "active",
        approvalId: approval.id,
        ...(approval.decidedBy !== undefined ? { approvedBy: approval.decidedBy } : {}),
        expiresAt: `${p.expires}T23:59:59`,
        nextRunAt: nextRunAfter(p.schedule, now).toISOString(),
        ...(approval.sessionId !== undefined ? { sessionId: approval.sessionId } : {}),
      });
      created.push(p.name);
    }
    return { created, skipped };
  }

  /** Enqueue due jobs and retire expired ones. */
  async tick(): Promise<TickSummary> {
    const now = this.now();
    const enqueued: string[] = [];
    const expired: string[] = [];

    // Retire expired jobs first so `due()` cannot enqueue a job past its horizon.
    for (const task of this.deps.tasks.list()) {
      if (task.status !== "active") continue;
      if (Date.parse(task.expiresAt) <= now.getTime()) {
        this.deps.tasks.update(task.id, { status: "expired" });
        expired.push(task.name);
      }
    }

    for (const task of this.deps.tasks.due(now)) {
      this.deps.enqueue(task.task, task.cwd);
      this.deps.tasks.update(task.id, {
        lastRunAt: now.toISOString(),
        runCount: task.runCount + 1,
        nextRunAt: advanceNextRun(task.schedule, new Date(task.nextRunAt), now).toISOString(),
      });
      enqueued.push(task.name);
    }
    return { enqueued, expired };
  }

  async runOnce(): Promise<{ materialized: MaterializeSummary; ticked: TickSummary }> {
    // Re-read both stores: the human may have approved a proposal (or the CLI
    // revoked a job) since the last cycle, and the daemon is long-lived.
    await this.deps.approvals.load?.().catch(() => {});
    await this.deps.tasks.load?.().catch(() => {});
    const materialized = await this.materializeApproved();
    const ticked = await this.tick();
    return { materialized, ticked };
  }
}
