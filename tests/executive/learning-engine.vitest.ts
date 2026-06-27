import { describe, it, expect } from "vitest";
import { computeLearningTrends } from "../../src/executive/learning-engine.js";
import type { ExecutiveSubsystemName } from "../../src/executive/executive-health.js";
import type { ExecutiveOutcomeEvaluationReport, ObjectiveOutcome } from "../../src/executive/outcome-evaluator.js";
import type { ExecutiveObjectiveType } from "../../src/executive/objective-engine.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeReport(
  overrides: Partial<ExecutiveOutcomeEvaluationReport> & {
    planId: string;
    objectives?: ExecutiveOutcomeEvaluationReport["objectives"];
  },
): ExecutiveOutcomeEvaluationReport {
  const { planId, objectives, ...rest } = overrides;
  return {
    schemaVersion: "p10.5.0",
    generatedAt: "2026-06-25T00:00:00.000Z",
    planId,
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: ["workflow", "governance"],
    objectives: objectives ?? [],
    overallDelta: 0,
    warnings: [],
    ...rest,
  };
}

function obj(
  objectiveId: string,
  objectiveType: ExecutiveObjectiveType,
  targetSubsystems: string[],
  aggregateDelta: number,
  outcome: "improved" | "degraded" | "unchanged" | "mixed",
  subsystemDeltas?: { subsystem: string; baselineScore: number; currentScore: number; delta: number }[],
): ObjectiveOutcome {
  return {
    objectiveId,
    objectiveType,
    targetSubsystems: targetSubsystems as ObjectiveOutcome["targetSubsystems"],
    subsystemDeltas: (subsystemDeltas ?? targetSubsystems.map(s => ({
      subsystem: s as ExecutiveSubsystemName,
      baselineScore: 50,
      currentScore: 50 + aggregateDelta,
      delta: aggregateDelta,
    }))) as ObjectiveOutcome["subsystemDeltas"],
    aggregateDelta,
    outcome,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeLearningTrends", () => {
  it("computes subsystem trends from subsystemDeltas", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow", "governance"], 8, "improved", [
            { subsystem: "workflow", baselineScore: 40, currentScore: 55, delta: 15 },
            { subsystem: "governance", baselineScore: 60, currentScore: 62, delta: 2 },
          ]),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.trendStatus).toBe("ok");

    const wf = result.subsystemTrends.find(s => s.subsystem === "workflow")!;
    expect(wf.averageDelta).toBeCloseTo(15, 0);
    expect(wf.occurrenceCount).toBe(1);
    expect(wf.successRate).toBeCloseTo(1, 0);

    const gov = result.subsystemTrends.find(s => s.subsystem === "governance")!;
    expect(gov.averageDelta).toBeCloseTo(2, 0);
  });

  it("computes objective trends from aggregateDelta", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 8, "improved"),
          obj("o2", "improve", ["workflow"], 3, "mixed"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    const stab = result.objectiveTrends.find(t => t.objectiveType === "stabilize")!;
    expect(stab.averageDelta).toBeCloseTo(8, 0);
    expect(stab.occurrenceCount).toBe(1);
    expect(stab.successRate).toBeCloseTo(1, 0);

    const impr = result.objectiveTrends.find(t => t.objectiveType === "improve")!;
    expect(impr.averageDelta).toBeCloseTo(3, 0);
    expect(impr.mixedRate).toBeCloseTo(1, 0);
  });

  it("correctly classifies outcomes into rate buckets", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 8, "improved"),
          obj("o2", "stabilize", ["workflow"], -5, "degraded"),
          obj("o3", "stabilize", ["workflow"], 0, "unchanged"),
          obj("o4", "stabilize", ["workflow"], 2, "mixed"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    const wf = result.subsystemTrends.find(s => s.subsystem === "workflow")!;
    // 4 objectives × 1 subsystem each = 4 occurrences
    expect(wf.occurrenceCount).toBe(4);
    // improved: 1, degraded: 1, unchanged: 1, mixed: 1 → each 25%
    expect(wf.successRate).toBeCloseTo(0.25, 1);
    expect(wf.degradationRate).toBeCloseTo(0.25, 1);
    expect(wf.unchangedRate).toBeCloseTo(0.25, 1);
    expect(wf.mixedRate).toBeCloseTo(0.25, 1);
  });

  it("filters out non-completed reports", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "completed", objectives: [obj("o1", "stabilize", ["workflow"], 5, "improved")] }),
      makeReport({ planId: "p2", evaluationStatus: "insufficient_data", objectives: [] }),
      makeReport({ planId: "p3", evaluationStatus: "plan_not_executed", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.inputReportCount).toBe(3);
    expect(result.analyzedReportCount).toBe(1);
    expect(result.skippedReportCount).toBe(2);
  });

  it("returns insufficient_data when no reports provided", () => {
    const result = computeLearningTrends([]);
    expect(result.trendStatus).toBe("insufficient_data");
    expect(result.subsystemTrends).toEqual([]);
    expect(result.objectiveTrends).toEqual([]);
  });

  it("returns insufficient_data when all reports are non-completed", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "insufficient_data", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.trendStatus).toBe("insufficient_data");
    expect(result.analyzedReportCount).toBe(0);
    expect(result.skippedReportCount).toBe(1);
  });

  it("skippedReportCount matches input minus analyzed", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "completed", objectives: [obj("o1", "stabilize", ["workflow"], 5, "improved")] }),
      makeReport({ planId: "p2", evaluationStatus: "plan_not_executed", objectives: [] }),
      makeReport({ planId: "p3", evaluationStatus: "insufficient_data", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.inputReportCount).toBe(3);
    expect(result.analyzedReportCount).toBe(1);
    expect(result.skippedReportCount).toBe(2);
  });

  it("sorts by averageDelta desc, then occurrenceCount desc, then name asc", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["governance"], 8, "improved"),
          obj("o2", "stabilize", ["workflow"], 5, "improved"),
        ],
      }),
      makeReport({
        planId: "p2",
        objectives: [
          obj("o3", "improve", ["governance"], 8, "improved"),
          obj("o4", "improve", ["workflow"], 5, "improved"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    // governance avg=8 (two occurrences), workflow avg=5 (two occurrences)
    // governance first, workflow second
    expect(result.subsystemTrends[0].subsystem).toBe("governance");
    expect(result.subsystemTrends[1].subsystem).toBe("workflow");
  });

  it("exposes total counters at TrendResult level", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 5, "improved"),
          obj("o2", "improve", ["workflow"], 3, "mixed"),
          obj("o3", "improve", ["workflow"], -2, "degraded"),
          obj("o4", "maintain", ["workflow"], 0, "unchanged"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.totalImproved).toBe(1);
    expect(result.totalMixed).toBe(1);
    expect(result.totalDegraded).toBe(1);
    expect(result.totalUnchanged).toBe(1);
  });

  it("handles report with 0 objectives as valid completed input", () => {
    const reports = [
      makeReport({ planId: "p1", evaluationStatus: "completed", objectives: [] }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.trendStatus).toBe("ok");
    expect(result.analyzedReportCount).toBe(1);
    expect(result.subsystemTrends).toEqual([]);
    expect(result.objectiveTrends).toEqual([]);
  });

  it("sorts by tie-break rules — same avgDelta and count → alphabetical", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["aa-subsystem"], 5, "improved"),
          obj("o2", "stabilize", ["bb-subsystem"], 5, "improved"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.subsystemTrends[0].subsystem).toBe("aa-subsystem");
    expect(result.subsystemTrends[1].subsystem).toBe("bb-subsystem");
  });

  it("rounds averageDelta to one decimal place", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 1.05, "improved"),
          obj("o2", "stabilize", ["workflow"], 1.95, "improved"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    const wf = result.subsystemTrends.find(s => s.subsystem === "workflow")!;
    expect(wf.averageDelta).toBe(1.5);
    expect(wf.averageDelta).not.toBe(1.499999999999999);
  });

  it("counts two objectives targeting same subsystem as two occurrences", () => {
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["workflow"], 5, "improved"),
          obj("o2", "improve", ["workflow"], 3, "mixed"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    const wf = result.subsystemTrends.find(s => s.subsystem === "workflow")!;
    expect(wf.occurrenceCount).toBe(2);
  });

  it("orders by all three sort keys: avgDelta desc → count desc → name asc", () => {
    // A: avg=5, count=3
    // B: avg=5, count=2
    // C: avg=5, count=3
    // Expected: A → C → B (A beats C on name asc, C beats B on count desc)
    const reports = [
      makeReport({
        planId: "p1",
        objectives: [
          obj("o1", "stabilize", ["A"], 5, "improved"),
          obj("o2", "stabilize", ["A"], 5, "improved"),
          obj("o3", "stabilize", ["A"], 5, "improved"),
          obj("o4", "stabilize", ["B"], 5, "improved"),
          obj("o5", "stabilize", ["B"], 5, "improved"),
          obj("o6", "stabilize", ["C"], 5, "improved"),
          obj("o7", "stabilize", ["C"], 5, "improved"),
          obj("o8", "stabilize", ["C"], 5, "improved"),
        ],
      }),
    ];
    const result = computeLearningTrends(reports);
    expect(result.subsystemTrends.map(s => s.subsystem)).toEqual(["A", "C", "B"]);
  });
});
