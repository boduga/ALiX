/**
 * P10.9.1-T2 — automatic-outcome-hook: snapshot-stack integration tests.
 *
 * Proves the bug fix end-to-end for the auto-evaluator hook path: when
 * ExecutionEngine reaches terminal status, the auto-hook should now
 * resolve baseline + current through the plan-scoped snapshot stack
 * instead of the legacy time-window trend-store lookup. Plans that
 * actually executed should produce evaluationStatus: "completed".
 *
 * Same 5-scenario coverage as the CLI handler tests, but for the
 * production factory path (`createAutomaticOutcomeEvaluator(execDir)`).
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  AutomaticOutcomeEvaluator,
  createAutomaticOutcomeEvaluator,
} from "../../src/executive/automatic-outcome-hook.js";
import { OutcomeReportStore } from "../../src/executive/outcome-store.js";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import { ExecutiveSnapshotStore } from "../../src/executive/executive-snapshot-store.js";
import { createDefaultSnapshotProvider } from "../../src/executive/executive-snapshot-provider.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(planId: string, generatedAt: string): Record<string, unknown> {
  return {
    id: planId,
    steps: [
      {
        id: "s1",
        stepNumber: 1,
        title: "Investigate",
        action: "diagnose_root_cause",
        objectiveId: "obj-1",
        targetSubsystem: "workflow",
        riskLevel: "medium",
        priorityScore: 50,
        objectiveScore: 50,
        status: "pending",
        dependsOn: [],
      },
    ],
    objectives: ["obj-1"],
    generatedAt,
    windowDays: 7,
    planStatus: "draft",
    plannerVersion: "1.0",
    planningAlgorithm: "template-v1",
    contentHash: "placeholder",
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function computePlanHash(plan: Record<string, unknown>): string {
  const { contentHash: _ignored, ...content } = plan;
  return sha256(JSON.stringify(content));
}

function makeCompletedState(planId: string, completedAt: string): PlanExecutionState {
  return {
    planId,
    status: "completed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: completedAt, completedAt },
  };
}

function makeRunningState(planId: string, runningAt: string): PlanExecutionState {
  return {
    planId,
    status: "running",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: runningAt, runningAt },
  };
}

function writeTrends(dir: string, snapshots: Record<string, unknown>[]): void {
  const lines = snapshots.map(s => JSON.stringify(s)).join("\n");
  writeFileSync(join(dir, "trends.jsonl"), lines + "\n", "utf-8");
}

function writeSnapshots(
  execDir: string,
  planId: string,
  baselineTrendId: string | undefined,
  currentTrendId: string | undefined,
): void {
  const dir = join(execDir, "snapshots");
  mkdirSync(dir, { recursive: true });
  if (baselineTrendId) {
    writeFileSync(
      join(dir, `${planId}-baseline.json`),
      JSON.stringify({
        metadata: {
          snapshotVersion: 1,
          alixVersion: "0.0.0",
          executiveEngineVersion: "1.0",
          createdBy: "ExecutionEngine",
          reason: "execution-start",
        },
        planId,
        capturedAt: "2026-06-10T00:00:00.000Z",
        captureKind: "baseline",
        rawSubsystemState: {
          trendSnapshotId: baselineTrendId,
          outcomeReportIds: [],
        },
        id: `${planId}-baseline`,
      }),
      "utf-8",
    );
  }
  if (currentTrendId) {
    writeFileSync(
      join(dir, `${planId}-current.json`),
      JSON.stringify({
        metadata: {
          snapshotVersion: 1,
          alixVersion: "0.0.0",
          executiveEngineVersion: "1.0",
          createdBy: "EvaluationHandler",
          reason: "evaluation",
        },
        planId,
        capturedAt: "2026-06-15T12:00:00.000Z",
        captureKind: "current",
        rawSubsystemState: {
          trendSnapshotId: currentTrendId,
          outcomeReportIds: [],
        },
        id: `${planId}-current`,
      }),
      "utf-8",
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutomaticOutcomeEvaluator — snapshot-stack integration (P10.9.1-T2)", () => {
  let tmpDir: string;
  let execDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "auto-hook-snap-"));
    execDir = join(tmpDir, ".alix", "executive");
    mkdirSync(join(execDir, "outcomes"), { recursive: true });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // (a) Baseline + current both present → "completed" + report saved
  // -----------------------------------------------------------------------
  it("(a) baseline + current both present → evaluationStatus: completed + report saved", async () => {
    const planId = "plan-a";
    writeTrends(execDir, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    writeSnapshots(execDir, planId, "b1", "c1");

    const hook = createAutomaticOutcomeEvaluator(execDir);
    const state = makeCompletedState(planId, "2026-06-15T12:00:00.000Z");

    await hook.run(
      makePlan(planId, "2026-06-10T00:00:00.000Z") as unknown as PersistedExecutionPlan,
      state,
    );

    const outcomeStore = new OutcomeReportStore(join(execDir, "outcomes"));
    const reports = outcomeStore.list();
    expect(reports.length).toBe(1);
    expect(reports[0].planId).toBe(planId);
    expect(reports[0].evaluationStatus).toBe("completed");
  });

  // -----------------------------------------------------------------------
  // (b) Baseline missing → no report saved; warning logged
  // -----------------------------------------------------------------------
  it("(b) baseline missing → insufficient_data; warning logged with literal message", async () => {
    const planId = "plan-b";
    writeTrends(execDir, [
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    // No snapshot files at all
    mkdirSync(join(execDir, "snapshots"), { recursive: true });

    const hook = createAutomaticOutcomeEvaluator(execDir);
    const state = makeCompletedState(planId, "2026-06-15T12:00:00.000Z");

    await hook.run(
      makePlan(planId, "2026-06-10T00:00:00.000Z") as unknown as PersistedExecutionPlan,
      state,
    );

    // Invariant D — literal message includes "baseline not captured for planId=<id>"
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`baseline not captured for planId=${planId}`),
    );

    // The hook persists a report with evaluationStatus: insufficient_data so
    // operators see the failure in the outcome-store. The literal warning is
    // the actionable diagnostic.
    const outcomeStore = new OutcomeReportStore(join(execDir, "outcomes"));
    const reports = outcomeStore.list();
    expect(reports.length).toBe(1);
    expect(reports[0].evaluationStatus).toBe("insufficient_data");
  });

  // -----------------------------------------------------------------------
  // (c) Terminal status + current missing → auto-capture fires
  // -----------------------------------------------------------------------
  it("(c) terminal status + current missing → auto-capture fires, completed report saved", async () => {
    const planId = "plan-c";
    writeTrends(execDir, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    // Only baseline snapshot file — no current
    writeSnapshots(execDir, planId, "b1", undefined);

    const hook = createAutomaticOutcomeEvaluator(execDir);
    const state = makeCompletedState(planId, "2026-06-15T12:00:00.000Z");

    await hook.run(
      makePlan(planId, "2026-06-10T00:00:00.000Z") as unknown as PersistedExecutionPlan,
      state,
    );

    // Invariant C — current snapshot was auto-captured before evaluation
    const currentPath = join(execDir, "snapshots", `${planId}-current.json`);
    expect(existsSync(currentPath)).toBe(true);
    const captured = JSON.parse(readFileSync(currentPath, "utf-8"));
    expect(captured.planId).toBe(planId);
    expect(captured.captureKind).toBe("current");

    // Report saved with status: completed
    const outcomeStore = new OutcomeReportStore(join(execDir, "outcomes"));
    const reports = outcomeStore.list();
    expect(reports.length).toBe(1);
    expect(reports[0].evaluationStatus).toBe("completed");
  });

  // -----------------------------------------------------------------------
  // (d) Non-terminal status + current missing → no auto-capture
  // -----------------------------------------------------------------------
  it("(d) non-terminal status + current missing → no auto-capture, no report saved", async () => {
    const planId = "plan-d";
    writeTrends(execDir, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
    ]);
    // Only baseline snapshot file — no current
    writeSnapshots(execDir, planId, "b1", undefined);

    const hook = createAutomaticOutcomeEvaluator(execDir);
    // 'running' is not terminal — auto-capture must NOT fire
    const state = makeRunningState(planId, "2026-06-15T12:00:00.000Z");

    await hook.run(
      makePlan(planId, "2026-06-10T00:00:00.000Z") as unknown as PersistedExecutionPlan,
      state,
    );

    // Current snapshot file must NOT have been created
    const currentPath = join(execDir, "snapshots", `${planId}-current.json`);
    expect(existsSync(currentPath)).toBe(false);

    // No report saved — hook skips non-terminal statuses
    const outcomeStore = new OutcomeReportStore(join(execDir, "outcomes"));
    const reports = outcomeStore.list();
    expect(reports.length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // (e) Second evaluation idempotent — current snapshot reused
  // -----------------------------------------------------------------------
  it("(e) second evaluation is idempotent — current snapshot reused", async () => {
    const planId = "plan-e";
    writeTrends(execDir, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    // Only baseline snapshot file — current will be auto-captured on first call
    writeSnapshots(execDir, planId, "b1", undefined);

    const hook = createAutomaticOutcomeEvaluator(execDir);
    const state = makeCompletedState(planId, "2026-06-15T12:00:00.000Z");
    const plan = makePlan(planId, "2026-06-10T00:00:00.000Z") as unknown as PersistedExecutionPlan;

    await hook.run(plan, state);

    const firstSnapshotRaw = readFileSync(
      join(execDir, "snapshots", `${planId}-current.json`),
      "utf-8",
    );

    // Second call — must reuse the captured current snapshot, not overwrite
    await hook.run(plan, state);

    const secondSnapshotRaw = readFileSync(
      join(execDir, "snapshots", `${planId}-current.json`),
      "utf-8",
    );

    // Idempotent: second evaluation does NOT trigger a fresh saveCurrent
    expect(secondSnapshotRaw).toBe(firstSnapshotRaw);

    // Outcome report also only saved once (idempotency at the outcome-store level)
    const outcomeStore = new OutcomeReportStore(join(execDir, "outcomes"));
    const reports = outcomeStore.list();
    expect(reports.length).toBe(1);
  });
});