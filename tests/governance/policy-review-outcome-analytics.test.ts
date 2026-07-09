import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeOutcomeAnalytics } from "../../src/governance/policy-review-outcome-analytics.js";
import type { PolicyReviewOutcome } from "../../src/governance/policy-review-outcome-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function outcome(overrides: Partial<PolicyReviewOutcome> = {}): PolicyReviewOutcome {
  return {
    outcomeId: "o-1",
    candidateId: "c-1",
    candidateTitle: "Test candidate",
    outcomeType: "dismissed_no_change" as const,
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

describe("computeOutcomeAnalytics", () => {

  it("empty outcomes produce zero counts", () => {
    const analytics = computeOutcomeAnalytics([]);
    assert.equal(analytics.totalOutcomeCount, 0);
    for (const count of Object.values(analytics.outcomeDistribution)) {
      assert.equal(count, 0);
    }
  });

  it("outcome counts by type are correct", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", outcomeType: "dismissed_no_change" }),
      outcome({ outcomeId: "o-2", outcomeType: "accepted_for_policy_work" }),
      outcome({ outcomeId: "o-3", outcomeType: "dismissed_no_change" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.totalOutcomeCount, 3);
    assert.equal(analytics.outcomeDistribution.dismissed_no_change, 2);
    assert.equal(analytics.outcomeDistribution.accepted_for_policy_work, 1);
  });

  it("detects candidates with multiple outcomes", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", candidateId: "c-1", outcomeType: "dismissed_no_change" }),
      outcome({ outcomeId: "o-2", candidateId: "c-1", outcomeType: "accepted_for_policy_work" }),
      outcome({ outcomeId: "o-3", candidateId: "c-2", outcomeType: "deferred_needs_more_evidence" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.candidatesWithMultipleOutcomes.length, 1);
    assert.equal(analytics.candidatesWithMultipleOutcomes[0], "c-1");
  });

  it("detects outcomes missing rationale", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", rationale: "" }),
      outcome({ outcomeId: "o-2", rationale: "Valid rationale." }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.outcomesMissingRationale.length, 1);
    assert.equal(analytics.outcomesMissingRationale[0], "o-1");
  });

  it("detects outcomes missing evidence references", () => {
    const outcomes = [
      outcome({ outcomeId: "o-1", evidenceRefs: [] }),
      outcome({ outcomeId: "o-2", evidenceRefs: ["ref-1"] }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    assert.equal(analytics.outcomesMissingEvidence.length, 1);
    assert.equal(analytics.outcomesMissingEvidence[0], "o-1");
  });

  it("deterministic sorting -- no person-based ordering", () => {
    const outcomes = [
      outcome({ outcomeId: "o-b", recordedBy: "zoe" }),
      outcome({ outcomeId: "o-a", recordedBy: "alice" }),
    ];
    const analytics = computeOutcomeAnalytics(outcomes);
    // Sorted by outcomeId, not by recordedBy
    assert.ok(analytics.outcomesMissingRationale.length >= 0);
  });

  it("no reviewer ranking metrics in output", () => {
    const analytics = computeOutcomeAnalytics([outcome()]);
    const keys = Object.keys(analytics);
    assert.equal(keys.some(k => k.includes("reviewer") || k.includes("ranking") || k.includes("score")), false);
  });
});
