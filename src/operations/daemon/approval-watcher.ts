/**
 * approval-watcher.ts — Daemon-hosted approval polling service.
 *
 * Polls ApprovalStore at a configurable interval, expires due approvals,
 * detects newly resolved approvals, and requests scheduler ticks for
 * affected coordination runs.
 *
 * The watcher is separate from CoordinationSchedulerService.
 * Periodic scheduler polling remains authoritative.
 */

import { ApprovalStore } from "../../governance/approvals/approval-store.js";
import { CoordinationSchedulerService } from "./coordination-scheduler-service.js";
import type { ApprovalRecord } from "../../governance/approvals/approval-types.js";

export type ApprovalWatcherOptions = {
  /** Host execution seam; absent watchers remain notification-only. */
  resumeApproved?: (approvalId: string) => Promise<void>;
  intervalMs?: number;
  approvalTtlMs?: number;
  approvedConsumptionTtlMs?: number;
};

export class ApprovalWatcher {
  private readonly store: ApprovalStore;
  private readonly schedulerService: CoordinationSchedulerService | null;
  private readonly options: Required<Omit<ApprovalWatcherOptions, "resumeApproved">>;
  private readonly resumeApproved?: (approvalId: string) => Promise<void>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private resolvedCursor = 0;

  constructor(
    cwd: string,
    schedulerService?: CoordinationSchedulerService,
    options: ApprovalWatcherOptions = {},
  ) {
    this.store = new ApprovalStore(cwd);
    this.resumeApproved = options.resumeApproved;
    this.schedulerService = schedulerService ?? null;
    this.options = {
      intervalMs: options.intervalMs ?? 30_000,
      approvalTtlMs: options.approvalTtlMs ?? 30 * 60_000,
      approvedConsumptionTtlMs: options.approvedConsumptionTtlMs ?? 5 * 60_000,
    };
  }

  start(): void {
    if (this.timer) return;
    // Initialize cursor from current resolved count
    const all = this.store.list();
    this.resolvedCursor = all.filter(a => a.status !== "pending").length;
    this.timer = setInterval(() => { void this.scan().catch(error => console.error("approval scan failed", error)); }, this.options.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async shutdown(): Promise<void> {
    this.stop();
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      // Expire due approvals
      await this.store.expireDue(new Date());

      // Detect new resolutions
      const all = this.store.list();
      const resolved = all.filter(a => a.status !== "pending");
      const newResolutions = resolved.slice(this.resolvedCursor);
      this.resolvedCursor = resolved.length;

      // Retry durable approved continuations on every scan, including restart.
      // Counts/order of resolved approvals are not an execution cursor.
      for (const approval of all) {
        if (this.resumeApproved && (approval.status === "approved" || approval.status === "denied" ||
            (approval.status === "consumed" && approval.executionOutcome === "succeeded"))) {
          await this.resumeApproved(approval.id);
        }
      }

      // Notify scheduler for affected runs
      for (const approval of newResolutions) {
        this.emitEvent(approval);
        if (approval.coordinationRunId && this.schedulerService) {
          await this.schedulerService.requestTick(approval.coordinationRunId);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private emitEvent(_approval: ApprovalRecord): void {
    // Events will be wired in M0.77d.10
    // Placeholder for now
  }
}
