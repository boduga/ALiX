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
import { getSharedLedger, appendFact, type LedgerFactCounters } from "../storage/runtime-ledger.js";

/** Event types this domain writes to the R2 ledger (reconciliation vocabulary). */
export const COORDINATION_LEDGER_EVENT_TYPES = [
  "coordination.run.created",
  "coordination.run.persisted",
  "coordination.run.deleted",
] as const;
export type CoordinationLedgerEventType = (typeof COORDINATION_LEDGER_EVENT_TYPES)[number];

/**
 * R2.3 authoritative payload: the FULL run record. The ledger is the truth;
 * the JSON file is a disposable compatibility projection of it.
 */
function runLedgerPayload(run: CoordinationRun): { run: CoordinationRun } {
  return { run };
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
   * R2.3 authority counters. The LEDGER is the commit; append failure throws
   * (fail-closed — an unavailable authoritative store must not silently fall
   * back to JSON). JSON projection failures are tolerated and counted: the
   * projection is rebuildable, reconciliation reports the drift.
   */
  private readonly ledgerCounters: LedgerFactCounters = { appends: 0, failures: 0 };
  private projectionFailures = 0;
  private lastProjectionError: string | undefined;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.baseDir = join(cwd, ".alix", "coordination");
  }

  /**
   * Append the authoritative event FIRST (the commit). Throws on any append
   * failure — version conflict inside the per-run lock means a lost update,
   * and an unavailable ledger means the domain cannot mutate.
   */
  private commitToLedger(runId: string, mode: "snapshot" | "deleted", payload: Record<string, unknown>, occurredAt: string): void {
    const expected = getSharedLedger(this.cwd).entityVersion(runId);
    const eventType: CoordinationLedgerEventType =
      mode === "deleted"
        ? "coordination.run.deleted"
        : expected === 0
          ? "coordination.run.created"
          : "coordination.run.persisted";
    appendFact(this.cwd, this.ledgerCounters, {
      eventType,
      entityType: "coordinationRun",
      entityId: runId,
      payload,
      coordinationRunId: runId,
      correlationId: runId,
      actor: { type: "system", id: "coordination-store" },
      occurredAt,
      expectedVersion: expected,
      errorLabel: "coordination ledger",
    });
  }

  /**
   * Write the compatibility projection AFTER the ledger commit. A failure
   * here is counted, not thrown — the ledger already holds the truth and
   * reconciliation reports projection drift for rebuild.
   */
  private async projectJson(runId: string, run: CoordinationRun): Promise<void> {
    try {
      await this.ensureDir();
      await this.writeAtomic(this.runPath(runId), JSON.stringify(run, null, 2));
    } catch (err) {
      this.projectionFailures += 1;
      this.lastProjectionError = err instanceof Error ? err.message : String(err);
    }
  }

  /** Observable authority health (R2: failures must never be silent). */
  ledgerStatus(): { appends: number; failures: number; projectionFailures: number; lastError?: string; lastProjectionError?: string } {
    const c = this.ledgerCounters;
    return {
      appends: c.appends,
      failures: c.failures,
      projectionFailures: this.projectionFailures,
      ...(c.lastError !== undefined ? { lastError: c.lastError } : {}),
      ...(this.lastProjectionError !== undefined ? { lastProjectionError: this.lastProjectionError } : {}),
    };
  }

  /**
   * Authority read: reconstruct the run from its latest ledger event.
   * Null only when the entity has NO ledger facts (legacy/pre-ledger run —
   * caller falls back to the JSON projection). Ledger db errors THROW; they
   * are never masked by a JSON fallback in an authoritative domain.
   */
  private loadFromLedger(runId: string): { kind: "run"; run: CoordinationRun } | { kind: "deleted" } | { kind: "legacy" } {
    // Scoped by entityType: the id space is shared with other domains
    // (e.g. collaboration mirrors the same runId under its own type).
    const last = getSharedLedger(this.cwd).lastEvent(runId, "coordinationRun");
    if (!last) return { kind: "legacy" };
    if (last.eventType === "coordination.run.deleted") return { kind: "deleted" };
    const payload = last.payload as { run?: CoordinationRun } | null;
    if (!payload?.run) {
      throw new Error(`coordination ledger event for ${runId} missing run payload`);
    }
    return { kind: "run", run: payload.run };
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

  /** Save a coordination run: ledger commit first, JSON projection second. */
  async save(run: CoordinationRun): Promise<void> {
    run.updatedAt = new Date().toISOString();
    this.commitToLedger(run.id, "snapshot", runLedgerPayload(run), run.updatedAt);
    await this.projectJson(run.id, run);
  }

  /**
   * Load a coordination run by ID — LEDGER first (authority). Falls back to
   * the JSON projection only for legacy runs with zero ledger facts.
   */
  async load(runId: string): Promise<CoordinationRun | null> {
    const authority = this.loadFromLedger(runId);
    if (authority.kind === "deleted") return null;
    if (authority.kind === "run") {
      authority.run.workers = authority.run.workers.map(normalizeWorkerAssignment);
      return authority.run;
    }
    // Legacy pre-ledger run: the projection is the only record that exists.
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
   * Load with bounded retries for transient failures. Missing entities
   * (neither ledger nor projection) return null; ledger errors THROW —
   * an authoritative store must not be masked by retries or fallbacks.
   */
  async loadWithRetry(runId: string, attempts = 3): Promise<CoordinationRun | null> {
    for (let i = 0; i < attempts; i++) {
      const run = await this.load(runId);
      if (run) return run;
      // Distinguish "absent" from transient legacy-file reads: a ledger
      // entity that exists but reads null (deleted) is final — stop early.
      if (this.loadFromLedger(runId).kind === "deleted") return null;
      if (i < attempts - 1) {
        await new Promise(resolve => setTimeout(resolve, i === 0 ? 25 : 50));
      }
    }
    return null;
  }

  /**
   * List all coordination runs, newest first — reconstructed from the
   * ledger, merged with legacy projection-only runs.
   */
  async list(): Promise<CoordinationRun[]> {
    const latest = getSharedLedger(this.cwd).readLatestByEntityType("coordinationRun");
    const runs: CoordinationRun[] = [];
    const ledgerIds = new Set<string>();
    for (const event of latest) {
      ledgerIds.add(event.entityId);
      if (event.eventType === "coordination.run.deleted") continue;
      const payload = event.payload as { run?: CoordinationRun } | null;
      if (!payload?.run) {
        throw new Error(`coordination ledger event for ${event.entityId} missing run payload`);
      }
      const run = payload.run;
      run.workers = run.workers.map(normalizeWorkerAssignment);
      runs.push(run);
    }
    // Legacy projection-only runs (no ledger facts yet).
    if (existsSync(this.baseDir)) {
      const files = await readdir(this.baseDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const runId = file.slice(0, -5);
        if (ledgerIds.has(runId)) continue;
        try {
          const raw = await readFile(join(this.baseDir, file), "utf-8");
          const run = JSON.parse(raw) as CoordinationRun;
          run.workers = run.workers.map(normalizeWorkerAssignment);
          runs.push(run);
        } catch {
          // skip corrupt files
        }
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

  /** Delete a coordination run: ledger terminal event first, projection second. */
  async delete(runId: string): Promise<boolean> {
    const fileExists = existsSync(this.runPath(runId));
    const hasLedgerFacts = getSharedLedger(this.cwd).entityVersion(runId) > 0;
    if (!fileExists && !hasLedgerFacts) return false;
    this.commitToLedger(runId, "deleted", { deleted: true }, new Date().toISOString());
    if (fileExists) {
      try {
        await unlink(this.runPath(runId));
      } catch (err) {
        this.projectionFailures += 1;
        this.lastProjectionError = err instanceof Error ? err.message : String(err);
      }
    }
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
      // R2.3 authority: ledger append is the commit; JSON is projection.
      this.commitToLedger(runId, "snapshot", runLedgerPayload(run), run.updatedAt);
      await this.projectJson(runId, run);
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
      this.commitToLedger(runId, "snapshot", runLedgerPayload(run), run.updatedAt);
      await this.projectJson(runId, run);
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
      this.commitToLedger(runId, "snapshot", runLedgerPayload(run), run.updatedAt);
      await this.projectJson(runId, run);
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
