/**
 * P10.9.1-T2 — executive evaluate CLI: snapshot-stack integration tests.
 *
 * Proves the bug fix end-to-end: `alix executive evaluate <planId>` should
 * now produce `evaluationStatus: "completed"` for plans that executed, by
 * resolving baseline + current via the plan-scoped snapshot stack instead
 * of the time-window trend-store lookup.
 *
 * Coverage:
 *   (a) Baseline + current both present → "completed"
 *   (b) Baseline missing → "insufficient_data" with literal warning
 *   (c) Terminal status + current missing → auto-capture fires, evaluator
 *       runs to completion
 *   (d) Non-terminal status + current missing → no auto-capture, evaluator
 *       gets null current, returns "insufficient_data"
 *   (e) Second evaluation idempotent (no second current.json write)
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
import { handleEvaluate } from "../../../src/cli/commands/executive-evaluate-handler.js";
import type { PlanExecutionState } from "../../../src/executive/executive-plan-types.js";

// ---------------------------------------------------------------------------
// Helpers — same layout as the rest of the suite
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

function writePlan(cwd: string, plan: Record<string, unknown>): void {
  const dir = join(cwd, ".alix", "executive", "plans");
  mkdirSync(dir, { recursive: true });
  const hash = computePlanHash(plan);
  const full = { ...plan, contentHash: hash };
  writeFileSync(join(dir, `${plan.id}.json`), JSON.stringify(full, null, 2), "utf-8");
}

function writeState(cwd: string, state: PlanExecutionState): void {
  const dir = join(cwd, ".alix", "executive", "plans");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${state.planId}-state.json`),
    JSON.stringify(state, null, 2),
    "utf-8",
  );
}

function writeTrends(cwd: string, snapshots: Record<string, unknown>[]): void {
  const dir = join(cwd, ".alix", "executive");
  mkdirSync(dir, { recursive: true });
  const lines = snapshots.map(s => JSON.stringify(s)).join("\n");
  writeFileSync(join(dir, "trends.jsonl"), lines + "\n", "utf-8");
}

function writeSnapshots(
  cwd: string,
  planId: string,
  baselineTrendId: string | undefined,
  currentTrendId: string | undefined,
): void {
  const dir = join(cwd, ".alix", "executive", "snapshots");
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
        capturedAt: "2026-06-15T00:00:00.000Z",
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

describe("executive evaluate — snapshot-stack integration (P10.9.1-T2)", () => {
  let tmpDir: string;
  let cwd: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "exec-eval-snap-"));
    cwd = tmpDir;
    originalCwd = process.cwd();
    process.chdir(cwd);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    warnSpy.mockRestore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // (a) Baseline + current both present → "completed"
  // -----------------------------------------------------------------------
  it("(a) baseline + current both present → evaluationStatus: completed", async () => {
    const planId = "plan-a";
    writePlan(cwd, makePlan(planId, "2026-06-10T00:00:00.000Z"));
    writeState(cwd, makeCompletedState(planId, "2026-06-15T12:00:00.000Z"));
    writeTrends(cwd, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    writeSnapshots(cwd, planId, "b1", "c1");

    const stdout: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    });

    await handleEvaluate([planId, "--json"]);

    const output = stdout.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("completed");
    expect(parsed.planId).toBe(planId);
    expect(parsed.evaluatedSubsystems.length).toBeGreaterThan(0);

    logSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // (b) Baseline missing → "insufficient_data" with literal warning
  // -----------------------------------------------------------------------
  it("(b) baseline missing → insufficient_data + literal warning", async () => {
    const planId = "plan-b";
    writePlan(cwd, makePlan(planId, "2026-06-10T00:00:00.000Z"));
    writeState(cwd, makeCompletedState(planId, "2026-06-15T12:00:00.000Z"));
    writeTrends(cwd, [
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    // Intentionally: no snapshot files at all (baseline + current both missing)
    mkdirSync(join(cwd, ".alix", "executive", "snapshots"), { recursive: true });

    const stdout: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    });

    await handleEvaluate([planId, "--json"]);

    const output = stdout.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("insufficient_data");
    expect(parsed.warnings.length).toBeGreaterThan(0);

    // Invariant D — literal message includes "baseline not captured for planId=<id>"
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`baseline not captured for planId=${planId}`),
    );

    logSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // (c) Terminal status + current missing → auto-capture fires
  // -----------------------------------------------------------------------
  it("(c) terminal status + current missing → auto-capture fires, evaluator completes", async () => {
    const planId = "plan-c";
    writePlan(cwd, makePlan(planId, "2026-06-10T00:00:00.000Z"));
    writeState(cwd, makeCompletedState(planId, "2026-06-15T12:00:00.000Z"));
    writeTrends(cwd, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    // Only baseline snapshot file, no current
    writeSnapshots(cwd, planId, "b1", undefined);

    const stdout: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    });

    await handleEvaluate([planId, "--json"]);

    // Invariant C — current snapshot was auto-captured and persisted
    const currentPath = join(cwd, ".alix", "executive", "snapshots", `${planId}-current.json`);
    expect(existsSync(currentPath)).toBe(true);
    const captured = JSON.parse(readFileSync(currentPath, "utf-8"));
    expect(captured.planId).toBe(planId);
    expect(captured.captureKind).toBe("current");

    const output = stdout.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("completed");

    logSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // (d) Non-terminal status + current missing → no auto-capture
  // -----------------------------------------------------------------------
  it("(d) non-terminal status + current missing → no auto-capture, plan_not_executed", async () => {
    const planId = "plan-d";
    writePlan(cwd, makePlan(planId, "2026-06-10T00:00:00.000Z"));
    // Plan is in 'running' state — NOT terminal. Auto-capture must NOT fire.
    writeState(cwd, makeRunningState(planId, "2026-06-15T12:00:00.000Z"));
    writeTrends(cwd, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
    ]);
    // Only baseline snapshot file — no current
    writeSnapshots(cwd, planId, "b1", undefined);

    const stdout: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      stdout.push(args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
    });

    await handleEvaluate([planId, "--json"]);

    // Invariant C — auto-capture only fires for terminal status (completed/failed).
    // Current snapshot file must NOT have been created.
    const currentPath = join(cwd, ".alix", "executive", "snapshots", `${planId}-current.json`);
    expect(existsSync(currentPath)).toBe(false);

    // Plan is not in terminal status, so evaluator returns plan_not_executed.
    // (Invariant C ensures we never write a current snapshot for non-terminal plans,
    // which means subsequent terminal-state evaluations will still auto-capture once.)
    const output = stdout.join("\n");
    const parsed = JSON.parse(output);
    expect(parsed.evaluationStatus).toBe("plan_not_executed");
    // No baseline-missing warning — baseline IS present (not the missing-baseline path)
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("baseline not captured"),
    );

    logSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // (e) Second evaluation is idempotent (no second current.json write)
  // -----------------------------------------------------------------------
  it("(e) second evaluation is idempotent — current snapshot reused", async () => {
    const planId = "plan-e";
    writePlan(cwd, makePlan(planId, "2026-06-10T00:00:00.000Z"));
    writeState(cwd, makeCompletedState(planId, "2026-06-15T12:00:00.000Z"));
    writeTrends(cwd, [
      { id: "b1", generatedAt: "2026-06-09T00:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 40 } },
      { id: "c1", generatedAt: "2026-06-15T12:00:00.000Z", windowDays: 7, subsystemScores: { workflow: 80 } },
    ]);
    // Only baseline snapshot file — current will be auto-captured on first call
    writeSnapshots(cwd, planId, "b1", undefined);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await handleEvaluate([planId, "--json"]);
    const firstSnapshotRaw = readFileSync(
      join(cwd, ".alix", "executive", "snapshots", `${planId}-current.json`),
      "utf-8",
    );

    // Second call — must reuse the captured current snapshot, not overwrite
    await handleEvaluate([planId, "--json"]);

    const secondSnapshotRaw = readFileSync(
      join(cwd, ".alix", "executive", "snapshots", `${planId}-current.json`),
      "utf-8",
    );

    // Idempotent: second evaluation does NOT trigger a fresh saveCurrent
    expect(secondSnapshotRaw).toBe(firstSnapshotRaw);

    logSpy.mockRestore();
  });
});