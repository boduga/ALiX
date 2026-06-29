/**
 * P10.9.1 — Executive Snapshot Store.
 *
 * Atomic-write store for plan-scoped baseline + current observations. The
 * baseline is immutable (write-once per planId); the current snapshot is
 * replaceable. Storage layout:
 *   `.alix/executive/snapshots/<planId>-baseline.json`
 *   `.alix/executive/snapshots/<planId>-current.json`
 *
 * Snapshots store REFERENCES to source reports (trend snapshot id, outcome
 * report ids, etc.) — never derived metrics. They are the immutable audit
 * record of what the executive system observed at capture time, not a
 * second analytics report that drifts. See ADR-0005.
 *
 * Atomic write pattern is identical to `PlanStore`: write to `<file>.tmp`,
 * fsync, rename. If a partial `.tmp` is present and no target file exists,
 * `loadX` returns null rather than throwing (mirrors legacy `outcome-store.ts`
 * / `plan-store.ts` conventions).
 *
 * @module
 */

import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Kinds of plan-scoped snapshots. Discriminated by `captureKind`. */
export type ExecutiveSnapshotCaptureKind = "baseline" | "current";

/** Why this snapshot was captured. Future-proofs the audit log. */
export type ExecutiveSnapshotCaptureReason =
  | "execution-start"   // captured on first step of plan execution
  | "evaluation"        // captured lazily by evaluate handler
  | "manual"            // future: explicitly captured by operator
  | "recovery";         // future: re-captured after failure recovery

/** Source of capture — the layer that owned the act of taking the snapshot. */
export type ExecutiveSnapshotCaptureSource =
  | "ExecutionEngine"
  | "EvaluationHandler"
  | "Provider";

export interface ExecutiveSnapshotMetadata {
  readonly snapshotVersion: 1;
  readonly alixVersion: string;
  readonly executiveEngineVersion: string;
  readonly createdBy: ExecutiveSnapshotCaptureSource;
  readonly reason: ExecutiveSnapshotCaptureReason;
}

export interface ExecutiveRawSubsystemState {
  readonly trendSnapshotId?: string;
  readonly outcomeReportIds: readonly string[];
  readonly recommendationReportId?: string;
  readonly effectivenessReportId?: string;
  readonly correlationReportId?: string;
}

export interface ExecutivePlanSnapshot {
  readonly metadata: ExecutiveSnapshotMetadata;
  readonly planId: string;
  readonly capturedAt: string;
  readonly captureKind: ExecutiveSnapshotCaptureKind;
  readonly rawSubsystemState: ExecutiveRawSubsystemState;
  /** `<planId>-baseline` or `<planId>-current`. Matches filename basename. */
  readonly id: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown by `ExecutiveSnapshotStore.saveBaseline` when a baseline already
 * exists for the given planId. Baselines are write-once per planId by
 * ADR-0005 rule #1 + #2 — historical truth cannot be silently overwritten.
 *
 * Recovery path: explicitly delete the existing snapshot file on disk, or
 * create a new plan. Never relax this contract silently.
 */
export class BaselineAlreadyCapturedError extends Error {
  constructor(public readonly planId: string) {
    super(`Baseline already captured for plan ${planId} — baselines are immutable`);
    this.name = "BaselineAlreadyCapturedError";
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ExecutiveSnapshotStore {
  constructor(private readonly dir: string) {}

  /**
   * Atomically save an immutable baseline snapshot for `snapshot.planId`.
   * Throws `BaselineAlreadyCapturedError` if a baseline already exists for
   * the same planId.
   *
   * Atomicity: write to `<file>.tmp`, fsync, rename. A previous interrupted
   * `.tmp` (without a target file) is silently overwritten — there is no
   * committed baseline to lose.
   */
  async saveBaseline(snapshot: ExecutivePlanSnapshot): Promise<void> {
    // ADR-0005 rule #1: baselines captured once. Throw on duplicate.
    if (await this.hasBaseline(snapshot.planId)) {
      throw new BaselineAlreadyCapturedError(snapshot.planId);
    }
    this.atomicWrite(this.baselinePath(snapshot.planId), snapshot);
  }

  /**
   * Atomically save a replaceable current snapshot. Overwrites any
   * existing current snapshot for the same planId. ADR-0005 rule #3:
   * current is a moving target of system state.
   */
  async saveCurrent(snapshot: ExecutivePlanSnapshot): Promise<void> {
    this.atomicWrite(this.currentPath(snapshot.planId), snapshot);
  }

  /** Load the immutable baseline for a planId, or null if none. */
  async loadBaseline(planId: string): Promise<ExecutivePlanSnapshot | null> {
    return this.loadSnapshot(this.baselinePath(planId));
  }

  /** Load the replaceable current snapshot for a planId, or null if none. */
  async loadCurrent(planId: string): Promise<ExecutivePlanSnapshot | null> {
    return this.loadSnapshot(this.currentPath(planId));
  }

  /**
   * Idempotency gate: returns true iff a baseline file exists for planId.
   * Used by `ExecutionEngine.executeStepInternal` to ensure baseline
   * capture happens exactly once per plan lifetime.
   */
  async hasBaseline(planId: string): Promise<boolean> {
    return existsSync(this.baselinePath(planId));
  }

  /**
   * Audit helper: list every snapshot in the configured directory. Returns
   * an empty array if the directory does not exist yet. Corrupt files are
   * skipped with a console warning (matches `OutcomeReportStore.list`
   * convention).
   *
   * Sorted by `capturedAt` descending (newest first).
   */
  async list(): Promise<ExecutivePlanSnapshot[]> {
    if (!existsSync(this.dir)) return [];

    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"));

    const results: ExecutivePlanSnapshot[] = [];
    for (const file of files) {
      try {
        const raw = readFileSync(join(this.dir, file), "utf-8");
        const parsed = JSON.parse(raw) as ExecutivePlanSnapshot;
        results.push(parsed);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `Skipping corrupt snapshot file: ${file} — ${msg}`,
        );
      }
    }

    results.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    return results;
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private baselinePath(planId: string): string {
    return join(this.dir, `${planId}-baseline.json`);
  }

  private currentPath(planId: string): string {
    return join(this.dir, `${planId}-current.json`);
  }

  private atomicWrite(targetPath: string, snapshot: ExecutivePlanSnapshot): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const tmpPath = targetPath + ".tmp";
    const fd = openSync(tmpPath, "w");
    try {
      writeFileSync(fd, JSON.stringify(snapshot, null, 2), "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, targetPath);
  }

  private loadSnapshot(targetPath: string): ExecutivePlanSnapshot | null {
    // Partial `.tmp` from an interrupted write: return null rather than
    // throwing — there is no committed snapshot to read.
    if (!existsSync(targetPath)) return null;
    const raw = readFileSync(targetPath, "utf-8");
    return JSON.parse(raw) as ExecutivePlanSnapshot;
  }
}