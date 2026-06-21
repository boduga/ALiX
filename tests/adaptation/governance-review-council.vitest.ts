import { describe, it, expect } from "vitest";
import { GovernanceReviewCouncil } from "../../src/adaptation/governance-review-council.js";
import type { LensScore, GovernanceReviewInput } from "../../src/adaptation/governance-review-types.js";
import type { ApprovalRecommendation } from "../../src/adaptation/recommendation-types.js";
import type { DecisionContext } from "../../src/adaptation/decision-types.js";
import type { RiskScore, RiskDimension } from "../../src/adaptation/risk-score-types.js";

const FROZEN_TIME = "2026-06-21T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockInput(overrides?: Partial<GovernanceReviewInput>): GovernanceReviewInput {
  const rec: ApprovalRecommendation = {
    id: "rec-1",
    subject: "Test",
    outcome: "recommended",
    confidence: 0.8,
    reasons: [],
    generatedAt: FROZEN_TIME,
    recommendation: "approve",
    proposalId: "prop-1",
    sourceArtifacts: [],
  };

  const ctx: DecisionContext = {
    id: "ctx-1",
    subject: "Test",
    outcome: "complete",
    confidence: 0.9,
    reasons: [],
    generatedAt: FROZEN_TIME,
    contextStatus: "complete_context",
    proposalId: "prop-1",
    proposalStatus: "active",
    proposalAction: "adapt",
    createdAt: FROZEN_TIME,
    ageDays: 0,
    lineageCompleteness: "complete",
    similarProposals: [],
    effectivenessTrend: { actionType: "adapt", keepRate: 0.8, revertRate: 0.1, sampleSize: 10 },
    sourceArtifacts: [],
    dataFreshness: { newestArtifactAgeDays: 0, oldestArtifactAgeDays: 0 },
  };

  return { recommendation: rec, decisionContext: ctx, ...overrides };
}

type LensName = "red_team" | "historian" | "policy_auditor" | "confidence_critic";

const lensNames: LensName[] = ["red_team", "historian", "policy_auditor", "confidence_critic"];

function score(v: string, c: number, r: string, idx = 0): LensScore {
  return {
    lens: lensNames[idx % lensNames.length],
    recommendedVerdict: v as LensScore["recommendedVerdict"],
    confidence: c,
    rationale: r,
  };
}

const defaultScores: LensScore[] = [
  score("agree", 0.9, "Looks good", 0),
  score("agree", 0.8, "Seems fine\nNo issues", 1),
  score("agree", 0.7, "Acceptable risk", 2),
  score("agree", 0.85, "Standard approval", 3),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceReviewCouncil", () => {
  it("exists aggregate method", () => {
    const c = new GovernanceReviewCouncil();
    expect(typeof c.aggregate).toBe("function");
  });

  it("returns GovernanceReview with correct shape", () => {
    const c = new GovernanceReviewCouncil();
    const result = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(result.id).toBe("rev-1");
    expect(result.proposalId).toBe("prop-1");
    expect(result.recommendationId).toBe("rec-1");
    expect(result.outcome).toBe("reviewed");
    expect(result.verdict).toBe("agree");
    expect(result.generatedAt).toBe(FROZEN_TIME);
    expect(Array.isArray(result.concerns)).toBe(true);
    expect(Array.isArray(result.blindSpots)).toBe(true);
    expect(Array.isArray(result.historicalAnalogies)).toBe(true);
    expect(result.lensScores).toHaveLength(4);
    expect(result.councilVote.agree).toBe(4);
    expect(result.sourceArtifacts).toHaveLength(3); // recommendation + context + review
  });

  it("deterministic — same inputs produce identical output", () => {
    const c = new GovernanceReviewCouncil();
    const input = mockInput();
    const r1 = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, input, {
      generatedAt: FROZEN_TIME,
    });
    const r2 = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, input, {
      generatedAt: FROZEN_TIME,
    });
    expect(r1).toEqual(r2);
  });

  it("unanimous verdict — all four lenses agree", () => {
    const c = new GovernanceReviewCouncil();
    const scores: LensScore[] = [
      score("agree", 0.9, "Good", 0),
      score("agree", 0.8, "Fine", 1),
      score("agree", 0.7, "OK", 2),
      score("agree", 0.85, "Approved", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.verdict).toBe("agree");
    expect(r.councilVote).toEqual({
      agree: 4,
      agreeWithConcerns: 0,
      challenge: 0,
      insufficientInformation: 0,
    });
  });

  it("plurality — most votes wins", () => {
    const c = new GovernanceReviewCouncil();
    const scores: LensScore[] = [
      score("agree", 0.9, "Good", 0),
      score("agree_with_concerns", 0.8, "Concerns", 1),
      score("challenge", 0.7, "Bad", 2),
      score("agree", 0.85, "Approved", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.verdict).toBe("agree"); // 2 agree, 1 concerns, 1 challenge
    expect(r.councilVote.agree).toBe(2);
  });

  it("tiebreaker — most severe among tied verdicts wins", () => {
    const c = new GovernanceReviewCouncil();
    // 2 agree vs 2 challenge => tie, challenge (severity=2) beats agree (severity=0)
    const scores: LensScore[] = [
      score("agree", 0.9, "Good", 0),
      score("agree", 0.8, "Fine", 1),
      score("challenge", 0.7, "Risky", 2),
      score("challenge", 0.75, "Bad", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.verdict).toBe("challenge");
  });

  it("tiebreaker — insufficient_information beats challenge", () => {
    const c = new GovernanceReviewCouncil();
    // 2 insufficient vs 2 agree => tie, insufficient_information (severity=3) beats agree (severity=0)
    const scores: LensScore[] = [
      score("insufficient_information", 0.5, "Need more data", 0),
      score("insufficient_information", 0.6, "Also unclear", 1),
      score("agree", 0.8, "Fine", 2),
      score("agree", 0.7, "OK", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.verdict).toBe("insufficient_information");
  });

  it("confidence — unanimous high-confidence agree returns 1.0", () => {
    const c = new GovernanceReviewCouncil();
    const scores: LensScore[] = [
      score("agree", 1.0, "Good", 0),
      score("agree", 1.0, "Fine", 1),
      score("agree", 1.0, "OK", 2),
      score("agree", 1.0, "Approved", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    // definitive = 4 (none are insufficient)
    // definitiveRatio = 4/4 = 1
    // agreementFactor = 4/4 = 1
    // avgLensConfidence = (1+1+1+1)/4 = 1
    // confidence = 1 * 1 * 1 = 1
    expect(r.confidence).toBe(1.0);
  });

  it("confidence — insufficient_information verdict uses simple ratio", () => {
    const c = new GovernanceReviewCouncil();
    // 2 insufficient, 1 agree, 1 challenge => verdict = insufficient_information (tie + severity)
    const scores: LensScore[] = [
      score("insufficient_information", 0.5, "Unclear", 0),
      score("insufficient_information", 0.6, "Need data", 1),
      score("agree", 0.8, "Fine", 2),
      score("challenge", 0.7, "Risky", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.verdict).toBe("insufficient_information");
    expect(r.confidence).toBe(0.5); // 2/4 insufficient votes
  });

  it("confidence — mixed definitive lenses", () => {
    const c = new GovernanceReviewCouncil();
    // 2 agree (0.9, 0.8), 1 insufficient (0.5), 1 challenge (0.7)
    // verdict = agree (plurality: 2 agree > 1 challenge > 1 insufficient)
    // definitive = lenses not insufficient = the 2 agree + 1 challenge = 3
    // definitiveRatio = 3/4 = 0.75
    // agreementCount = for verdict "agree" = 2
    // agreementFactor = 2/3 ≈ 0.667
    // avgLensConfidence = (0.9+0.8+0.7)/3 = 0.8
    // confidence = 0.75 * 0.667 * 0.8 ≈ 0.4
    const scores: LensScore[] = [
      score("agree", 0.9, "Good", 0),
      score("agree", 0.8, "Fine", 1),
      score("insufficient_information", 0.5, "Unclear", 2),
      score("challenge", 0.7, "Risky", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.verdict).toBe("agree");
    expect(r.confidence).toBeCloseTo(0.4, 5);
  });

  it("concerns deduplication — case-insensitive exact match", () => {
    const c = new GovernanceReviewCouncil();
    const scores: LensScore[] = [
      score("agree_with_concerns", 0.8, "Security risk", 0),
      score("agree_with_concerns", 0.7, "security risk", 1),
      score("agree_with_concerns", 0.6, "Security Risk", 2),
      score("challenge", 0.9, "Different concern", 3),
    ];
    const r = c.aggregate("rev-1", "prop-1", "rec-1", scores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.concerns).toHaveLength(2);
    expect(r.concerns).toContain("Security risk");
    expect(r.concerns).toContain("Different concern");
  });

  it("blindSpots returns empty array (P6.5b placeholder)", () => {
    const c = new GovernanceReviewCouncil();
    const r = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.blindSpots).toEqual([]);
  });

  it("historicalAnalogies returns empty array (P6.5b placeholder)", () => {
    const c = new GovernanceReviewCouncil();
    const r = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.historicalAnalogies).toEqual([]);
  });

  it("reasons include verdict string and confidence percentage", () => {
    const c = new GovernanceReviewCouncil();
    const r = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.reasons[0]).toContain("agree");
    expect(r.reasons[0]).toContain("4/0/0/0");
    expect(r.reasons[1]).toContain("81%");
  });

  it("source artifacts include recommendation, context, and review", () => {
    const c = new GovernanceReviewCouncil();
    const input = mockInput();
    const r = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, input, {
      generatedAt: FROZEN_TIME,
    });
    const types = r.sourceArtifacts.map((a) => a.type);
    expect(types).toContain("recommendation");
    expect(types).toContain("context");
    expect(types).toContain("review");
  });

  it("source artifacts include risk score when provided in input", () => {
    const c = new GovernanceReviewCouncil();
    const riskScore: RiskScore = {
      id: "risk-1",
      subject: "Risk assessment",
      outcome: "medium",
      confidence: 0.8,
      reasons: [],
      generatedAt: FROZEN_TIME,
      overallRisk: 0.5,
      risks: [],
      dimensions: {} as Record<RiskDimension, number>,
      sourceArtifacts: [],
    };
    const input = mockInput({ riskScore });
    const r = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, input, {
      generatedAt: FROZEN_TIME,
    });
    const types = r.sourceArtifacts.map((a) => a.type);
    expect(types).toContain("risk");
    expect(r.sourceArtifacts).toHaveLength(4); // rec + context + risk + review
  });

  it("default generatedAt is current ISO timestamp", () => {
    const c = new GovernanceReviewCouncil();
    const before = new Date().toISOString();
    const r = c.aggregate("rev-1", "prop-1", "rec-1", defaultScores, mockInput());
    const after = new Date().toISOString();
    expect(r.generatedAt >= before && r.generatedAt <= after).toBe(true);
  });

  it("subject uses proposalId", () => {
    const c = new GovernanceReviewCouncil();
    const r = c.aggregate("rev-1", "my-proposal", "rec-1", defaultScores, mockInput(), {
      generatedAt: FROZEN_TIME,
    });
    expect(r.subject).toContain("my-proposal");
  });
});
