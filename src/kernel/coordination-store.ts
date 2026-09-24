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
  private readonly cwd: string;
  private readonly baseDir: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.baseDir = join(cwd, ".alix", "coordination");
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
}
