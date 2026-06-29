/**
 * P10.5c + P10.9.1-T2b — AutomaticOutcomeEvaluator unit tests.
 *
 * Verifies the hook that bridges ExecutionEngine → OutcomeReportStore:
 *   - Determines terminalTimestamp (completedAt wins over failedAt)
 *   - Idempotent: keyed by (planId, terminalTimestamp)
 *   - Idempotency preserves corrupted audit artifacts (no overwrite)
 *   - Best-effort: never throws upward
 *   - Does NOT mutate the report returned by evaluatePlanOutcome
 *   - Skips plans without terminal timestamp
 *
 * All tests construct the hook via the standard factory
 * `createAutomaticOutcomeEvaluator(execDir)` and seed the snapshot stack
 * (`snapshots/<planId>-baseline.json` + `snapshots/<planId>-current.json`)
 * plus a `trends.jsonl` file containing the referenced ExecutiveTrendSnapshots.
 * The legacy 2-arg constructor / time-window fallback path has been
 * removed (P10.9.1-T2b).
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  AutomaticOutcomeEvaluator,
  createAutomaticOutcomeEvaluator,
} from "../../src/executive/automatic-outcome-hook.js";
import { OutcomeReportStore } from "../../src/executive/outcome-store.js";
import { evaluatePlanOutcome } from "../../src/executive/outcome-evaluator.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../src/executive/outcome-evaluator.js";
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

// ---------------------------------------------------------------------------
// Snapshot-stack seed helpers
//
// The hook (P10.9.1-T2) resolves baseline + current through the plan-scoped
// snapshot stack:
//
//   snapshotStore.loadBaseline(planId)
//     → snapshot.rawSubsystemState.trendSnapshotId
//     → trendStore.loadById(id)
//
// Tests need to populate both layers to satisfy the new path. The helpers
// below build a tiny end-to-end pipeline that the snapshot tests also use.
// ---------------------------------------------------------------------------

interface SeededSnapshotStackOptions {
  baselineTrendId?: string;
  currentTrendId?: string;
  baselineCapturedAt?: string;
  currentCapturedAt?: string;
}

const DEFAULT_BASELINE_TREND_ID = "b-trend";
const DEFAULT_CURRENT_TREND_ID = "c-trend";

function trendSnapshot(id: string, generatedAt: string, score: number) {
  return {
    id,
    generatedAt,
    windowDays: 7,
    subsystemScores: { workflow: score },
  };
}

function writeSnapshotFile(
  snapshotsDir: string,
  planId: string,
  captureKind: "baseline" | "current",
  trendSnapshotId: string,
  capturedAt: string,
): void {
  mkdirSync(snapshotsDir, { recursive: true });
  writeFileSync(
    join(snapshotsDir, `${planId}-${captureKind}.json`),
    JSON.stringify({
      metadata: {
        snapshotVersion: 1,
        alixVersion: "0.0.0",
        executiveEngineVersion: "1.0",
        createdBy: "ExecutionEngine",
        reason: "execution-start",
      },
      planId,
      capturedAt,
      captureKind,
      rawSubsystemState: {
        trendSnapshotId,
        outcomeReportIds: [],
      },
      id: `${planId}-${captureKind}`,
    }),
    "utf-8",
  );
}

/**
 * Seed `trends.jsonl` + the snapshot stack so `evaluatePlanOutcome` resolves
 * both baseline + current `ExecutiveTrendSnapshot`s for the given planId.
 */
function seedSnapshotStack(
  execDir: string,
  planId: string,
  options: SeededSnapshotStackOptions = {},
): void {
  const snapshotsDir = join(execDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });

  const baselineId = options.baselineTrendId ?? DEFAULT_BASELINE_TREND_ID;
  const currentId = options.currentTrendId ?? DEFAULT_CURRENT_TREND_ID;

  writeSnapshotFile(
    snapshotsDir,
    planId,
    "baseline",
    baselineId,
    options.baselineCapturedAt ?? "2026-06-10T00:00:00.000Z",
  );
  writeSnapshotFile(
    snapshotsDir,
    planId,
    "current",
    currentId,
    options.currentCapturedAt ?? "2026-06-15T12:00:00.000Z",
  );

  // Trends file must contain both baseline + current trend snapshots so
  // `loadById(id)` resolves them.
  const trendsPath = join(execDir, "trends.jsonl");
  mkdirSync(execDir, { recursive: true });
  writeFileSync(
    trendsPath,
    [
      JSON.stringify(trendSnapshot(baselineId, "2026-06-09T00:00:00.000Z", 40)),
      JSON.stringify(trendSnapshot(currentId, "2026-06-15T12:00:00.000Z", 80)),
      "",
    ].join("\n"),
    "utf-8",
  );
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
  let outcomeStore: OutcomeReportStore;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "auto-outcome-"));
    execDir = join(tmpDir, ".alix", "executive");
    outcomesDir = join(execDir, "outcomes");
    mkdirSync(outcomesDir, { recursive: true });
    outcomeStore = new OutcomeReportStore(outcomesDir);
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
    seedSnapshotStack(execDir, "p1");
    const evaluator = createAutomaticOutcomeEvaluator(execDir);

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
    seedSnapshotStack(execDir, "p2");
    const evaluator = createAutomaticOutcomeEvaluator(execDir);

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
    seedSnapshotStack(execDir, "p3");
    const evaluator = createAutomaticOutcomeEvaluator(execDir);

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
    seedSnapshotStack(execDir, "p4");
    const evaluator = createAutomaticOutcomeEvaluator(execDir);

    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).not.toHaveBeenCalled();
    expect(reportsAfterRun(outcomeStore).length).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("terminal timestamp"));
  });

  it("skips when a report already exists for the same (planId, terminalTimestamp) — idempotent", async () => {
    const plan = makePlan("p5", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p5", "2026-06-15T12:00:00.000Z");
    seedSnapshotStack(execDir, "p5");
    const evaluator = createAutomaticOutcomeEvaluator(execDir);

    await evaluator.run(plan, state);
    await evaluator.run(plan, state);
    await evaluator.run(plan, state);

    expect(evaluatePlanOutcome).toHaveBeenCalledOnce();
    expect(reportsAfterRun(outcomeStore).length).toBe(1);
  });

  it("does not mutate the report returned by evaluatePlanOutcome", async () => {
    const plan = makePlan("p6", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p6", "2026-06-15T12:00:00.000Z");
    seedSnapshotStack(execDir, "p6");
    const evaluator = createAutomaticOutcomeEvaluator(execDir);

    // Wrap the pure evaluator to capture the object it returns. The hook
    // must produce the saved report WITHOUT mutating this captured object.
    let pureReturnedReport: ExecutiveOutcomeEvaluationReport | undefined;
    const realEval = vi.mocked(evaluatePlanOutcome).getMockImplementation();
    expect(realEval).toBeDefined();
    vi.mocked(evaluatePlanOutcome).mockImplementation((planArg, stateArg, baseline, current) => {
      const result = (realEval as Function)(planArg, stateArg, baseline, current) as ExecutiveOutcomeEvaluationReport;
      pureReturnedReport = result;
      return result;
    });

    await evaluator.run(plan, state);

    expect(pureReturnedReport).toBeDefined();
    const pureSnapshot = JSON.stringify(pureReturnedReport);

    // The hook's saved report should not share object identity with the
    // pure return value (no mutation risk) — re-read the file and verify
    // it contains the same hook-applied fields the source expects
    // (generatedAt === terminalTimestamp).
    const saved = reportsAfterRun(outcomeStore)[0];
    expect(saved.generatedAt).toBe(state.timestamps.completedAt);

    // Verify the pure evaluator's object is unchanged after run()
    expect(JSON.stringify(pureReturnedReport)).toBe(pureSnapshot);

    // Evaluator was called exactly once with the real arg list
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

    seedSnapshotStack(execDir, "p7");
    const evaluator = createAutomaticOutcomeEvaluator(execDir);
    await evaluator.run(plan, state);

    // File must NOT have been overwritten
    expect(readFileSync(corruptPath, "utf-8")).toBe(originalContent);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("integrity"));
  });

  it("save failures do not throw — only warn", async () => {
    const plan = makePlan("p8", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p8", "2026-06-15T12:00:00.000Z");
    seedSnapshotStack(execDir, "p8");
    // Force the underlying OutcomeReportStore.save to throw. The factory wraps
    // its own private OutcomeReportStore, but we can monkey-patch the method
    // on the same `outcomeStore` instance only when we use the factory with
    // the SAME outcomesDir. The factory used `outcomesDir` constructed from
    // `execDir/outcomes`, which is exactly `outcomesDir` here.
    //
    // But the factory creates its OWN store. Workaround: build a fresh store
    // pointing at the same outcomes directory, then patch save on the SAME
    // store. We re-implement the factory by constructing the store directly.
    const trendStore = new (await import("../../src/executive/trend-store.js"))
      .ExecutiveTrendStore(execDir);
    const eval2 = new AutomaticOutcomeEvaluator(outcomeStore, trendStore, execDir);
    const originalSave = outcomeStore.save.bind(outcomeStore);
    outcomeStore.save = () => {
      throw new Error("EACCES: simulated save failure");
    };

    await expect(eval2.run(plan, state)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Auto-evaluation failed"));

    outcomeStore.save = originalSave;
  });

  it("skips and warns when load() throws a non-integrity runtime error — no save", async () => {
    const plan = makePlan("p9", "2026-06-10T00:00:00.000Z");
    const state = makeCompletedState("p9", "2026-06-15T12:00:00.000Z");
    seedSnapshotStack(execDir, "p9");
    // Construct with the factory, but force the load() call inside run()
    // to throw a non-integrity error. The factory wires OutcomeReportStore
    // internally; we patch the method on the OutcomeReportStore.prototype
    // and restore after the call so other tests are unaffected.
    const OutcomeReportStoreMod = await import("../../src/executive/outcome-store.js");
    const proto = OutcomeReportStoreMod.OutcomeReportStore.prototype;
    const originalLoad = proto.load;
    const originalSave = proto.save;
    let saveCalls = 0;
    proto.load = function (): unknown {
      throw new Error("EACCES: simulated runtime error");
    } as typeof proto.load;
    proto.save = function (this: OutcomeReportStore, ...args: Parameters<typeof proto.save>) {
      saveCalls++;
      return originalSave.apply(this, args);
    } as typeof proto.save;

    const evaluator = createAutomaticOutcomeEvaluator(execDir);
    let resolved: unknown;
    let threw: unknown;
    try {
      await evaluator.run(plan, state);
      resolved = undefined;
    } catch (e) {
      threw = e;
    } finally {
      proto.load = originalLoad;
      proto.save = originalSave;
    }

    // Hook must NOT throw upward — best-effort contract
    expect(threw).toBeUndefined();
    expect(resolved).toBeUndefined();

    // A non-integrity runtime error follows the generic skip-and-warn path
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unexpected load error"),
    );
    // save must NOT be called — a runtime-failed load means we can't read,
    // so we don't overwrite (forensic invariant)
    expect(saveCalls).toBe(0);
  });
});
