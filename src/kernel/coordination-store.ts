/**
 * coordination-store.ts — File-backed persistent store for CoordinationRun
 * and WorkerAssignment records.
 *
 * Each run is persisted as .alix/coordination/<runId>.json.
 * Workers are embedded within the run JSON, not stored separately.
 *
 * Lock coordination: no file locking (single-file-per-run avoids
 * cross-write corruption). Callers must not write the same run
 * concurrently from multiple processes.
 */

import { readFile, writeFile, mkdir, readdir, unlink, rename as renameFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { CoordinationRun, CoordinationRunOutcome, CoordinationRunStatus, WorkerAssignment, WorkerStatus } from "./coordination-types.js";
import { transitionWorkerStatus, recomputeRunStatus } from "./coordination-types.js";
import { CoordinationRunLock } from "./coordination-run-lock.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

/** Event types this domain writes to the R2 ledger (reconciliation vocabulary). */
export const COORDINATION_LEDGER_EVENT_TYPES = [
  "coordination.run.created",
  "coordination.run.persisted",
  "coordination.run.deleted",
] as const;
export type CoordinationLedgerEventType = (typeof COORDINATION_LEDGER_EVENT_TYPES)[number];

/** Authoritative projection fields mirrored into each ledger snapshot event. */
function runLedgerSnapshot(run: CoordinationRun): Record<string, unknown> {
  return {
    status: run.status,
    planRevision: run.planRevision ?? 0,
    outcome: run.outcome ?? null,
    aggregateResultRef: run.aggregateResultRef ?? null,
    aggregateSourceFingerprint: run.aggregateSourceFingerprint ?? null,
    aggregationFailure: run.aggregationFailure ?? null,
    workerStatuses: Object.fromEntries(
      run.workers.map(w => [w.id, { status: w.status, attempt: w.attempt ?? 0 }]),
    ),
  };
}

/**
 * Normalize a WorkerAssignment loaded from earlier coordination milestones.
 * New scheduler fields get safe defaults when absent.
 */
export function normalizeWorkerAssignment(worker: WorkerAssignment): WorkerAssignment {
  return {
    ...worker,
    requiredCapabilities: worker.requiredCapabilities ?? [],
    attempt: worker.attempt ?? 0,
    maxAttempts: worker.maxAttempts ?? 3,
    ownershipClaims: worker.ownershipClaims ?? [],
    failureProvenance: worker.failureProvenance,
    contextManifestRef: worker.contextManifestRef,
    contextFingerprint: worker.contextFingerprint,
    contextGeneratedAt: worker.contextGeneratedAt,
    contextTokenEstimate: worker.contextTokenEstimate,
  };
}

export type WorkerPatch = Partial<Pick<WorkerAssignment,
  | "status" | "resultRef" | "error" | "attempt" | "blockReason"
  | "failureKind" | "approvalId" | "startedAt" | "completedAt"
  | "lastHeartbeatAt" | "leaseIds" | "executionOwnerId"
  | "authorizationEvidence" | "nextAttemptAt"
  | "failureProvenance"
  | "contextManifestRef" | "contextFingerprint"
  | "contextGeneratedAt" | "contextTokenEstimate"
>>;

export class CoordinationStore {
  /** Workspace root this store is scoped to (used by run-lifecycle helpers). */
  readonly cwd: string;
  private readonly baseDir: string;
  /**
   * R2 dual-write counters. JSON stays authoritative during strangler
   * phases; ledger failures are counted here and surfaced by
   * `ledgerStatus()` + reconciliation — never silently swallowed.
   */
  private ledgerAppends = 0;
  private ledgerFailures = 0;
  private lastLedgerError: string | undefined;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.baseDir = join(cwd, ".alix", "coordination");
  }

  /**
   * Dual-write one snapshot/terminal event to the transactional ledger.
   * JSON is already written when this runs; ANY ledger failure (open,
   * conflict, locked db) is counted — never thrown, never silent.
   */
  private dualWrite(runId: string, mode: "snapshot" | "deleted", payload: Record<string, unknown>, occurredAt: string): void {
    try {
      const ledger = getSharedLedger(this.cwd);
      const expected = ledger.entityVersion(runId);
      const eventType: CoordinationLedgerEventType =
        mode === "deleted"
          ? "coordination.run.deleted"
          : expected === 0
            ? "coordination.run.created"
            : "coordination.run.persisted";
      const res = ledger.append({
        event: {
          eventId: randomUUID(),
          eventType,
          schemaVersion: 1,
          entityType: "coordinationRun",
          entityId: runId,
          entityVersion: expected + 1,
          coordinationRunId: runId,
          correlationId: runId,
          actor: { type: "system", id: "coordination-store" },
          occurredAt,
          recordedAt: new Date().toISOString(),
          payload,
        },
        expectedVersion: expected,
      });
      if (res.ok) {
        this.ledgerAppends += 1;
      } else {
        this.ledgerFailures += 1;
        this.lastLedgerError = `${res.reason}: ${res.detail}`;
      }
    } catch (err) {
      this.ledgerFailures += 1;
      this.lastLedgerError = err instanceof Error ? err.message : String(err);
    }
  }

  /** Observable dual-write health (R2: failures must never be silent). */
  ledgerStatus(): { appends: number; failures: number; lastError?: string } {
    return {
      appends: this.ledgerAppends,
      failures: this.ledgerFailures,
      ...(this.lastLedgerError !== undefined ? { lastError: this.lastLedgerError } : {}),
    };
  }

  private runPath(runId: string): string {
    return join(this.baseDir, `${runId}.json`);
  }

  private async ensureDir(): Promise<void> {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  /**
   * Atomic tmp+rename write with retry for Windows transient rename failures
   * (EPERM/EACCES/EBUSY when Defender or a concurrent reader holds the dest).
   */
  private async writeAtomic(path: string, data: string): Promise<void> {
    const tmpPath = `${path}.tmp.${randomUUID()}`;
    await writeFile(tmpPath, data, "utf-8");
    const delays = [50, 100, 200, 400];
    for (let i = 0; ; i++) {
      try {
        await renameFile(tmpPath, path);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        const retryable = code === "EPERM" || code === "EACCES" || code === "EBUSY";
        if (!retryable || i >= delays.length) throw err;
        await new Promise(resolve => setTimeout(resolve, delays[i]));
      }
    }
  }

  /** Save a coordination run (atomic write via tmp + rename). */
  async save(run: CoordinationRun): Promise<void> {
    await this.ensureDir();
    run.updatedAt = new Date().toISOString();
    await this.writeAtomic(this.runPath(run.id), JSON.stringify(run, null, 2));
    // R2 dual-write: genesis vs snapshot decided inside dualWrite's try.
    this.dualWrite(run.id, "snapshot", runLedgerSnapshot(run), run.updatedAt);
  }

  /** Load a coordination run by ID. */
  async load(runId: string): Promise<CoordinationRun | null> {
    const path = this.runPath(runId);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      const run = JSON.parse(raw) as CoordinationRun;
      run.workers = run.workers.map(normalizeWorkerAssignment);
      return run;
    } catch {
      return null;
    }
  }

  /**
   * Load with bounded retries for transient read failures (Windows Defender
   * EBUSY on tmp+rename churn, partial reads). Missing files fail fast.
   * Returns null after exhausting attempts.
   */
  async loadWithRetry(runId: string, attempts = 3): Promise<CoordinationRun | null> {
    if (!existsSync(this.runPath(runId))) return null;
    for (let i = 0; i < attempts; i++) {
      const run = await this.load(runId);
      if (run) return run;
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, i === 0 ? 25 : 50));
      }
    }
    return null;
  }

  /** List all coordination runs, newest first. */
  async list(): Promise<CoordinationRun[]> {
    if (!existsSync(this.baseDir)) return [];
    const files = await readdir(this.baseDir);
    const runs: CoordinationRun[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(this.baseDir, file), "utf-8");
        const run = JSON.parse(raw) as CoordinationRun;
        run.workers = run.workers.map(normalizeWorkerAssignment);
        runs.push(run);
      } catch {
        // skip corrupt files
      }
    }
    return runs.sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  /** List runs in a specific status. */
  async listByStatus(status: CoordinationRunStatus): Promise<CoordinationRun[]> {
    const all = await this.list();
    return all.filter(r => r.status === status);
  }

  /** Delete a coordination run. */
  async delete(runId: string): Promise<boolean> {
    const path = this.runPath(runId);
    if (!existsSync(path)) return false;
    await unlink(path);
    this.dualWrite(runId, "deleted", { deleted: true }, new Date().toISOString());
    return true;
  }

  // ── Worker-level operations ──────────────────────────────────────

  /** Add a worker to an existing run. */
  async addWorker(runId: string, worker: WorkerAssignment): Promise<CoordinationRun | null> {
    const run = await this.load(runId);
    if (!run) return null;
    run.workers.push(worker);
    run.status = recomputeRunStatus(run);
    await this.save(run);
    return run;
  }

  /** Update a single worker's status by ID within a run. */
  async updateWorkerStatus(
    runId: string,
    workerId: string,
    status: WorkerStatus,
    extra?: { resultRef?: string; error?: string },
  ): Promise<CoordinationRun | null> {
    const run = await this.load(runId);
    if (!run) return null;
    const idx = run.workers.findIndex(w => w.id === workerId);
    if (idx === -1) return null;
    run.workers[idx] = transitionWorkerStatus(run.workers[idx], status, extra);
    run.status = recomputeRunStatus(run);
    await this.save(run);
    return run;
  }

  /** Get workers that are "ready" (dependencies resolved, not yet running). */
  getReadyWorkers(run: CoordinationRun): WorkerAssignment[] {
    const completedIds = new Set(
      run.workers.filter(w => w.status === "completed").map(w => w.id)
    );
    return run.workers.filter(w =>
      w.status === "ready" ||
      (w.status === "pending" && w.dependencies.every(d => completedIds.has(d)))
    );
  }

  /** Find the next worker that is ready and waiting for assignment. */
  nextReadyWorker(run: CoordinationRun): WorkerAssignment | undefined {
    return this.getReadyWorkers(run)[0];
  }

  /** Check if all workers in a run have reached a terminal state. */
  isComplete(run: CoordinationRun): boolean {
    return run.workers.length > 0 &&
      run.workers.every(w =>
        w.status === "completed" || w.status === "failed" || w.status === "cancelled"
      );
  }

  // ── Lock-safe operations ─────────────────────────────────────────

  /**
   * Update a run within a per-run lock. Acquires the lock, loads,
   * mutates, writes atomically, then releases the lock.
   *
   * Returns null if the lock could not be acquired or the run was not found.
   */
  async updateRun(
    runId: string,
    mutate: (run: CoordinationRun) => void | Promise<void>,
  ): Promise<CoordinationRun | null> {
    const lock = new CoordinationRunLock(this.cwd, runId);
    const acquired = await lock.acquire();
    if (!acquired) return null;
    try {
      const run = await this.loadWithRetry(runId);
      if (!run) return null;
      await mutate(run);
      run.status = recomputeRunStatus(run);
      run.updatedAt = new Date().toISOString();
      await this.writeAtomic(this.runPath(runId), JSON.stringify(run, null, 2));
      // R2 dual-write inside the per-run lock — same serialization as the JSON.
      this.dualWrite(runId, "snapshot", runLedgerSnapshot(run), run.updatedAt);
      return run;
    } finally {
      lock.release();
    }
  }

  /**
   * Update a run with an expectedPlanRevision guard (CAS) for safe concurrent
   * replanning. Acquires the per-run lock, checks planRevision matches the
   * expected value, applies mutate, increments planRevision, writes atomically,
   * then releases the lock.
   *
   * Does NOT call recomputeRunStatus — the caller (e.g. replan) manages status
   * explicitly.
   *
   * Returns the updated run on success, or null if:
   * - the lock could not be acquired
   * - the run was not found
   * - run.planRevision !== expectedPlanRevision (CAS mismatch)
   */
  async updateRunWithRevisionCheck(
    runId: string,
    expectedPlanRevision: number,
    mutate: (run: CoordinationRun) => void | Promise<void>,
  ): Promise<CoordinationRun | null> {
    const lock = new CoordinationRunLock(this.cwd, runId);
    const acquired = await lock.acquire();
    if (!acquired) return null;
    try {
      const run = await this.load(runId);
      if (!run) return null;
      // CAS guard: reject if planRevision has advanced
      if (run.planRevision !== expectedPlanRevision) return null;
      await mutate(run);
      run.planRevision += 1;
      run.updatedAt = new Date().toISOString();
      await this.writeAtomic(this.runPath(runId), JSON.stringify(run, null, 2));
      this.dualWrite(runId, "snapshot", runLedgerSnapshot(run), run.updatedAt);
      return run;
    } finally {
      lock.release();
    }
  }

  /** Update specific fields on a worker within a run. Uses lock-safe updateRun. */
  async patchWorker(
    runId: string,
    workerId: string,
    patch: Record<string, unknown>,
  ): Promise<CoordinationRun | null> {
    return this.updateRun(runId, (run) => {
      const worker = run.workers.find(w => w.id === workerId);
      if (!worker) return;
      for (const [key, value] of Object.entries(patch)) {
        (worker as any)[key] = value;
      }
    });
  }

  /** Attach aggregate metadata to a run. */
  async attachAggregate(runId: string, metadata: {
    aggregateResultRef: string;
    aggregateGeneratedAt: string;
    aggregateSourceFingerprint: string;
    outcome: CoordinationRunOutcome;
  }): Promise<CoordinationRun | null> {
    return this.updateRun(runId, (run) => {
      run.aggregateResultRef = metadata.aggregateResultRef;
      run.aggregateGeneratedAt = metadata.aggregateGeneratedAt;
      run.aggregateSourceFingerprint = metadata.aggregateSourceFingerprint;
      run.outcome = metadata.outcome;
    });
  }

  /**
   * Attach aggregate metadata only when this call wins the finalization race.
   *
   * The check-and-attach runs inside the per-run lock, so two schedulers that
   * both notice a terminal run cannot both attach: the loser observes the
   * winner's metadata and gets `attached: false`. That is what lets the caller
   * emit `coordination.aggregate.completed` exactly once instead of once per
   * process that happened to see the terminal state.
   *
   * A *different* source fingerprint means the run changed since the last
   * aggregate (a replan moved the workers), so that is a fresh finalization and
   * does attach — overwriting stale aggregate metadata, which is the existing
   * freshness contract.
   */
  async attachAggregateIfUnfinalized(runId: string, metadata: {
    aggregateResultRef: string;
    aggregateGeneratedAt: string;
    aggregateSourceFingerprint: string;
    outcome: CoordinationRunOutcome;
  }): Promise<{ attached: boolean; run: CoordinationRun | null }> {
    const lock = new CoordinationRunLock(this.cwd, runId);
    const acquired = await lock.acquire();
    if (!acquired) return { attached: false, run: null };
    try {
      const run = await this.loadWithRetry(runId);
      if (!run) return { attached: false, run: null };
      if (run.aggregateResultRef && run.aggregateSourceFingerprint === metadata.aggregateSourceFingerprint) {
        return { attached: false, run };
      }
      run.aggregateResultRef = metadata.aggregateResultRef;
      run.aggregateGeneratedAt = metadata.aggregateGeneratedAt;
      run.aggregateSourceFingerprint = metadata.aggregateSourceFingerprint;
      run.outcome = metadata.outcome;
      // A successful attach for this source supersedes any earlier failure
      // marker, so clear it in the same locked write.
      run.aggregationFailure = undefined;
      run.status = recomputeRunStatus(run);
      run.updatedAt = new Date().toISOString();
      await this.writeAtomic(this.runPath(runId), JSON.stringify(run, null, 2));
      this.dualWrite(runId, "snapshot", runLedgerSnapshot(run), run.updatedAt);
      return { attached: true, run };
    } finally {
      lock.release();
    }
  }

  /**
   * Record a failed aggregation attempt against the source fingerprint it
   * failed for. Durable so the failure is visible without the event log, and
   * keyed so a stale marker can be told apart from a current one.
   */
  async recordAggregationFailure(runId: string, failure: {
    sourceFingerprint: string;
    failedAt: string;
    reason: string;
  }): Promise<CoordinationRun | null> {
    return this.updateRun(runId, (run) => {
      run.aggregationFailure = {
        sourceFingerprint: failure.sourceFingerprint,
        failedAt: failure.failedAt,
        reason: failure.reason,
      };
    });
  }
}
