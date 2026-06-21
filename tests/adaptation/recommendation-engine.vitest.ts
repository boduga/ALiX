import { describe, it, expect } from "vitest";
import { RecommendationEngine, computeSignalCoherence } from "../../src/adaptation/recommendation-engine.js";
import type { DecisionContext } from "../../src/adaptation/decision-types.js";
import type { RiskScore } from "../../src/adaptation/risk-score-types.js";
import type { EnrichedWarning } from "../../src/adaptation/decision-types.js";

function createContext(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    id: "decision-ctx-test",
    subject: "Test context",
    outcome: "complete_context",
    confidence: 0.85,
    reasons: [],
    warnings: [],
    evidenceRefs: ["fp-1"],
    generatedAt: new Date().toISOString(),
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

function createRiskScore(overrides: Partial<RiskScore> = {}): RiskScore {
  return {
    id: "risk-test",
    subject: "Test risk",
    outcome: "low",
    confidence: 0.85,
    reasons: [],
    evidenceRefs: ["fp-1"],
    generatedAt: new Date().toISOString(),
    overallRisk: 0.2,
    risks: [],
    dimensions: { governance: 0.1, operational: 0.1, capability: 0.2, revertability: 0.1, evidence_quality: 0.1 },
    sourceArtifacts: [],
    ...overrides,
  };
}

describe("RecommendationEngine — rule evaluation", () => {
  it("rejects only when lineage broken + insufficient_data + critical warning", () => {
    const ctx = createContext({
      lineageCompleteness: "broken",
      contextStatus: "insufficient_data",
      warnings: [{ message: "Lineage chain severed", severity: "critical" }] as EnrichedWarning[],
    });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).toBe("reject");
  });

  it("does NOT reject when only lineage is broken (no critical warning)", () => {
    const ctx = createContext({
      lineageCompleteness: "broken",
      contextStatus: "insufficient_data",
      warnings: [{ message: "Lineage is partial", severity: "warning" }] as EnrichedWarning[],
    });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).not.toBe("reject");
  });

  it("defers for stale context", () => {
    const ctx = createContext({ contextStatus: "stale_context" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).toBe("defer");
  });

  it("defers for insufficient data", () => {
    const ctx = createContext({ contextStatus: "insufficient_data" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.recommendation).toBe("defer");
  });

  it("investigates when risk is high (overallRisk >= 0.6)", () => {
    const ctx = createContext();
    const risk = createRiskScore({ overallRisk: 0.7, outcome: "high" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("investigate");
  });

  it("investigates when strong evidence + material risk", () => {
    const ctx = createContext({ confidence: 0.9 });
    const risk = createRiskScore({ overallRisk: 0.5, outcome: "medium" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("investigate");
  });

  it("approves when context sufficient and risk low", () => {
    const ctx = createContext();
    const risk = createRiskScore({ overallRisk: 0.2, outcome: "low" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("approve");
  });
});

describe("RecommendationEngine — high risk never produces reject", () => {
  it("high risk without broken lineage/insufficient data → investigate, not reject", () => {
    const ctx = createContext({ lineageCompleteness: "complete", confidence: 0.9 });
    const risk = createRiskScore({ overallRisk: 0.9, outcome: "critical" });
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx, risk);
    expect(result.recommendation).toBe("investigate");
    expect(result.recommendation).not.toBe("reject");
  });
});

describe("computeSignalCoherence", () => {
  it("returns high coherence when all signals support approve", () => {
    const ctx = createContext({ confidence: 0.9, lineageCompleteness: "complete" });
    const risk = createRiskScore({ overallRisk: 0.15 });
    const coherence = computeSignalCoherence("approve", ctx, risk);
    expect(coherence).toBeGreaterThan(0.7);
  });

  it("returns low coherence when signals conflict", () => {
    const ctx = createContext({ confidence: 0.9, lineageCompleteness: "complete" });
    const risk = createRiskScore({ overallRisk: 0.6 });
    // High confidence + high risk should NOT support "approve"
    const coherence = computeSignalCoherence("approve", ctx, risk);
    expect(coherence).toBeLessThan(0.5);
  });

  it("coherence is bounded by evidence ceiling", () => {
    const ctx = createContext({ confidence: 0.3 });
    const risk = createRiskScore({ overallRisk: 0.15 });
    // With confidence 0.3, max coherence should be max(0.5, 0.3) = 0.5
    const coherence = computeSignalCoherence("approve", ctx, risk);
    expect(coherence).toBeLessThanOrEqual(0.5);
  });

  it("returns 0.5 neutral when no signals available", () => {
    const ctx = createContext({
      confidence: 0.5,
      lineageCompleteness: "complete",
      effectivenessTrend: { actionType: "update_agent_card", keepRate: 0, revertRate: 0, sampleSize: 0 },
      warnings: [] as EnrichedWarning[],
    });
    const coherence = computeSignalCoherence("approve", ctx);
    expect(coherence).toBe(0.5);
  });
});

describe("ApprovalRecommendation — DecisionArtifact compatibility", () => {
  it("has outcome, confidence, reasons, warnings, evidenceRefs, generatedAt", () => {
    const ctx = createContext();
    const engine = new RecommendationEngine();
    const result = engine.recommend(ctx);
    expect(result.outcome).toBeDefined();
    expect(result.recommendation).toBeDefined();
    expect(typeof result.confidence).toBe("number");
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(Array.isArray(result.evidenceRefs)).toBe(true);
    expect(result.generatedAt).toBeDefined();
    expect(result.sourceArtifacts).toBeDefined();
    expect(result.proposalId).toBe("prop-test-001");
  });
});

describe("RecommendationEngine — determinism", () => {
  it("produces identical results for the same inputs", () => {
    const ctx = createContext();
    const risk = createRiskScore();
    const engine = new RecommendationEngine();
    const frozenTime = "2026-06-20T12:00:00.000Z";
    const r1 = engine.recommend(ctx, risk, frozenTime);
    const r2 = engine.recommend(ctx, risk, frozenTime);
    expect(r1).toEqual(r2);
  });
});
