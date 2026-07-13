/**
 * Tests A3 — Governance Decision Contract.
 *
 * @module decision-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_GOVERNANCE_DECISION_KINDS,
  DEFAULT_GOVERNANCE_POLICY,
  isValidGovernanceDecisionKind,
  validateGovernanceDecision,
  validateGovernancePolicyConfig,
} from "../../../src/evolution/governance/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validDecision(overrides: Record<string, unknown> = {}) {
  return {
    decisionId: "govd-001",
    proposalId: "prop-001",
    evolutionId: "evol-001",
    kind: "APPROVE",
    confidence: 0.9,
    reasoning: "All verification checks passed with high confidence.",
    risks: ["low risk of minor perf regression"],
    evidenceId: "ev-001",
    recommendationAvailable: true,
    followedRecommendation: true,
    policySnapshot: DEFAULT_GOVERNANCE_POLICY,
    targetState: "APPROVED",
    decidedAt: "2026-07-12T10:00:00.000Z",
    decidedBy: "governance_policy",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GovernanceDecisionKind
// ---------------------------------------------------------------------------

describe("GovernanceDecisionKind", () => {
  it("has exactly 4 decision kinds (fewer than A2.5's 5 recommendation kinds)", () => {
    assert.strictEqual(VALID_GOVERNANCE_DECISION_KINDS.length, 4);
  });

  it("includes APPROVE", () => {
    assert.ok(VALID_GOVERNANCE_DECISION_KINDS.includes("APPROVE"));
  });

  it("includes REJECT", () => {
    assert.ok(VALID_GOVERNANCE_DECISION_KINDS.includes("REJECT"));
  });

  it("includes MONITOR", () => {
    assert.ok(VALID_GOVERNANCE_DECISION_KINDS.includes("MONITOR"));
  });

  it("includes REQUEST_MORE_EVIDENCE (not REQUEST_ADDITIONAL_EVIDENCE, unlike A2.5)", () => {
    assert.ok(
      VALID_GOVERNANCE_DECISION_KINDS.includes("REQUEST_MORE_EVIDENCE"),
    );
  });

  it("does NOT include ESCALATE (A3 uses decision paths, not ESCALATE as a kind)", () => {
    assert.ok(
      !VALID_GOVERNANCE_DECISION_KINDS.includes(
        ("ESCALATE" as unknown) as "APPROVE",
      ),
    );
  });
});

describe("isValidGovernanceDecisionKind", () => {
  it("returns true for APPROVE", () => {
    assert.ok(isValidGovernanceDecisionKind("APPROVE"));
  });

  it("returns true for REQUEST_MORE_EVIDENCE", () => {
    assert.ok(isValidGovernanceDecisionKind("REQUEST_MORE_EVIDENCE"));
  });

  it("returns false for an invalid kind", () => {
    assert.equal(isValidGovernanceDecisionKind("MAYBE"), false);
  });

  it("returns false for empty string", () => {
    assert.equal(isValidGovernanceDecisionKind(""), false);
  });

  it("returns false for ESCALATE (A2.5 concept, not A3)", () => {
    assert.equal(isValidGovernanceDecisionKind("ESCALATE"), false);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_GOVERNANCE_POLICY
// ---------------------------------------------------------------------------

describe("DEFAULT_GOVERNANCE_POLICY", () => {
  it("has conservative defaults", () => {
    assert.equal(DEFAULT_GOVERNANCE_POLICY.policyName, "default");
    assert.equal(DEFAULT_GOVERNANCE_POLICY.minApproveConfidence, 0.8);
    assert.equal(DEFAULT_GOVERNANCE_POLICY.minMonitorConfidence, 0.5);
    assert.equal(DEFAULT_GOVERNANCE_POLICY.rejectConfidenceThreshold, 0.3);
    assert.equal(DEFAULT_GOVERNANCE_POLICY.maxAllowedRegressions, 0);
    assert.equal(
      DEFAULT_GOVERNANCE_POLICY.escalateBehavior,
      "request_evidence",
    );
    assert.equal(DEFAULT_GOVERNANCE_POLICY.failClosedOnExpiredEvidence, true);
    assert.equal(DEFAULT_GOVERNANCE_POLICY.minReproducibilityLevel, 2);
  });

  it("has ordered thresholds: reject < monitor < approve", () => {
    assert.ok(
      DEFAULT_GOVERNANCE_POLICY.rejectConfidenceThreshold <
        DEFAULT_GOVERNANCE_POLICY.minMonitorConfidence,
    );
    assert.ok(
      DEFAULT_GOVERNANCE_POLICY.minMonitorConfidence <
        DEFAULT_GOVERNANCE_POLICY.minApproveConfidence,
    );
  });

  it("validates successfully against validateGovernancePolicyConfig", () => {
    const result = validateGovernancePolicyConfig(DEFAULT_GOVERNANCE_POLICY);
    assert.ok(
      result.valid,
      `DEFAULT_GOVERNANCE_POLICY should be valid: ${result.errors.join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// validateGovernancePolicyConfig
// ---------------------------------------------------------------------------

describe("validateGovernancePolicyConfig", () => {
  it("accepts a fully specified config", () => {
    const result = validateGovernancePolicyConfig(DEFAULT_GOVERNANCE_POLICY);
    assert.ok(result.valid);
  });

  it("rejects null input", () => {
    assert.equal(validateGovernancePolicyConfig(null).valid, false);
  });

  it("rejects missing policyName", () => {
    const result = validateGovernancePolicyConfig({
      ...DEFAULT_GOVERNANCE_POLICY,
      policyName: "",
    });
    assert.equal(result.valid, false);
  });

  it("rejects invalid minApproveConfidence", () => {
    const result = validateGovernancePolicyConfig({
      ...DEFAULT_GOVERNANCE_POLICY,
      minApproveConfidence: 1.5,
    });
    assert.equal(result.valid, false);
  });

  it("rejects invalid escalateBehavior", () => {
    const result = validateGovernancePolicyConfig({
      ...DEFAULT_GOVERNANCE_POLICY,
      escalateBehavior: "unknown",
    });
    assert.equal(result.valid, false);
  });

  it("rejects negative maxAllowedRegressions", () => {
    const result = validateGovernancePolicyConfig({
      ...DEFAULT_GOVERNANCE_POLICY,
      maxAllowedRegressions: -1,
    });
    assert.equal(result.valid, false);
  });

  it("rejects non-boolean failClosedOnExpiredEvidence", () => {
    const result = validateGovernancePolicyConfig({
      ...DEFAULT_GOVERNANCE_POLICY,
      failClosedOnExpiredEvidence: "yes",
    });
    assert.equal(result.valid, false);
  });
});

// ---------------------------------------------------------------------------
// validateGovernanceDecision
// ---------------------------------------------------------------------------

describe("validateGovernanceDecision", () => {
  it("accepts a valid decision", () => {
    const result = validateGovernanceDecision(validDecision());
    assert.ok(
      result.valid,
      `expected valid, got: ${result.errors.join(", ")}`,
    );
  });

  it("accepts a valid REJECT decision", () => {
    const result = validateGovernanceDecision(
      validDecision({ kind: "REJECT", targetState: "REJECTED" }),
    );
    assert.ok(result.valid);
  });

  it("accepts a valid MONITOR decision", () => {
    const result = validateGovernanceDecision(
      validDecision({
        kind: "MONITOR",
        targetState: "UNDER_REVIEW",
      }),
    );
    assert.ok(result.valid);
  });

  it("accepts a valid REQUEST_MORE_EVIDENCE decision", () => {
    const result = validateGovernanceDecision(
      validDecision({
        kind: "REQUEST_MORE_EVIDENCE",
        targetState: "UNDER_REVIEW",
      }),
    );
    assert.ok(result.valid);
  });

  it("accepts a decision with optional fields (recommendationId, overrideReason)", () => {
    const result = validateGovernanceDecision(
      validDecision({
        recommendationId: "rec-001",
        overrideReason: "Operator judgment overrides borderline recommendation",
      }),
    );
    assert.ok(result.valid);
  });

  it("rejects null input", () => {
    assert.equal(validateGovernanceDecision(null).valid, false);
  });

  it("rejects missing decisionId", () => {
    const result = validateGovernanceDecision(
      validDecision({ decisionId: "" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects missing proposalId", () => {
    const result = validateGovernanceDecision(
      validDecision({ proposalId: "" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects missing evolutionId", () => {
    const result = validateGovernanceDecision(
      validDecision({ evolutionId: "" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects invalid kind", () => {
    const result = validateGovernanceDecision(
      validDecision({ kind: "MAYBE" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects invalid confidence range (above 1)", () => {
    const result = validateGovernanceDecision(
      validDecision({ confidence: 1.5 }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects invalid confidence range (negative)", () => {
    const result = validateGovernanceDecision(
      validDecision({ confidence: -0.1 }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects NaN confidence", () => {
    const result = validateGovernanceDecision(
      validDecision({ confidence: NaN }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects missing reasoning", () => {
    const result = validateGovernanceDecision(
      validDecision({ reasoning: "" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects missing risks array", () => {
    const result = validateGovernanceDecision(
      validDecision({ risks: "not-an-array" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects missing evidenceId", () => {
    const result = validateGovernanceDecision(
      validDecision({ evidenceId: "" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects invalid targetState", () => {
    const result = validateGovernanceDecision(
      validDecision({ targetState: "PENDING" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects invalid decidedBy", () => {
    const result = validateGovernanceDecision(
      validDecision({ decidedBy: "system" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects missing decidedAt", () => {
    const result = validateGovernanceDecision(
      validDecision({ decidedAt: "" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects missing policySnapshot", () => {
    const result = validateGovernanceDecision(
      validDecision({ policySnapshot: null }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects policySnapshot with invalid policyName", () => {
    const result = validateGovernanceDecision(
      validDecision({
        policySnapshot: { ...DEFAULT_GOVERNANCE_POLICY, policyName: "" },
      }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects non-boolean recommendationAvailable", () => {
    const result = validateGovernanceDecision(
      validDecision({ recommendationAvailable: "yes" }),
    );
    assert.equal(result.valid, false);
  });

  it("rejects non-boolean followedRecommendation", () => {
    const result = validateGovernanceDecision(
      validDecision({ followedRecommendation: "yes" }),
    );
    assert.equal(result.valid, false);
  });
});
