import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOutcomeReport, renderOutcomeReportText } from "../../src/governance/policy-review-outcome-report.js";
import { computeOutcomeAnalytics } from "../../src/governance/policy-review-outcome-analytics.js";
import type { PolicyReviewOutcome } from "../../src/governance/policy-review-outcome-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function outcome(overrides: Partial<PolicyReviewOutcome> = {}): PolicyReviewOutcome {
  return {
    outcomeId: "o-1",
    candidateId: "c-1",
    candidateTitle: "Test candidate",
    outcomeType: "dismissed_no_change",
    recordedAt: ISO,
    recordedBy: "human-1",
    rationale: "No evidence of drift.",
    evidenceRefs: ["ref-1"],
    candidateStateAtRecording: "dismissed",
    linkedEventIds: [],
    notes: "",
    createdAt: ISO,
    ...overrides,
  };
}

describe("buildOutcomeReport", () => {

  it("empty outcomes produce clean report", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    assert.equal(report.totalOutcomeCount, 0);
    assert.equal(report.candidatesWithoutOutcomes, 0);
  });

  it("report shows outcome distribution", () => {
    const outcomes = [
      outcome({ outcomeType: "dismissed_no_change" }),
      outcome({ outcomeId: "o-2", outcomeType: "accepted_for_policy_work" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    const report = buildOutcomeReport(outcomes, analytics);
    assert.equal(report.totalOutcomeCount, 2);
    assert.equal(report.outcomeDistribution.dismissed_no_change, 1);
    assert.equal(report.outcomeDistribution.accepted_for_policy_work, 1);
  });

  it("report includes boundary footer", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const text = renderOutcomeReportText(report);
    assert.ok(text.includes("does not apply policy changes"));
    assert.ok(text.includes("does not generate patches"));
    assert.ok(text.includes("does not change thresholds"));
    assert.ok(text.includes("does not rank reviewers"));
    assert.ok(text.includes("does not auto-adopt outcomes"));
    assert.ok(text.includes("does not auto-close candidates"));
  });

  it("JSON output is parseable", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.ok(parsed.totalOutcomeCount !== undefined);
  });
});

// ---- Hard Negative Tests ----

describe("Hard Negative — prohibited behaviors absent", () => {

  it("no policy patch generation paths exist", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report);
    // The output should not contain policy patch content
    assert.equal(json.includes("policyPatch"), false);
    assert.equal(json.includes("patch_generated"), false);
  });

  it("no reviewer ranking logic in analytics", () => {
    const analytics = computeOutcomeAnalytics([outcome()]);
    const keys = Object.keys(analytics);
    assert.equal(keys.some(k => k.includes("reviewerScore") || k.includes("ranking") || k.includes("leaderboard")), false);
  });

  it("no candidate auto-close paths in report", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report);
    assert.equal(json.includes("autoClosed"), false);
    assert.equal(json.includes("auto_close"), false);
  });

  it("no outcome auto-adoption paths", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const json = JSON.stringify(report);
    assert.equal(json.includes("autoAdopted"), false);
    assert.equal(json.includes("auto_adopt"), false);
  });

  it("no lifecycle transition bypass", () => {
    const analytics = computeOutcomeAnalytics([]);
    const report = buildOutcomeReport([], analytics);
    const text = renderOutcomeReportText(report);
    assert.equal(text.includes("transitionCandidate"), false);
    assert.equal(text.includes("closeCandidate"), false);
  });
});
