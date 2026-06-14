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

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { CoordinationRun, CoordinationRunStatus, WorkerAssignment, WorkerStatus } from "./coordination-types.js";
import { transitionWorkerStatus, transitionCoordinationRunStatus, recomputeRunStatus } from "./coordination-types.js";

export class CoordinationStore {
  private baseDir: string;

  constructor(cwd: string) {
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

  /** Save a coordination run (full overwrite). */
  async save(run: CoordinationRun): Promise<void> {
    await this.ensureDir();
    run.updatedAt = new Date().toISOString();
    await writeFile(this.runPath(run.id), JSON.stringify(run, null, 2), "utf-8");
  }

  /** Load a coordination run by ID. */
  async load(runId: string): Promise<CoordinationRun | null> {
    const path = this.runPath(runId);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as CoordinationRun;
    } catch {
      return null;
    }
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
        runs.push(JSON.parse(raw) as CoordinationRun);
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
    await writeFile(path, JSON.stringify({ deleted: true, runId }), "utf-8");
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

  /** Find the next worker that is ready and not yet assigned. */
  nextReadyWorker(run: CoordinationRun): WorkerAssignment | undefined {
    return this.getReadyWorkers(run).find(w => w.status !== "running");
  }

  /** Check if all workers in a run have reached a terminal state. */
  isComplete(run: CoordinationRun): boolean {
    return run.workers.length > 0 &&
      run.workers.every(w =>
        w.status === "completed" || w.status === "failed" || w.status === "cancelled"
      );
  }
}
