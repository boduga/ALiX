// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCapabilityEvidence,
  buildCapabilityRecommendation,
  runCapabilityGovernance,
} from "../../../src/evolution/capability-lifecycle/capability-governance-bridge.js";
import type { CapabilityLifecycleCandidate } from "../../../src/evolution/capability-lifecycle/contracts/lifecycle-contract.js";

function makeCandidate(): CapabilityLifecycleCandidate {
  return {
    intent: "deprecate",
    target: { capabilityId: "core.old" },
    confidence: 0.8,
    rationale: ["no recent use"],
    evidenceRefs: ["ev-1"],
    observedLifecycleState: "stagnant",
    proposedLifecycleState: "deprecated",
  };
}

describe("capability governance bridge", () => {
  it("builds projected verification evidence with a deterministic id", () => {
    const evidence = buildCapabilityEvidence(makeCandidate(), "prop-a7-x");
    assert.equal(evidence.evidenceClass, "projected");
    assert.ok(evidence.evidenceId.startsWith("a7-ev-"));
    assert.equal(evidence.confidenceProfile.overallConfidence, 0.8);
    assert.equal(evidence.confidenceProfile.historicalSimilarity, 1);
    // Confidence-formula invariant: min(a,a,a) * historicalSimilarity === overall.
    const { replayFidelity, coverage, determinism, historicalSimilarity } = evidence.confidenceProfile;
    assert.equal(Math.min(replayFidelity, coverage, determinism) * historicalSimilarity, evidence.confidenceProfile.overallConfidence);
  });

  it("builds an A2.5 APPROVE recommendation referencing the same evidence", () => {
    const candidate = makeCandidate();
    const evidence = buildCapabilityEvidence(candidate, "prop-a7-x");
    const recommendation = buildCapabilityRecommendation(candidate, "prop-a7-x", evidence);
    assert.equal(recommendation.kind, "APPROVE");
    assert.equal(recommendation.evidenceId, evidence.evidenceId);
    assert.equal(recommendation.proposalId, "prop-a7-x");
  });

  it("runs A3 and returns an APPROVE decision for high-confidence evidence", () => {
    const candidate = makeCandidate(); // confidence 0.8 = minApproveConfidence
    const outcome = runCapabilityGovernance(candidate, "prop-a7-x");
    assert.equal(outcome.decision.kind, "APPROVE");
    assert.equal(outcome.decision.proposalId, "prop-a7-x");
  });

  it("returns a REJECT decision for low-confidence evidence", () => {
    const candidate = { ...makeCandidate(), confidence: 0.2 }; // < rejectConfidenceThreshold 0.3
    const outcome = runCapabilityGovernance(candidate, "prop-a7-x");
    assert.equal(outcome.decision.kind, "REJECT");
  });
});
