import { describe, it, expect } from "vitest";
import type { GovernanceReview, GovernanceVerdict, LensScore, CouncilVote, GovernanceReviewInput } from "../../src/adaptation/governance-review-types.js";
import { LENS_PROMPTS } from "../../src/adaptation/lens-agent.js";

describe("GovernanceReview type shape", () => {
  it("type exists and has required DecisionArtifact fields", () => {
    const r: GovernanceReview = {
      id: "rev-test", subject: "Test", outcome: "reviewed",
      confidence: 0.5, reasons: [], generatedAt: "t",
      recommendationId: "r", proposalId: "p", verdict: "agree",
      concerns: [], blindSpots: [], historicalAnalogies: [],
      lensScores: [],
      councilVote: { agree: 0, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 },
      sourceArtifacts: [],
    };
    expect(r).toBeDefined();
    expect(r.id).toBeTruthy();
  });
});

describe("LensAgent prompt templates", () => {
  it("has prompts for all 4 lenses", () => {
    expect(Object.keys(LENS_PROMPTS).length).toBe(4);
  });
});
