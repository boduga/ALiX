import { describe, it, expect } from "vitest";
import type { GovernanceReview, GovernanceVerdict, LensScore, CouncilVote, GovernanceReviewInput } from "../../src/adaptation/governance-review-types.js";

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
