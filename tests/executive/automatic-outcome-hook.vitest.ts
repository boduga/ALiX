/**
 * P10.5c — AutomaticOutcomeEvaluator unit tests.
 *
 * Verifies the hook that bridges ExecutionEngine → OutcomeReportStore:
 *   - Determines terminalTimestamp (completedAt wins over failedAt)
 *   - Idempotent: keyed by (planId, terminalTimestamp)
 *   - Idempotency preserves corrupted audit artifacts (no overwrite)
 *   - Best-effort: never throws upward
 *   - Does NOT mutate the report returned by evaluatePlanOutcome
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutomaticOutcomeEvaluator } from "../../src/executive/automatic-outcome-hook.js";
import { OutcomeReportStore } from "../../src/executive/outcome-store.js";
import { ExecutiveTrendStore } from "../../src/executive/trend-store.js";
import { evaluatePlanOutcome } from "../../src/executive/outcome-evaluator.js";
import type { PersistedExecutionPlan, PlanExecutionState } from "../../src/executive/executive-plan-types.js";

// ---------------------------------------------------------------------------
// Mock the pure evaluator so tests don't have to construct full plan/state pairs.
// vi.mock applies before any import that uses evaluatePlanOutcome.
// ---------------------------------------------------------------------------
vi.mock("../../src/executive/outcome-evaluator.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/executive/outcome-evaluator.js")
  >("../../src/executive/outcome-evaluator.js");
  return {
    ...actual,
    evaluatePlanOutcome: vi.fn(actual.evaluatePlanOutcome),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlan(planId: string, generatedAt: string): PersistedExecutionPlan {
  return {
    id: planId,
    steps: [
      {
        id: "s1",
        stepNumber: 1,
        title: "Test",
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
    contentHash: "hash",
  };
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

function makeFailedState(planId: string, failedAt: string): PlanExecutionState {
  return {
    planId,
    status: "failed",
    approval: { status: "approved" },
    stepStates: {},
    planTransitions: [],
    timestamps: { createdAt: failedAt, failedAt },
  };
}

function makeTrendSnapshot(generatedAt: string) {
  return {
    schemaVersion: "p10.0.0" as const,
    generatedAt,
    windowDays: 7,
    overallScore: 50,
    rankedSubsystems: [
      { subsystem: "workflow" as const, score: 50, summary: "ok", status: "healthy" as const, topIssues: [] },
    ],
  };
}

function reportsAfterRun(store: OutcomeReportStore) {
  return store.list();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutomaticOutcomeEvaluator", () => {
  let tmpDir: string;
  let execDir: string;
  let outcomesDir: string;
  let trendsDir: string;
  let outcomeStore: OutcomeReportStore;
  let trendStore: ExecutiveTrendStore;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "auto-outcome-"));
    execDir = join(tmpDir, ".alix", "executive");
    outcomesDir = join(execDir, "outcomes");
    trendsDir = join(execDir, "trends");
    mkdirSync(outcomesDir, { recursive: true });
    mkdirSync(trendsDir, { recursive: true });
    outcomeStore = new OutcomeReportStore(outcomesDir);
    trendStore = new ExecutiveTrendStore(execDir);
    // Pre-populate with a trend snapshot. findBaseline needs generatedAt
    // <= plan.generatedAt (which is "2026-06-10T00:00:00.000Z"); current
    // snapshot can be any later timestamp.
    await trendStore.save(makeTrendSnapshot("2026-06-05T00:00:00.000Z"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(evaluatePlanOutcome).mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("evaluates and saves a report when plan status is completed", async () => {
    const plan = makePlan("p1", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p1", "2026-06-15T12:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).toHaveBeenCalledOnce();
    const reports = reportsAfterRun(outcomeStore);
    expect(reports.length).toBe(1);
    expect(reports[0].planId).toBe("p1");
    expect(reports[0].evaluationStatus).toBe("completed");
  });

  it("evaluates and saves when status is failed", async () => {
    const plan = makePlan("p2", "2026-06-10T00:00:00.000Z");
    const state = makeFailedState("p2", "2026-06-15T13:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).toHaveBeenCalledOnce();
    expect(reportsAfterRun(outcomeStore).length).toBe(1);
  });

  it("uses completedAt as terminalTimestamp when both completedAt and failedAt are present", async () => {
    const plan = makePlan("p3", "2026-06-10T00:00:00.000Z");
    const state: PlanExecutionState = {
      ...makeFailedState("p3", "2026-06-15T13:00:00.000Z"),
      timestamps: {
        createdAt: "2026-06-10T00:00:00.000Z",
        completedAt: "2026-06-15T12:00:00.000Z",
        failedAt: "2026-06-15T13:00:00.000Z",
      },
    };
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    // The filename should encode completedAt, not failedAt
    const files = readdirSync(outcomesDir) as string[];
    expect(files.some((f) => f.includes("20260615T120000000Z"))).toBe(true);
    expect(files.some((f) => f.includes("20260615T130000000Z"))).toBe(false);
  });

  it("skips and warns when terminalTimestamp is missing", async () => {
    const plan = makePlan("p4", "2026-06-10T00:00:00.000Z");
    const state: PlanExecutionState = {
      ...makeCompletedState("p4", "2026-06-15T12:00:00.000Z"),
      timestamps: { createdAt: "2026-06-10T00:00:00.000Z" }, // no completedAt, no failedAt
    };
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).not.toHaveBeenCalled();
    expect(reportsAfterRun(outcomeStore).length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("terminal timestamp"));
  });

  it("skips when a report already exists for the same (planId, terminalTimestamp) — idempotent", async () => {
    const plan = makePlan("p5", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p5", "2026-06-15T12:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await evaluator.run(plan, state);
    await evaluator.run(plan, state);
    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).toHaveBeenCalledOnce();
    expect(reportsAfterRun(outcomeStore).length).toBe(1);
  });

  it("does not mutate the report returned by evaluatePlanOutcome", async () => {
    const plan = makePlan("p6", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p6", "2026-06-15T12:00:00.000Z");
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    // Capture the report produced by the evaluator.
    // The default mock (vi.mocked) delegates to the real implementation; we
    // observe the object passed to save via snapshotting the call argument.
    let savedGeneratedAt: string | undefined;
    const realSave = outcomeStore.save.bind(outcomeStore);
    outcomeStore.save = (report) => {
      savedGeneratedAt = report.generatedAt;
      return realSave(report);
    };

    await evaluator.run(plan, state);

    // The saved report's generatedAt must equal the terminal timestamp.
    expect(savedGeneratedAt).toBe(state.timestamps.completedAt);
    expect(reportsAfterRun(outcomeStore)[0].generatedAt).toBe(state.timestamps.completedAt);

    // And the evaluator itself was called only once with the real arg list.
    expect(evaluatePlanOutcome).toHaveBeenCalledOnce();
  });

  it("does NOT overwrite a corrupted audit artifact (OutcomeReportIntegrityError)", async () => {
    const plan = makePlan("p7", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p7", "2026-06-15T12:00:00.000Z");
    const reportId = `outcome-p7-${"2026-06-15T12:00:00.000Z".replace(/[-:]/g, "").replace(".", "")}`;
    const corruptPath = join(outcomesDir, `${reportId}.json`);

    // Write a file with valid JSON but invalid contentHash
    writeFileSync(
      corruptPath,
      JSON.stringify({
        schemaVersion: "p10.5b.0",
        id: reportId,
        contentHash: "0000000000000000000000000000000000000000000000000000000000000000",
        report: {
          ...plan,
          planStatus: "completed",
          evaluationStatus: "completed",
          baselineSnapshotId: undefined,
          currentSnapshotId: undefined,
          baselineGeneratedAt: undefined,
          currentGeneratedAt: undefined,
          evaluatedSubsystems: [],
          objectives: [],
          overallDelta: 0,
          warnings: [],
        },
      }),
      "utf-8",
    );
    const originalContent = readFileSync(corruptPath, "utf-8");

    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);
    await evaluator.run(plan, state);

    // File must NOT have been overwritten
    expect(readFileSync(corruptPath, "utf-8")).toBe(originalContent);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("integrity"));
  });

  it("save failures do not throw — only warn", async () => {
    const plan = makePlan("p8", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p8", "2026-06-15T12:00:00.000Z");
    // Use a store pointing to an unwritable directory
    const badStore = new OutcomeReportStore("/nonexistent/path/cannot/write");
    const evaluator = new AutomaticOutcomeEvaluator(badStore, trendStore);

    await expect(evaluator.run(plan, state)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("skips and warns when load() throws a non-integrity runtime error — no save", async () => {
    const plan = makePlan("p9", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p9", "2026-06-15T12:00:00.000Z");
    const saveSpy = vi.spyOn(outcomeStore, "save");
    vi.spyOn(outcomeStore, "load").mockImplementationOnce(() => {
      throw new Error("EACCES: simulated runtime error");
    });
    const evaluator = new AutomaticOutcomeEvaluator(outcomeStore, trendStore);

    await expect(evaluator.run(plan, state)).resolves.toBeUndefined();

    // A non-integrity runtime error follows the generic skip-and-warn path
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected load error"),
    );
    // save must NOT be called — a runtime-failed load means we can't read,
    // so we don't overwrite (forensic invariant)
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
