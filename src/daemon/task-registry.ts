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
import { resolveDaemonTasksPath } from "./daemon-paths.js";
import { getSharedLedger, appendFact, currentEntityVersion } from "../storage/runtime-ledger.js";

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
type DaemonLedgerStatus = { appends: number; failures: number; projectionFailures: number; lastError?: string; lastProjectionError?: string };
let ledgerStatus: DaemonLedgerStatus = { appends: 0, failures: 0, projectionFailures: 0 };

/** Observable dual-write health (R2: failures must never be silent). */
export function daemonTaskLedgerStatus(): DaemonLedgerStatus {
  return {
    ...ledgerStatus,
    ...(ledgerStatus.lastError !== undefined ? { lastError: ledgerStatus.lastError } : {}),
    ...(ledgerStatus.lastProjectionError !== undefined ? { lastProjectionError: ledgerStatus.lastProjectionError } : {}),
  };
}

/** Reset counters (tests). */
export function resetDaemonTaskLedgerStatus(): void {
  ledgerStatus = { appends: 0, failures: 0, projectionFailures: 0 };
}

export class TaskRegistry {
  private tasks: DaemonTaskRecord[] = [];
  private filePath: string;
  /** Ledger workspace captured at construction — never re-read at save time
   *  (a later `HOME` swap must not redirect an in-flight save's mirror). */
  private readonly ledgerCwd: string = homedir();
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

  /**
   * R2.15 authority read: rebuild from the per-user ledger (daemon tasks
   * are GLOBAL). The file projection covers only legacy records with zero
   * ledger facts; tombstones suppress stale file copies. Ledger db errors
   * count and THROW — never masked by a file fallback.
   */
  async load(): Promise<void> {
    let latest: Array<{ eventType: string; entityId: string; payload: unknown }>;
    try {
      latest = getSharedLedger(this.ledgerCwd).readLatestByEntityType("daemonTask");
    } catch (err) {
      ledgerStatus.failures += 1;
      ledgerStatus.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }

    const fromLedger = new Map<string, DaemonTaskRecord>();
    const removedIds = new Set<string>();
    for (const event of latest) {
      if (event.eventType === "daemonTask.removed") {
        removedIds.add(event.entityId);
        continue;
      }
      const payload = event.payload as { task?: DaemonTaskRecord } | null;
      if (!payload?.task) {
        throw new Error(`daemonTask ledger event for ${event.entityId} missing task payload`);
      }
      fromLedger.set(event.entityId, payload.task);
    }

    const fromFile: DaemonTaskRecord[] = [];
    if (existsSync(this.filePath)) {
      try {
        fromFile.push(...(JSON.parse(await readFile(this.filePath, "utf-8")) as DaemonTaskRecord[]));
      } catch { /* corrupt projection — ledger view still applies */ }
    }

    const merged = new Map<string, DaemonTaskRecord>();
    for (const t of fromFile) {
      if (removedIds.has(t.id) || fromLedger.has(t.id)) continue;
      merged.set(t.id, t);
    }
    for (const [id, t] of fromLedger) {
      if (!removedIds.has(id)) merged.set(id, t);
    }
    this.tasks = [...merged.values()];
    // Authority-backed records are already mirrored; legacy file records
    // mirror on their first future change.
    this.lastMirrored = new Map(
      [...merged.values()]
        .filter(t => fromLedger.has(t.id))
        .map(t => [t.id, JSON.stringify(t)]),
    );
  }

  /**
   * R2.15 commit the classified diff to the transactional ledger. The daemon
   * registry is GLOBAL, so the ledger is the per-user one at ~/.alix. This is
   * THE COMMIT and is called synchronously by every mutator so an append
   * failure reaches the caller instead of being swallowed by the queued
   * projection write.
   */
  private commitToLedger(): void {
    const currentIds = new Set<string>();
    for (const task of this.tasks) {
      currentIds.add(task.id);
      const serialized = JSON.stringify(task);
      if (this.lastMirrored.get(task.id) === serialized) continue;
      const expected = currentEntityVersion(this.ledgerCwd, ledgerStatus, task.id);
      appendFact(this.ledgerCwd, ledgerStatus, {
        eventType: expected === 0 ? "daemonTask.created" : "daemonTask.updated",
        entityType: "daemonTask",
        entityId: task.id,
        payload: { task },
        correlationId: task.id,
        sessionId: task.sessionId,
        actor: { type: "system", id: "task-registry" },
        occurredAt: task.updatedAt,
        expectedVersion: expected,
        errorLabel: "daemonTask ledger",
      });
      this.lastMirrored.set(task.id, serialized);
    }
    for (const id of [...this.lastMirrored.keys()]) {
      if (currentIds.has(id)) continue;
      appendFact(this.ledgerCwd, ledgerStatus, {
        eventType: "daemonTask.removed",
        entityType: "daemonTask",
        entityId: id,
        payload: { removed: true },
        correlationId: id,
        actor: { type: "system", id: "task-registry" },
        occurredAt: new Date().toISOString(),
        errorLabel: "daemonTask ledger",
      });
      this.lastMirrored.delete(id);
    }
  }

  /** Write the JSON projection; failures are counted, never thrown. */
  private async projectJson(): Promise<void> {
    try {
      const dir = join(this.filePath, "..");
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const tmp = this.filePath + ".tmp";
      await writeFile(tmp, JSON.stringify(this.tasks, null, 2), "utf-8");
      await rename(tmp, this.filePath);
    } catch (err) {
      ledgerStatus.projectionFailures += 1;
      ledgerStatus.lastProjectionError = err instanceof Error ? err.message : String(err);
      throw err; // enqueueProjection's catch logs it
    }
  }

  /** Serialized projection write — ensures concurrent writes don't race. */
  private enqueueProjection(): void {
    this.savePromise = this.savePromise
      .then(() => this.projectJson())
      .catch((err) => {
        console.error("[task-registry] projection save failed", err);
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
    const before = this.tasks;
    this.tasks = [...this.tasks, record];
    this.pruneCompleted();
    try {
      this.commitToLedger();
    } catch (err) {
      this.tasks = before; // roll back the in-memory mutation — no durable fact
      throw err;
    }
    this.enqueueProjection();
    return record;
  }

  update(id: string, changes: Partial<DaemonTaskRecord>): DaemonTaskRecord | null {
    const idx = this.tasks.findIndex(t => t.id === id);
    if (idx < 0) return null;
    const before = this.tasks[idx];
    this.tasks[idx] = { ...this.tasks[idx], ...changes, updatedAt: new Date().toISOString() };
    try {
      this.commitToLedger();
    } catch (err) {
      this.tasks[idx] = before; // roll back the in-memory mutation
      throw err;
    }
    this.enqueueProjection();
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

    if (reconciled > 0) {
      this.commitToLedger();
      this.enqueueProjection();
    }
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
