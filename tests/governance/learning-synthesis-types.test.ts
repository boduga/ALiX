/**
 * Tests for P27.1 — Learning Synthesis Types.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type DriftOutcomeTrace,
  type LearningSynthesisReport,
  type DriftCorrelationAnalytics,
} from "../../src/governance/learning-synthesis-types.js";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("LearningSynthesisTypes", () => {

  it("DriftOutcomeTrace has all required fields", () => {
    const trace: DriftOutcomeTrace = {
      outcomeId: "o-1",
      candidateId: "c-1",
      signalId: "s-1",
      signalKind: "calibration_skew",
      signalSeverity: "medium",
      signalDirection: "too_loose",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
      candidateTitle: "Test candidate",
      candidateStatus: "dismissed",
      candidateCreatedAt: "2026-06-15T00:00:00.000Z",
      candidateClosedAt: "2026-06-20T00:00:00.000Z",
      outcomeType: "dismissed_no_change",
      outcomeRecordedAt: "2026-06-20T12:00:00.000Z",
      outcomeRationale: "No evidence of drift.",
      timeToReviewDays: 3,
      timeToOutcomeDays: 5,
    };
    assert.equal(trace.signalKind, "calibration_skew");
    assert.equal(trace.outcomeType, "dismissed_no_change");
  });

  it("trace sorts deterministically by candidateCreatedAt then candidateId", () => {
    const traces: DriftOutcomeTrace[] = [
      { outcomeId: "o-2", candidateId: "c-b", signalId: "s-2", signalKind: "replay_divergence", signalSeverity: "high", signalDirection: "stale", windowStart: "", windowEnd: "", candidateTitle: "", candidateStatus: "", candidateCreatedAt: "2026-06-20T00:00:00.000Z", candidateClosedAt: "", outcomeType: "accepted_for_policy_work", outcomeRecordedAt: "", outcomeRationale: "", timeToReviewDays: 0, timeToOutcomeDays: 0 },
      { outcomeId: "o-1", candidateId: "c-a", signalId: "s-1", signalKind: "calibration_skew", signalSeverity: "medium", signalDirection: "too_loose", windowStart: "", windowEnd: "", candidateTitle: "", candidateStatus: "", candidateCreatedAt: "2026-06-15T00:00:00.000Z", candidateClosedAt: "", outcomeType: "dismissed_no_change", outcomeRecordedAt: "", outcomeRationale: "", timeToReviewDays: 0, timeToOutcomeDays: 0 },
    ];
    traces.sort((a, b) =>
      a.candidateCreatedAt.localeCompare(b.candidateCreatedAt) ||
      a.candidateId.localeCompare(b.candidateId),
    );
    assert.equal(traces[0]!.candidateId, "c-a");
    assert.equal(traces[1]!.candidateId, "c-b");
  });

  it("LearningSynthesisReport includes boundary flags", () => {
    const report: LearningSynthesisReport = {
      reportId: "r-1", windowStart: "", windowEnd: "", generatedAt: "",
      totalSignals: 0, totalCandidates: 0, totalOutcomes: 0,
      outcomeBySignalKind: {}, outcomeBySeverity: {},
      timeStats: { avgTimeToReviewDays: 0, avgTimeToOutcomeDays: 0 },
      traceCompleteness: 0, missingOutcomes: 0,
      repeatedPatterns: [], confidenceByOutcome: {}, signalKindFrequency: {},
      footnotes: [],
      readOnly: true, noPolicyMutation: true, noThresholdChange: true,
      noAutoAdoption: true, noRanking: true,
    };
    assert.equal(report.readOnly, true);
    assert.equal(report.noPolicyMutation, true);
  });
});
