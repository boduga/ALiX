/**
 * task-registry.ts — File-backed daemon task registry.
 *
 * Stores task records at ~/.alix/daemon-tasks.json (global — one registry
 * for all projects; see daemon-paths.ts) with atomic writes.
 * Keeps at most 100 completed/failed/cancelled tasks.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { resolveDaemonTasksPath } from "./daemon-paths.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

export type DaemonTaskStatus =
  | "queued" | "running" | "completed" | "failed"
  | "cancel_requested" | "cancelled" | "failed_orphaned";

export type DaemonTaskRecord = {
  id: string;
  task: string;
  cwd: string;          // project directory where task was submitted
  status: DaemonTaskStatus;
  sessionId?: string;
  queuePosition?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  updatedAt: string;
  error?: string;
};

// ─── R2.9 dual-write status (global — one registry per user) ────────
type DaemonLedgerStatus = { appends: number; failures: number; lastError?: string };
let ledgerStatus: DaemonLedgerStatus = { appends: 0, failures: 0 };

/** Observable dual-write health (R2: failures must never be silent). */
export function daemonTaskLedgerStatus(): DaemonLedgerStatus {
  return { ...ledgerStatus, ...(ledgerStatus.lastError !== undefined ? { lastError: ledgerStatus.lastError } : {}) };
}

/** Reset counters (tests). */
export function resetDaemonTaskLedgerStatus(): void {
  ledgerStatus = { appends: 0, failures: 0 };
}

export class TaskRegistry {
  private tasks: DaemonTaskRecord[] = [];
  private filePath: string;
  private maxCompleted = 100;
  private savePromise: Promise<void> = Promise.resolve();
  /**
   * R2.9: baseline of what the ledger has already recorded (id → serialized
   * record), initialized from load() so legacy records are NOT re-mirrored;
   * only CHANGES after a successful file write are mirrored (JSON
   * authoritative in the dual-write phase; failures counted, never thrown).
   */
  private lastMirrored = new Map<string, string>();

  constructor() {
    this.filePath = resolveDaemonTasksPath();
  }

  async load(): Promise<void> {
    if (!existsSync(this.filePath)) {
      this.tasks = [];
      this.lastMirrored = new Map();
      return;
    }
    try {
      this.tasks = JSON.parse(await readFile(this.filePath, "utf-8"));
    } catch { this.tasks = []; }
    // Durable state is the baseline — only future changes mirror.
    this.lastMirrored = new Map(this.tasks.map(t => [t.id, JSON.stringify(t)]));
  }

  /**
   * R2.9 mirror the classified diff to the transactional ledger. The daemon
   * registry is GLOBAL, so the ledger is the per-user one at ~/.alix.
   * Called only AFTER a successful file write.
   */
  private mirrorDiff(): void {
    try {
      const ledger = getSharedLedger(homedir());
      const currentIds = new Set<string>();
      for (const task of this.tasks) {
        currentIds.add(task.id);
        const serialized = JSON.stringify(task);
        const prior = this.lastMirrored.get(task.id);
        if (prior === serialized) continue;
        const expected = ledger.entityVersion(task.id);
        const eventType = expected === 0 ? "daemonTask.created" : "daemonTask.updated";
        const res = ledger.append({
          event: {
            eventId: randomUUID(),
            eventType,
            schemaVersion: 1,
            entityType: "daemonTask",
            entityId: task.id,
            entityVersion: expected + 1,
            correlationId: task.id,
            sessionId: task.sessionId,
            actor: { type: "system", id: "task-registry" },
            occurredAt: task.updatedAt,
            recordedAt: new Date().toISOString(),
            payload: { task },
          },
          expectedVersion: expected,
        });
        if (res.ok) {
          ledgerStatus.appends += 1;
          this.lastMirrored.set(task.id, serialized);
        } else {
          ledgerStatus.failures += 1;
          ledgerStatus.lastError = `${res.reason}: ${res.detail}`;
        }
      }
      for (const id of [...this.lastMirrored.keys()]) {
        if (currentIds.has(id)) continue;
        const expected = ledger.entityVersion(id);
        const res = ledger.append({
          event: {
            eventId: randomUUID(),
            eventType: "daemonTask.removed",
            schemaVersion: 1,
            entityType: "daemonTask",
            entityId: id,
            entityVersion: expected + 1,
            correlationId: id,
            actor: { type: "system", id: "task-registry" },
            occurredAt: new Date().toISOString(),
            recordedAt: new Date().toISOString(),
            payload: { removed: true },
          },
          expectedVersion: expected,
        });
        if (res.ok) {
          ledgerStatus.appends += 1;
          this.lastMirrored.delete(id);
        } else {
          ledgerStatus.failures += 1;
          ledgerStatus.lastError = `${res.reason}: ${res.detail}`;
        }
      }
    } catch (err) {
      ledgerStatus.failures += 1;
      ledgerStatus.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  private async save(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const tmp = this.filePath + ".tmp";
    await writeFile(tmp, JSON.stringify(this.tasks, null, 2), "utf-8");
    await rename(tmp, this.filePath);
    // R2.9: JSON authoritative this phase — mirror only after the durable write.
    this.mirrorDiff();
  }

  /** Serialized write — ensures concurrent saves don't race. */
  private enqueueSave(): void {
    this.savePromise = this.savePromise
      .then(() => this.save())
      .catch((err) => {
        console.error("[task-registry] save failed", err);
      });
  }

  /** Await the in-flight write — callers that exit immediately must flush. */
  async flush(): Promise<void> {
    await this.savePromise;
  }

  create(task: string, cwd: string): DaemonTaskRecord {
    const record: DaemonTaskRecord = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      task, cwd, status: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.push(record);
    this.pruneCompleted();
    this.enqueueSave();
    return record;
  }

  update(id: string, changes: Partial<DaemonTaskRecord>): DaemonTaskRecord | null {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx < 0) return null;
    this.tasks[idx] = { ...this.tasks[idx], ...changes, updatedAt: new Date().toISOString() };
    this.enqueueSave();
    return this.tasks[idx];
  }

  get(id: string): DaemonTaskRecord | undefined {
    return this.tasks.find(t => t.id === id);
  }

  list(): DaemonTaskRecord[] {
    return [...this.tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  findQueued(id: string): DaemonTaskRecord | undefined {
    return this.tasks.find(t => t.id === id && t.status === "queued");
  }

  /**
   * Reconcile tasks after daemon startup.
   *   running           → failed_orphaned (daemon crashed)
   *   cancel_requested  → cancelled (daemon restarted while pending)
   *   queued            → unchanged (safe to retry)
   *   terminal states   → unchanged
   */
  reconcileOnStartup(): { reconciled: number; totalBefore: number } {
    const totalBefore = this.tasks.length;
    let reconciled = 0;
    const now = new Date().toISOString();

    for (const t of this.tasks) {
      if (t.status === "running") {
        t.status = "failed_orphaned";
        t.error = "Daemon restarted while task was running";
        t.updatedAt = now;
        reconciled++;
      } else if (t.status === "cancel_requested") {
        t.status = "cancelled";
        t.cancelledAt = now;
        t.error = "Daemon restarted while cancellation was pending";
        t.updatedAt = now;
        reconciled++;
      }
    }

    if (reconciled > 0) this.enqueueSave();
    return { reconciled, totalBefore };
  }

  private pruneCompleted(): void {
    const completed = this.tasks.filter(t =>
      t.status === "completed" || t.status === "failed" || t.status === "cancelled" || t.status === "failed_orphaned"
    );
    if (completed.length <= this.maxCompleted) return;
    const toRemove = completed.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, completed.length - this.maxCompleted);
    const removeIds = new Set(toRemove.map(t => t.id));
    this.tasks = this.tasks.filter(t => !removeIds.has(t.id));
  }
}
