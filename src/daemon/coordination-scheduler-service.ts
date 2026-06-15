/**
 * coordination-scheduler-service.ts — Daemon-hosted coordination scheduler polling service.
 *
 * Periodically calls tickAll() on active coordination runs.
 * Renews active leases for running workers.
 * Guards against overlapping ticks and renewals.
 *
 * Owns timers. Scheduler owns logic.
 */

import { CoordinationStore } from "../kernel/coordination-store.js";
import { CoordinationScheduler, DEFAULT_OWNERSHIP_RENEW_INTERVAL_MS, DEFAULT_RUN_POLL_INTERVAL_MS } from "../kernel/coordination-scheduler.js";

export type CoordinationSchedulerServiceOptions = {
  pollIntervalMs?: number;
  renewIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxRunsPerCycle?: number;
};

export class CoordinationSchedulerService {
  private readonly scheduler: CoordinationScheduler;
  private readonly store: CoordinationStore;
  private readonly options: Required<CoordinationSchedulerServiceOptions>;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private tickInProgress = false;
  private renewInProgress = false;
  private heartbeatInProgress = false;
  private stopped = false;

  constructor(
    scheduler: CoordinationScheduler,
    store: CoordinationStore,
    options: CoordinationSchedulerServiceOptions = {},
  ) {
    this.scheduler = scheduler;
    this.store = store;
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? DEFAULT_RUN_POLL_INTERVAL_MS,
      renewIntervalMs: options.renewIntervalMs ?? DEFAULT_OWNERSHIP_RENEW_INTERVAL_MS,
      heartbeatIntervalMs: 15_000,
      maxRunsPerCycle: options.maxRunsPerCycle ?? 10,
    };
  }

  start(): void {
    if (this.pollTimer) return;
    this.stopped = false;
    this.pollTimer = setInterval(() => { void this.tickAll().catch(() => {}); }, this.options.pollIntervalMs);
    this.renewTimer = setInterval(() => { void this.renewAll().catch(() => {}); }, this.options.renewIntervalMs);
    this.heartbeatTimer = setInterval(() => { void this.heartbeatAll().catch(() => {}); }, this.options.heartbeatIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    if (this.renewTimer) { clearInterval(this.renewTimer); this.renewTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  async shutdown(): Promise<void> {
    this.stop();
    await this.scheduler.shutdown();
  }

  private async tickAll(): Promise<void> {
    if (this.stopped || this.tickInProgress) return;
    this.tickInProgress = true;
    try {
      const runs = await this.store.list();
      const active = runs
        .filter(r => r.status === "running" || r.status === "planning" || r.status === "blocked")
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const cycle = active.slice(0, this.options.maxRunsPerCycle);
      for (const run of cycle) {
        await this.scheduler.tick(run.id);
      }
    } finally {
      this.tickInProgress = false;
    }
  }

  private async renewAll(): Promise<void> {
    if (this.stopped || this.renewInProgress) return;
    this.renewInProgress = true;
    try {
      await this.scheduler.renewActiveLeases();
    } finally {
      this.renewInProgress = false;
    }
  }

  private async heartbeatAll(): Promise<void> {
    if (this.stopped || this.heartbeatInProgress) return;
    this.heartbeatInProgress = true;
    try {
      await this.scheduler.heartbeatActiveWorkers();
    } finally {
      this.heartbeatInProgress = false;
    }
  }
}
