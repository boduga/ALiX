/**
 * P10.8c — Predictive Signal Correlation tests.
 *
 * Tests for SubsystemTimeMatcher.match() and computeSubsystemCorrelation().
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import { SubsystemTimeMatcher, computeSubsystemCorrelation, CorrelationMode } from "../../src/executive/subsystem-correlation.js";
import type { RecommendationEntry } from "../../src/executive/recommendation-effectiveness.js";
import type { ExecutiveOutcomeEvaluationReport, SubsystemDelta } from "../../src/executive/outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal completed outcome report with one objective and one SubsystemDelta. */
function makeReport(
  generatedAt: string,
  subsystem: string,
  delta: number,
  baselineScore = 50,
  currentScore = 50 + delta,
): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId: "plan-1",
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: [subsystem as any],
    objectives: [{
      objectiveId: "obj-1",
      objectiveType: "stabilize",
      targetSubsystems: [subsystem],
      subsystemDeltas: [{ subsystem: subsystem as any, baselineScore, currentScore, delta }],
      aggregateDelta: delta,
      outcome: delta > 0 ? "improved" as const : delta < 0 ? "degraded" as const : "unchanged" as const,
    }],
    overallDelta: delta,
    warnings: [],
  };
}

/** Build a minimal RecommendationEntry. */
function recEntry(over: Partial<RecommendationEntry> = {}): RecommendationEntry {
  return {
    reportId: "r1",
    generatedAt: "2026-06-20T00:00:00.000Z",
    recIndex: 0,
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    signalConfidence: 0.88,
    recommendation: "Investigate workflow",
    ageDays: 7,
    disposition: "applied",
    proposalId: "p1",
    ...over,
  };
}

const GENERATED_AT = "2026-06-27T00:00:00.000Z";

// ---------------------------------------------------------------------------
// SubsystemTimeMatcher.match
// ---------------------------------------------------------------------------

describe("SubsystemTimeMatcher.match", () => {
  it("matches subsystem across objectives within a report", async () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", subsystem: "workflow" });
    // Two objectives, one matching workflow, one not
    const report = {
      ...makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5),
      objectives: [
        ...makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5).objectives,
        {
          objectiveId: "obj-2",
          objectiveType: "improve" as const,
          targetSubsystems: ["memory"],
          subsystemDeltas: [{ subsystem: "memory" as any, baselineScore: 50, currentScore: 45, delta: -5 }],
          aggregateDelta: -5,
          outcome: "degraded" as const,
        },
      ],
    };
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const results = await matcher.match(rec, [report]);
    // Only the workflow delta should match
    expect(results).toHaveLength(1);
    expect(results[0].delta.subsystem).toBe("workflow");
    expect(results[0].delta.delta).toBe(1.5);
  });

  it("strict mode excludes outcomes generatedAt <= rec.generatedAt", async () => {
    const rec = recEntry({ generatedAt: "2026-06-25T00:00:00.000Z" });
    const report = makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5); // same time
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(await matcher.match(rec, [report])).toHaveLength(0);
  });

  it("strict mode excludes outcomes beyond lag window", async () => {
    const rec = recEntry({ generatedAt: "2026-06-01T00:00:00.000Z" });
    const report = makeReport("2026-07-15T00:00:00.000Z", "workflow", 1.5); // > 30 days later
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(await matcher.match(rec, [report])).toHaveLength(0);
  });

  it("loose mode includes all outcomes regardless of timing", async () => {
    const rec = recEntry({ generatedAt: "2026-06-25T00:00:00.000Z" });
    const earlier = makeReport("2026-06-20T00:00:00.000Z", "workflow", 1.5);
    const matcher = new SubsystemTimeMatcher("loose", 30);
    expect(await matcher.match(rec, [earlier])).toHaveLength(1);
  });

  it("no matching subsystem returns empty", async () => {
    const rec = recEntry({ subsystem: "security" });
    const report = makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.5);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(await matcher.match(rec, [report])).toHaveLength(0);
  });

  it("empty reports array returns empty", async () => {
    const rec = recEntry();
    const matcher = new SubsystemTimeMatcher("strict", 30);
    expect(await matcher.match(rec, [])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeSubsystemCorrelation
// ---------------------------------------------------------------------------

describe("computeSubsystemCorrelation", () => {
  it("returns no_data for empty recommendations", async () => {
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation([], [], matcher, "strict", 30, GENERATED_AT);
    expect(result.correlationStatus).toBe("no_data");
  });

  it("returns no_data when no outcome reports", async () => {
    const rec = recEntry();
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation([rec], [], matcher, "strict", 30, GENERATED_AT);
    expect(result.correlationStatus).toBe("no_data");
  });

  it("correctly aggregates per-subsystem correlation metrics", async () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z" });
    const report1 = makeReport("2026-06-22T00:00:00.000Z", "workflow", 3.0);
    const report2 = makeReport("2026-06-25T00:00:00.000Z", "workflow", -1.0);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation(
      [rec],
      [report1, report2],
      matcher, "strict", 30, GENERATED_AT,
    );
    const sub = result.subsystemCorrelations[0];
    expect(sub.subsystem).toBe("workflow");
    expect(sub.recommendationCount).toBe(1);
    expect(sub.matchedRecommendationCount).toBe(1); // 1 recommendation had matches
    expect(sub.matchedDeltaCount).toBe(2);           // 2 SubsystemDeltas matched
    expect(sub.averageDelta).toBe(1.0);   // (3.0 + -1.0) / 2
    expect(sub.averageAbsoluteDelta).toBe(2.0); // (|3.0| + |-1.0|) / 2
    expect(sub.netDelta).toBe(2.0);
    expect(sub.correlationEffectiveness).toBe(0.5); // 1 improving / 2 total
  });

  it("averageAbsoluteDelta detects magnitude when signs cancel", async () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z" });
    const report1 = makeReport("2026-06-22T00:00:00.000Z", "workflow", 8.0);
    const report2 = makeReport("2026-06-25T00:00:00.000Z", "workflow", -8.0);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation(
      [rec], [report1, report2], matcher, "strict", 30, GENERATED_AT,
    );
    const sub = result.subsystemCorrelations[0];
    expect(sub.averageDelta).toBe(0);  // cancels out
    expect(sub.averageAbsoluteDelta).toBe(8.0); // magnitude preserved
  });

  it("uncorrelatedRecommendationCount correctly reflects recs with no match", async () => {
    const rec1 = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", subsystem: "workflow" });
    const rec2 = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", subsystem: "security" });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation(
      [rec1, rec2], [report], matcher, "strict", 30, GENERATED_AT,
    );
    const sub = result.subsystemCorrelations.find((s) => s.subsystem === "workflow")!;
    expect(sub.uncorrelatedRecommendationCount).toBe(0);
    const sec = result.subsystemCorrelations.find((s) => s.subsystem === "security")!;
    expect(sec.uncorrelatedRecommendationCount).toBe(1);
  });

  it("lagDays correctly computed", async () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z" });
    const report = makeReport("2026-06-25T00:00:00.000Z", "workflow", 1.0);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation(
      [rec], [report], matcher, "strict", 30, GENERATED_AT,
    );
    expect(result.correlations[0].lagDays).toBe(5);
  });

  it("recommendationDisposition propagated from RecommendationEntry", async () => {
    const rec = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", disposition: "applied" });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation(
      [rec], [report], matcher, "strict", 30, GENERATED_AT,
    );
    expect(result.correlations[0].recommendationDisposition).toBe("applied");
  });

  it("per-signal aggregation works correctly", async () => {
    const rec = recEntry({
      generatedAt: "2026-06-20T00:00:00.000Z",
      signal: "degrading_trend",
    });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation(
      [rec], [report], matcher, "strict", 30, GENERATED_AT,
    );
    const sig = result.signalCorrelations[0];
    expect(sig.signal).toBe("degrading_trend");
    expect(sig.coverageRate).toBe(1.0); // 1 correlated / 1 total
    expect(sig.improvingRate).toBe(1.0); // 1 improving / 1 correlated
  });

  it("multiple recommendations with same signal computes correct coverageRate", async () => {
    const rec1 = recEntry({ generatedAt: "2026-06-20T00:00:00.000Z", signal: "degrading_trend" });
    const rec2 = recEntry({
      generatedAt: "2026-06-20T00:00:00.000Z",
      signal: "degrading_trend",
      recIndex: 1,
      subsystem: "memory",
    });
    const report = makeReport("2026-06-22T00:00:00.000Z", "workflow", 1.0);
    // rec2 is about "memory" — won't match workflow report
    const matcher = new SubsystemTimeMatcher("strict", 30);
    const result = await computeSubsystemCorrelation(
      [rec1, rec2], [report], matcher, "strict", 30, GENERATED_AT,
    );
    const sig = result.signalCorrelations.find((s) => s.signal === "degrading_trend")!;
    expect(sig.recommendationCount).toBe(2);
    expect(sig.matchedRecommendationCount).toBe(1);
    expect(sig.matchedDeltaCount).toBe(1);
    expect(sig.coverageRate).toBe(0.5);
  });
});
