/**
 * P6.0b — RiskScoreBuilder test suite.
 *
 * Tests pure scoring functions and the builder's deterministic behavior.
 */
import { describe, it, expect } from "vitest";
import {
  scoreGovernance,
  scoreOperational,
  scoreCapability,
  scoreRevertability,
  scoreEvidenceQuality,
  RiskScoreBuilder,
} from "../../src/adaptation/risk-score-builder";
import type { DecisionContext } from "../../src/adaptation/decision-types";

function createContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    // DecisionArtifact fields
    id: "decision-ctx-test",
    subject: "Test context",
    outcome: "complete_context",
    confidence: 0.85,
    reasons: [],
    evidenceRefs: ["fp-1"],
    generatedAt: new Date().toISOString(),
    // Context-specific
    contextStatus: "complete_context",
    proposalId: "prop-test-001",
    proposalStatus: "applied",
    proposalAction: "update_agent_card",
    createdAt: new Date().toISOString(),
    ageDays: 2,
    lineage: undefined,
    lineageCompleteness: "complete",
    similarProposals: [],
    effectivenessTrend: { actionType: "update_agent_card", keepRate: 0.8, revertRate: 0.1, sampleSize: 10 },
    sourceArtifacts: [{ type: "proposal", id: "ctx-1" }],
    dataFreshness: { newestArtifactAgeDays: 1, oldestArtifactAgeDays: 2 },
    ...overrides,
  };
}

describe("RiskScoreBuilder — pure scoring functions", () => {
  it("scoreGovernance: broken lineage increases risk", () => {
    const ctx = createContext({ lineageCompleteness: "broken" });
    expect(scoreGovernance(ctx)).toBeGreaterThan(0);
  });

  it("scoreGovernance: insufficient_data increases risk", () => {
    const ctx = createContext({ contextStatus: "insufficient_data", lineageCompleteness: "broken" });
    expect(scoreGovernance(ctx)).toBeGreaterThanOrEqual(0.5);
  });

  it("scoreOperational: failed status increases risk", () => {
    const ctx = createContext({ proposalStatus: "failed" });
    expect(scoreOperational(ctx)).toBeGreaterThan(0);
  });

  it("scoreCapability: no effectiveness data increases risk", () => {
    const ctx = createContext({
      effectivenessTrend: { actionType: "unknown", keepRate: 0, revertRate: 0, sampleSize: 0 },
    });
    expect(scoreCapability(ctx)).toBeGreaterThanOrEqual(0.3);
  });

  it("scoreRevertability: rejected proposals are low risk", () => {
    const ctx = createContext({ proposalStatus: "rejected" });
    expect(scoreRevertability(ctx)).toBeLessThanOrEqual(0.2);
  });

  it("scoreRevertability: pending proposals have moderate revertability risk", () => {
    const ctx = createContext({ proposalStatus: "pending" });
    expect(scoreRevertability(ctx)).toBeGreaterThanOrEqual(0.4);
  });

  it("scoreEvidenceQuality: no evidence refs increases risk", () => {
    const ctx = createContext({ evidenceRefs: [] });
    expect(scoreEvidenceQuality(ctx)).toBeGreaterThan(0);
  });

  it("overall risk is average of dimensions", () => {
    const builder = new RiskScoreBuilder();
    const ctx = createContext();
    const score = builder.build(ctx);
    const avg =
      (score.dimensions.governance +
        score.dimensions.operational +
        score.dimensions.capability +
        score.dimensions.revertability +
        score.dimensions.evidence_quality) / 5;
    expect(score.overallRisk).toBeCloseTo(Math.round(avg * 100) / 100, 2);
  });
});

describe("RiskScoreBuilder — determinism", () => {
  it("produces identical risk scores for the same DecisionContext", () => {
    const builder = new RiskScoreBuilder();
    const ctx = createContext();
    const frozenTime = "2026-06-20T12:00:00.000Z";
    const score1 = builder.build(ctx, frozenTime);
    const score2 = builder.build(ctx, frozenTime);
    expect(score1).toEqual(score2);
  });
});

describe("RiskScore — DecisionArtifact compatibility", () => {
  it("has outcome, reasons, warnings, evidenceRefs, generatedAt", () => {
    const builder = new RiskScoreBuilder();
    const ctx = createContext();
    const score = builder.build(ctx);
    expect(score.outcome).toBeDefined();
    expect(Array.isArray(score.reasons)).toBe(true);
    expect(Array.isArray(score.evidenceRefs)).toBe(true);
    expect(score.generatedAt).toBeDefined();
    expect(score.sourceArtifacts).toBeDefined();
    expect(score.sourceArtifacts.length).toBeGreaterThan(0);
  });
});
