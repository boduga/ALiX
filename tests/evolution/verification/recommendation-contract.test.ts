/**
 * Tests A2.5 — Governance Recommendation Contract.
 *
 * @module recommendation-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GOVERNANCE_RECOMMENDATION_KINDS,
  isValidGovernanceRecommendationKind,
  validateGovernanceRecommendation,
} from "../../../src/evolution/verification/index.js";

describe("GovernanceRecommendationKind", () => {
  it("has 5 recommendation kinds", () => {
    assert.strictEqual(GOVERNANCE_RECOMMENDATION_KINDS.length, 5);
    assert.ok(GOVERNANCE_RECOMMENDATION_KINDS.includes("APPROVE"));
    assert.ok(GOVERNANCE_RECOMMENDATION_KINDS.includes("MONITOR"));
    assert.ok(GOVERNANCE_RECOMMENDATION_KINDS.includes("REQUEST_ADDITIONAL_EVIDENCE"));
    assert.ok(GOVERNANCE_RECOMMENDATION_KINDS.includes("REJECT"));
    assert.ok(GOVERNANCE_RECOMMENDATION_KINDS.includes("ESCALATE"));
  });

  it("isValidGovernanceRecommendationKind validates correctly", () => {
    assert.ok(isValidGovernanceRecommendationKind("APPROVE"));
    assert.ok(isValidGovernanceRecommendationKind("ESCALATE"));
    assert.ok(!isValidGovernanceRecommendationKind("MAYBE"));
    assert.ok(!isValidGovernanceRecommendationKind(""));
  });
});

describe("validateGovernanceRecommendation", () => {
  it("accepts a valid recommendation", () => {
    const result = validateGovernanceRecommendation({
      recommendationId: "rec-001",
      evidenceId: "ev-001",
      proposalId: "prop-001",
      kind: "APPROVE",
      confidence: 0.9,
      reasoning: "High confidence, no regressions",
      supportingEvidence: ["ev-001"],
      risks: [],
      createdAt: "2026-07-12T10:00:00.000Z",
    });
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects missing recommendationId", () => {
    const result = validateGovernanceRecommendation({
      recommendationId: "",
      evidenceId: "ev-001",
      proposalId: "prop-001",
      kind: "APPROVE",
      confidence: 0.9,
      reasoning: "x",
      supportingEvidence: [],
      risks: [],
      createdAt: "2026-07-12T10:00:00.000Z",
    });
    assert.equal(result.valid, false);
  });

  it("rejects invalid kind", () => {
    const result = validateGovernanceRecommendation({
      recommendationId: "r",
      evidenceId: "e",
      proposalId: "p",
      kind: "MAYBE",
      confidence: 0.9,
      reasoning: "x",
      supportingEvidence: [],
      risks: [],
      createdAt: "2026-07-12T10:00:00.000Z",
    });
    assert.equal(result.valid, false);
  });

  it("rejects confidence outside [0,1]", () => {
    const result = validateGovernanceRecommendation({
      recommendationId: "r",
      evidenceId: "e",
      proposalId: "p",
      kind: "APPROVE",
      confidence: 1.5,
      reasoning: "x",
      supportingEvidence: [],
      risks: [],
      createdAt: "2026-07-12T10:00:00.000Z",
    });
    assert.equal(result.valid, false);
  });

  it("rejects missing reasoning", () => {
    const result = validateGovernanceRecommendation({
      recommendationId: "r",
      evidenceId: "e",
      proposalId: "p",
      kind: "APPROVE",
      confidence: 0.9,
      reasoning: "",
      supportingEvidence: [],
      risks: [],
      createdAt: "2026-07-12T10:00:00.000Z",
    });
    assert.equal(result.valid, false);
  });

  it("rejects null input", () => {
    assert.equal(validateGovernanceRecommendation(null).valid, false);
  });
});
