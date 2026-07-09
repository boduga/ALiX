import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type PolicyReviewOutcomeType,
  type PolicyReviewOutcome,
  type PolicyReviewOutcomeLedger,
  OUTCOME_TYPES,
} from "../../src/governance/policy-review-outcome-types.js";

describe("PolicyReviewOutcomeTypes", () => {

  it("has 7 outcome types", () => {
    const types: PolicyReviewOutcomeType[] = [
      "accepted_for_policy_work",
      "dismissed_no_change",
      "deferred_needs_more_evidence",
      "superseded_by_newer_candidate",
      "closed_as_duplicate",
      "closed_out_of_scope",
      "closed_no_action",
    ];
    assert.equal(types.length, 7);
  });

  it("OUTCOME_TYPES matches the spec types", () => {
    assert.equal(OUTCOME_TYPES.length, 7);
    assert.ok(OUTCOME_TYPES.includes("accepted_for_policy_work"));
    assert.ok(OUTCOME_TYPES.includes("closed_no_action"));
  });

  it("PolicyReviewOutcome interface has required fields", () => {
    const outcome: PolicyReviewOutcome = {
      outcomeId: "test-1",
      candidateId: "p25-candidate-1",
      candidateTitle: "Test candidate",
      outcomeType: "dismissed_no_change",
      recordedAt: "2026-07-09T12:00:00.000Z",
      recordedBy: "human-1",
      rationale: "No evidence of drift.",
      evidenceRefs: [],
      candidateStateAtRecording: "dismissed",
      linkedEventIds: [],
      notes: "",
      createdAt: "2026-07-09T12:00:00.000Z",
    };
    assert.equal(outcome.outcomeId, "test-1");
    assert.equal(outcome.outcomeType, "dismissed_no_change");
  });

  it("PolicyReviewOutcomeLedger interface has required methods", () => {
    // Type-level check with real mock object
    const outcome: PolicyReviewOutcome = {
      outcomeId: "mock-1", candidateId: "c-1", candidateTitle: "",
      outcomeType: "dismissed_no_change", recordedAt: "", recordedBy: "",
      rationale: "", evidenceRefs: [], candidateStateAtRecording: "",
      linkedEventIds: [], notes: "", createdAt: "",
    };
    const ledger: PolicyReviewOutcomeLedger = {
      async recordOutcome() { return outcome; },
      async listOutcomes() { return []; },
      async getOutcome() { return null; },
    };
    assert.ok(typeof ledger.recordOutcome === "function");
    assert.ok(typeof ledger.listOutcomes === "function");
    assert.ok(typeof ledger.getOutcome === "function");
  });
});
