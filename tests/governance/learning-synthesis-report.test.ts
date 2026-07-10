import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSynthesisReport, renderSynthesisReportText } from "../../src/governance/learning-synthesis-report.js";
import { computeCorrelationAnalytics } from "../../src/governance/learning-synthesis-analytics.js";

const ISO = "2026-06-15T00:00:00.000Z";

function trace(overrides: Record<string, unknown> = {}) {
  return {
    outcomeId: "o-1", candidateId: "c-1", signalId: "s-1",
    signalKind: "calibration_skew", signalSeverity: "medium",
    signalDirection: "too_loose", windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    candidateTitle: "Test", candidateStatus: "dismissed",
    candidateCreatedAt: ISO, candidateClosedAt: ISO,
    outcomeType: "dismissed_no_change",
    outcomeRecordedAt: ISO, outcomeRationale: "No evidence.",
    timeToReviewDays: 2, timeToOutcomeDays: 5,
    ...overrides,
  };
}

describe("buildSynthesisReport", () => {

  it("empty traces produce clean report", () => {
    const analytics = computeCorrelationAnalytics([]);
    const report = buildSynthesisReport([], analytics);
    assert.equal(report.totalOutcomes, 0);
    assert.equal(report.totalSignals, 0);
  });

  it("report includes all required footnotes", () => {
    const analytics = computeCorrelationAnalytics([]);
    const report = buildSynthesisReport([], analytics);
    assert.ok(report.footnotes.length >= 3);
    assert.ok(report.footnotes.some(f => f.includes("descriptive")));
    assert.ok(report.footnotes.some(f => f.includes("correlation")));
    assert.ok(report.footnotes.some(f => f.includes("human control")));
  });

  it("report uses descriptive language (no prescriptive statements)", () => {
    const traces = [trace()];
    const analytics = computeCorrelationAnalytics(traces);
    const report = buildSynthesisReport(traces, analytics);
    const text = renderSynthesisReportText(report);
    assert.equal(text.includes("increase threshold"), false);
    assert.equal(text.includes("should change"), false);
    assert.equal(text.includes("must adopt"), false);
  });

  it("report JSON output is parseable", () => {
    const analytics = computeCorrelationAnalytics([]);
    const report = buildSynthesisReport([], analytics);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.ok(parsed.readOnly);
  });
});
