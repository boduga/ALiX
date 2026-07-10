import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCorrelationAnalytics } from "../../src/governance/learning-synthesis-analytics.js";
import type { DriftOutcomeTrace } from "../../src/governance/learning-synthesis-types.js";

const ISO = "2026-06-15T00:00:00.000Z";

function trace(overrides: Partial<DriftOutcomeTrace> = {}): DriftOutcomeTrace {
  return {
    outcomeId: "o-1", candidateId: "c-1", signalId: "s-1",
    signalKind: "calibration_skew", signalSeverity: "medium",
    signalDirection: "too_loose", windowStart: "", windowEnd: "",
    candidateTitle: "", candidateStatus: "", candidateCreatedAt: ISO,
    candidateClosedAt: "", outcomeType: "dismissed_no_change",
    outcomeRecordedAt: "", outcomeRationale: "",
    timeToReviewDays: 0, timeToOutcomeDays: 0,
    ...overrides,
  };
}

describe("computeCorrelationAnalytics", () => {

  it("empty traces produce zero counts", () => {
    const analytics = computeCorrelationAnalytics([]);
    assert.equal(analytics.totalOutcomes, 0);
    assert.equal(analytics.traceCompleteness, 0);
  });

  it("outcome frequency by signal kind is correct", () => {
    const traces = [
      trace({ signalKind: "calibration_skew", outcomeType: "dismissed_no_change" }),
      trace({ outcomeId: "o-2", signalKind: "calibration_skew", outcomeType: "accepted_for_policy_work" }),
      trace({ outcomeId: "o-3", signalKind: "replay_divergence", outcomeType: "dismissed_no_change" }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.totalOutcomes, 3);
    assert.equal(analytics.outcomeBySignalKind.calibration_skew?.dismissed_no_change, 1);
    assert.equal(analytics.outcomeBySignalKind.calibration_skew?.accepted_for_policy_work, 1);
  });

  it("outcome frequency by severity is correct", () => {
    const traces = [
      trace({ signalSeverity: "high", outcomeType: "accepted_for_policy_work" }),
      trace({ outcomeId: "o-2", signalSeverity: "medium", outcomeType: "dismissed_no_change" }),
      trace({ outcomeId: "o-3", signalSeverity: "high", outcomeType: "accepted_for_policy_work" }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.outcomeBySeverity.high?.accepted_for_policy_work, 2);
    assert.equal(analytics.outcomeBySeverity.medium?.dismissed_no_change, 1);
  });

  it("time stats computed correctly", () => {
    const traces = [
      trace({ timeToReviewDays: 2, timeToOutcomeDays: 5 }),
      trace({ outcomeId: "o-2", timeToReviewDays: 4, timeToOutcomeDays: 7 }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.timeStats.avgTimeToReviewDays, 3);
    assert.equal(analytics.timeStats.avgTimeToOutcomeDays, 6);
  });

  it("no causation claims in output", () => {
    const analytics = computeCorrelationAnalytics([trace()]);
    const json = JSON.stringify(analytics);
    assert.equal(json.includes("caused"), false);
    assert.equal(json.includes("causation"), false);
  });

  it("no reviewer ranking in output", () => {
    const analytics = computeCorrelationAnalytics([trace()]);
    const keys = Object.keys(analytics);
    assert.equal(keys.some(k => k.includes("reviewer") || k.includes("ranking")), false);
  });

  it("partial trace with missing candidate preserves available fields (no inferred events)", () => {
    // Simulate trace built from outcome with no matching candidate
    const partialTraces = [
      trace({ candidateId: "missing-candidate", candidateTitle: "",
              candidateStatus: "", signalKind: "", signalSeverity: "",
              signalDirection: "", signalId: "" }),
    ];
    const analytics = computeCorrelationAnalytics(partialTraces);
    assert.equal(analytics.totalOutcomes, 1);
    // Empty signal kind produces empty key — no fabricated data
    assert.equal(Object.keys(analytics.outcomeBySignalKind).filter(k => k).length, 0);
  });

  it("no predictive scores or likelihood estimates", () => {
    const analytics = computeCorrelationAnalytics([trace()]);
    const json = JSON.stringify(analytics);
    assert.equal(json.includes("predictiveScore"), false);
    assert.equal(json.includes("likelihood"), false);
  });

  it("traceCompleteness computed as ratio of outcomes to candidates", () => {
    const traces = [
      trace({ outcomeId: "o-1", candidateId: "c-1" }),
      trace({ outcomeId: "o-2", candidateId: "c-2" }),
    ];
    const analytics = computeCorrelationAnalytics(traces);
    assert.equal(analytics.traceCompleteness, 1);
  });
});
