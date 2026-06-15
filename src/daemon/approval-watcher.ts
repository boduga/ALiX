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

import { ApprovalStore } from "../approvals/approval-store.js";
import { CoordinationSchedulerService } from "./coordination-scheduler-service.js";
import type { ApprovalRecord } from "../approvals/approval-types.js";

export type ApprovalWatcherOptions = {
  intervalMs?: number;
  approvalTtlMs?: number;
  approvedConsumptionTtlMs?: number;
};

export class ApprovalWatcher {
  private readonly store: ApprovalStore;
  private readonly schedulerService: CoordinationSchedulerService | null;
  private readonly options: Required<ApprovalWatcherOptions>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private resolvedCursor = 0;

  constructor(
    cwd: string,
    schedulerService?: CoordinationSchedulerService,
    options: ApprovalWatcherOptions = {},
  ) {
    this.store = new ApprovalStore(cwd);
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
    this.timer = setInterval(() => void this.scan(), this.options.intervalMs);
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

  private emitEvent(approval: ApprovalRecord): void {
    // Events will be wired in M0.77d.10
    // Placeholder for now
  }
}
