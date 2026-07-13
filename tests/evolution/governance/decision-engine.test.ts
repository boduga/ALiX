/**
 * Tests A3 — Governance Decision Engine.
 *
 * @module decision-engine
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateDecision,
  decisionKindToTargetState,
} from "../../../src/evolution/governance/index.js";
import { createVerificationEvidence } from "../../../src/evolution/verification/index.js";
import type {
  VerificationEvidenceInput,
  ConfidenceProfile,
} from "../../../src/evolution/verification/index.js";
import type { GovernanceRecommendation } from "../../../src/evolution/verification/contracts/recommendation-contract.js";
import type {
  GovernanceDecisionKind,
  GovernancePolicyConfig,
} from "../../../src/evolution/governance/contracts/decision-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overall: number): ConfidenceProfile {
  return {
    replayFidelity: 0.95,
    coverage: 0.90,
    determinism: 1.0,
    historicalSimilarity: 0.90,
    overallConfidence: overall,
  };
}

function makeEvidence(
  overallConfidence: number,
  behavioralChanges: string[] = [],
  overrides: Partial<VerificationEvidenceInput> = {},
): ReturnType<typeof createVerificationEvidence> {
  return createVerificationEvidence({
    verificationId: "ver-run-001",
    proposalId: "prop-001",
    replayDatasetId: "ds-001",
    proposalSnapshotHash: "hash-prop",
    environmentHash: "hash-env",
    baselineMetrics: { m: 1 },
    candidateMetrics: { m: 2 },
    metricDeltas: { m: 1 },
    behavioralChanges,
    confidenceProfile: makeProfile(overallConfidence),
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: "2026-07-12T10:00:00.000Z",
    expiresAt: "2099-12-31T00:00:00.000Z",
    ...overrides,
  });
}

function makeRecommendation(
  kind: GovernanceRecommendation["kind"],
  overrides: Partial<GovernanceRecommendation> = {},
): GovernanceRecommendation {
  return {
    recommendationId: "rec-ev-test-001",
    evidenceId: "ev-test-001",
    proposalId: "prop-001",
    kind,
    confidence: 0.85,
    reasoning: "Recommendation from A2.5",
    supportingEvidence: ["ev-test-001"],
    risks: ["test risk"],
    createdAt: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
}

/**
 * Strip timestamp-varying fields from a decision for deterministic comparison.
 * Excludes decidedAt which uses Date.now() by design.
 */
function stripNonDeterministic(
  decision: Record<string, unknown>,
): Record<string, unknown> {
  const { decidedAt: _ts, ...rest } = decision;
  void _ts;
  return rest;
}

// ---------------------------------------------------------------------------
// decisionKindToTargetState
// ---------------------------------------------------------------------------

describe("decisionKindToTargetState", () => {
  it("maps APPROVE → APPROVED", () => {
    assert.strictEqual(decisionKindToTargetState("APPROVE"), "APPROVED");
  });

  it("maps REJECT → REJECTED", () => {
    assert.strictEqual(decisionKindToTargetState("REJECT"), "REJECTED");
  });

  it("maps MONITOR → UNDER_REVIEW", () => {
    assert.strictEqual(decisionKindToTargetState("MONITOR"), "UNDER_REVIEW");
  });

  it("maps REQUEST_MORE_EVIDENCE → UNDER_REVIEW", () => {
    assert.strictEqual(
      decisionKindToTargetState("REQUEST_MORE_EVIDENCE"),
      "UNDER_REVIEW",
    );
  });
});

// ---------------------------------------------------------------------------
// FRESHNESS
// ---------------------------------------------------------------------------

describe("FRESHNESS", () => {
  it("expired evidence + fail-closed → REJECT (risks populated)", () => {
    const evidence = makeEvidence(0.9, [], {
      expiresAt: "2020-01-01T00:00:00.000Z", // expired
    });
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "REJECT");
    assert.ok(decision.decisionId.startsWith("govd-"));
    assert.ok(decision.risks.length > 0);
    assert.ok(decision.risks.includes("Evidence has expired"));
    assert.strictEqual(decision.targetState, "REJECTED");
    assert.strictEqual(decision.decidedBy, "governance_policy");
  });

  it("expired evidence + non-fail-closed → MONITOR", () => {
    const evidence = makeEvidence(0.9, [], {
      expiresAt: "2020-01-01T00:00:00.000Z", // expired
    });
    const policy: GovernancePolicyConfig = {
      policyName: "non-fail-closed",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: false,
      minReproducibilityLevel: 2,
    };
    const decision = generateDecision(evidence, undefined, {
      policyConfig: policy,
    });

    assert.strictEqual(decision.kind, "MONITOR");
    assert.strictEqual(decision.targetState, "UNDER_REVIEW");
    assert.ok(decision.risks.includes("Evidence has expired"));
    assert.strictEqual(decision.decidedBy, "governance_policy");
  });

  it("fresh evidence → proceeds to confidence checks", () => {
    // High confidence, no regressions → should APPROVE, not hit expiry path
    const evidence = makeEvidence(0.9, []);
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "APPROVE");
    assert.strictEqual(decision.targetState, "APPROVED");
    // No expired-evidence risk
    assert.ok(!decision.risks.includes("Evidence has expired"));
  });
});

// ---------------------------------------------------------------------------
// CONFIDENCE
// ---------------------------------------------------------------------------

describe("CONFIDENCE", () => {
  it("confidence >= minApproveConfidence + no regressions → APPROVE", () => {
    const evidence = makeEvidence(0.9, []);
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "APPROVE");
    assert.strictEqual(decision.targetState, "APPROVED");
    assert.strictEqual(decision.confidence, 0.9);
    assert.strictEqual(decision.decidedBy, "governance_policy");
  });

  it("confidence >= minMonitorConfidence + regressions → MONITOR", () => {
    const evidence = makeEvidence(0.6, [
      "Metric m1 regression: 1.5 -> 2.0 (delta +0.5)",
    ]);
    // Use maxAllowedRegressions=1 so the single regression passes
    // the regression check and reaches the monitor confidence check
    const policy: GovernancePolicyConfig = {
      policyName: "monitor-with-regressions",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 1,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    };
    const decision = generateDecision(evidence, undefined, {
      policyConfig: policy,
    });

    assert.strictEqual(decision.kind, "MONITOR");
    assert.strictEqual(decision.targetState, "UNDER_REVIEW");
    assert.ok(decision.reasoning.includes("regression"));
    assert.strictEqual(decision.decidedBy, "governance_policy");
  });

  it("confidence < rejectConfidenceThreshold → REJECT", () => {
    const evidence = makeEvidence(0.2, []);
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "REJECT");
    assert.strictEqual(decision.targetState, "REJECTED");
    assert.strictEqual(decision.decidedBy, "governance_policy");
  });
});

// ---------------------------------------------------------------------------
// REGRESSIONS
// ---------------------------------------------------------------------------

describe("REGRESSIONS", () => {
  it("maxAllowedRegressions=0 + 1 regression → REJECT", () => {
    const evidence = makeEvidence(0.9, [
      "Metric m1 regression: 1.5 -> 2.0 (delta +0.5)",
    ]);
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "REJECT");
    assert.strictEqual(decision.targetState, "REJECTED");
    assert.ok(decision.reasoning.includes("exceeding max allowed"));
  });

  it("maxAllowedRegressions=1 + 1 regression → APPROVE if other checks pass", () => {
    const evidence = makeEvidence(0.9, [
      "Metric m1 regression: 1.5 -> 2.0 (delta +0.5)",
    ]);
    const policy: GovernancePolicyConfig = {
      policyName: "looser-regressions",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 1,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    };
    const decision = generateDecision(evidence, undefined, {
      policyConfig: policy,
    });

    assert.strictEqual(decision.kind, "APPROVE");
    assert.strictEqual(decision.targetState, "APPROVED");
  });
});

// ---------------------------------------------------------------------------
// REPRODUCIBILITY
// ---------------------------------------------------------------------------

describe("REPRODUCIBILITY", () => {
  it("reproducibilityLevel < minReproducibilityLevel → REQUEST_MORE_EVIDENCE", () => {
    const evidence = makeEvidence(0.9, [], {
      reproducibilityLevel: 1,
    });
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.kind, "REQUEST_MORE_EVIDENCE");
    assert.strictEqual(decision.targetState, "UNDER_REVIEW");
    assert.ok(decision.reasoning.includes("Reproducibility level"));
    assert.strictEqual(decision.decidedBy, "governance_policy");
  });
});

// ---------------------------------------------------------------------------
// RECOMMENDATION TRACKING
// ---------------------------------------------------------------------------

describe("RECOMMENDATION", () => {
  it("A2.5 APPROVE + A3 APPROVE → followedRecommendation=true", () => {
    const evidence = makeEvidence(0.9, []);
    const recommendation = makeRecommendation("APPROVE", {
      evidenceId: evidence.evidenceId,
    });
    const decision = generateDecision(evidence, recommendation);

    assert.strictEqual(decision.kind, "APPROVE");
    assert.strictEqual(decision.recommendationAvailable, true);
    assert.strictEqual(
      decision.recommendationId,
      recommendation.recommendationId,
    );
    assert.strictEqual(decision.followedRecommendation, true);
    assert.strictEqual(decision.overrideReason, undefined);
  });

  it("A2.5 APPROVE + A3 REJECT → followedRecommendation=false + overrideReason", () => {
    const evidence = makeEvidence(0.2, []); // low confidence → REJECT
    const recommendation = makeRecommendation("APPROVE", {
      evidenceId: evidence.evidenceId,
    });
    const decision = generateDecision(evidence, recommendation);

    assert.strictEqual(decision.kind, "REJECT");
    assert.strictEqual(decision.recommendationAvailable, true);
    assert.strictEqual(decision.followedRecommendation, false);
    assert.ok(decision.overrideReason);
    assert.ok(
      decision.overrideReason?.includes("REJECT") &&
        decision.overrideReason?.includes("APPROVE"),
    );
  });

  it("A2.5 ESCALATE + escalateBehavior=reject → REJECT", () => {
    const evidence = makeEvidence(0.6, []); // would normally be MONITOR
    const recommendation = makeRecommendation("ESCALATE", {
      evidenceId: evidence.evidenceId,
    });
    const policy: GovernancePolicyConfig = {
      policyName: "escalate-reject",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "reject",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    };
    const decision = generateDecision(evidence, recommendation, {
      policyConfig: policy,
    });

    assert.strictEqual(decision.kind, "REJECT");
    assert.strictEqual(decision.targetState, "REJECTED");
    assert.strictEqual(decision.decidedBy, "auto_escalation");
  });

  it("A2.5 ESCALATE + escalateBehavior=request_evidence → REQUEST_MORE_EVIDENCE", () => {
    const evidence = makeEvidence(0.6, []); // would normally be MONITOR
    const recommendation = makeRecommendation("ESCALATE", {
      evidenceId: evidence.evidenceId,
    });
    const policy: GovernancePolicyConfig = {
      policyName: "escalate-request",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 0,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    };
    const decision = generateDecision(evidence, recommendation, {
      policyConfig: policy,
    });

    assert.strictEqual(decision.kind, "REQUEST_MORE_EVIDENCE");
    assert.strictEqual(decision.targetState, "UNDER_REVIEW");
    assert.strictEqual(decision.decidedBy, "auto_escalation");
  });

  it("no recommendation → recommendationAvailable=false", () => {
    const evidence = makeEvidence(0.9, []);
    const decision = generateDecision(evidence);

    assert.strictEqual(decision.recommendationAvailable, false);
    assert.strictEqual(decision.followedRecommendation, false);
    assert.strictEqual(decision.recommendationId, undefined);
  });
});

// ---------------------------------------------------------------------------
// DETERMINISM
// ---------------------------------------------------------------------------

describe("DETERMINISM", () => {
  it("same inputs → deterministic decision (excluding timestamp)", () => {
    const evidence = makeEvidence(0.9, []);
    const recommendation = makeRecommendation("APPROVE");

    const a = generateDecision(evidence, recommendation);
    const b = generateDecision(evidence, recommendation);

    // Strip non-deterministic `decidedAt` (uses Date.now() by design)
    const strippedA = stripNonDeterministic(a as unknown as Record<string, unknown>);
    const strippedB = stripNonDeterministic(b as unknown as Record<string, unknown>);
    assert.deepStrictEqual(strippedA, strippedB);
  });

  it("same inputs + same config → deterministic decision", () => {
    const evidence = makeEvidence(0.6, [
      "Metric m1 regression: 1.5 -> 2.0 (delta +0.5)",
    ]);
    const policy: GovernancePolicyConfig = {
      policyName: "custom",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 1,
      escalateBehavior: "reject",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    };

    const a = generateDecision(evidence, undefined, { policyConfig: policy });
    const b = generateDecision(evidence, undefined, { policyConfig: policy });

    const strippedA = stripNonDeterministic(a as unknown as Record<string, unknown>);
    const strippedB = stripNonDeterministic(b as unknown as Record<string, unknown>);
    assert.deepStrictEqual(strippedA, strippedB);
  });
});

// ---------------------------------------------------------------------------
// STATE MAPPING (via decision output)
// ---------------------------------------------------------------------------

describe("STATE MAPPING", () => {
  it("APPROVE → APPROVED", () => {
    const evidence = makeEvidence(0.9, []);
    const d = generateDecision(evidence);
    assert.strictEqual(d.kind, "APPROVE");
    assert.strictEqual(d.targetState, "APPROVED");
  });

  it("REJECT → REJECTED", () => {
    const evidence = makeEvidence(0.2, []);
    const d = generateDecision(evidence);
    assert.strictEqual(d.kind, "REJECT");
    assert.strictEqual(d.targetState, "REJECTED");
  });

  it("MONITOR → UNDER_REVIEW", () => {
    const evidence = makeEvidence(0.6, [
      "Metric m1 regression: 1.5 -> 2.0 (delta +0.5)",
    ]);
    const policy: GovernancePolicyConfig = {
      policyName: "state-map-monitor",
      minApproveConfidence: 0.8,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.3,
      maxAllowedRegressions: 1,
      escalateBehavior: "request_evidence",
      failClosedOnExpiredEvidence: true,
      minReproducibilityLevel: 2,
    };
    const d = generateDecision(evidence, undefined, { policyConfig: policy });
    assert.strictEqual(d.kind, "MONITOR");
    assert.strictEqual(d.targetState, "UNDER_REVIEW");
  });

  it("REQUEST_MORE_EVIDENCE → UNDER_REVIEW", () => {
    const evidence = makeEvidence(0.9, [], {
      reproducibilityLevel: 1,
    });
    const d = generateDecision(evidence);
    assert.strictEqual(d.kind, "REQUEST_MORE_EVIDENCE");
    assert.strictEqual(d.targetState, "UNDER_REVIEW");
  });
});

// ---------------------------------------------------------------------------
// DECISION FIELDS
// ---------------------------------------------------------------------------

describe("DECISION FIELD INTEGRITY", () => {
  it("decisionId uses govd- prefix with evidenceId", () => {
    const evidence = makeEvidence(0.9, []);
    const d = generateDecision(evidence);
    assert.strictEqual(d.decisionId, `govd-${evidence.evidenceId}`);
  });

  it("policySnapshot captures the applied config", () => {
    const evidence = makeEvidence(0.9, []);
    const d = generateDecision(evidence);
    assert.strictEqual(d.policySnapshot.policyName, "default");
    assert.strictEqual(d.policySnapshot.minApproveConfidence, 0.8);
  });

  it("policySnapshot reflects custom config", () => {
    const evidence = makeEvidence(0.9, []);
    const policy: GovernancePolicyConfig = {
      policyName: "custom-policy",
      minApproveConfidence: 0.75,
      minMonitorConfidence: 0.5,
      rejectConfidenceThreshold: 0.25,
      maxAllowedRegressions: 2,
      escalateBehavior: "reject",
      failClosedOnExpiredEvidence: false,
      minReproducibilityLevel: 1,
    };
    const d = generateDecision(evidence, undefined, { policyConfig: policy });
    assert.strictEqual(d.policySnapshot.policyName, "custom-policy");
    assert.strictEqual(d.policySnapshot.minApproveConfidence, 0.75);
  });

  it("decidedAt is a non-empty ISO string", () => {
    const evidence = makeEvidence(0.9, []);
    const d = generateDecision(evidence);
    assert.strictEqual(typeof d.decidedAt, "string");
    assert.ok(d.decidedAt.length > 0);
    // Should be parseable as ISO 8601
    const parsed = new Date(d.decidedAt).getTime();
    assert.ok(Number.isFinite(parsed));
  });

  it("evidenceId matches source evidence", () => {
    const evidence = makeEvidence(0.9, []);
    const d = generateDecision(evidence);
    assert.strictEqual(d.evidenceId, evidence.evidenceId);
  });
});
