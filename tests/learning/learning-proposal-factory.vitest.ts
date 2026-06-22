// tests/learning/learning-proposal-factory.vitest.ts
import { describe, it, expect } from "vitest";
import {
  ProposalFactory,
  buildLearningProposal,
} from "../../src/cli/learning-proposal-factory.js";
import type {
  CalibrationProfile,
  LearningProposal,
} from "../../src/learning/learning-types.js";

const GENERATED_AT = "2026-06-22T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProfile(overrides: Partial<CalibrationProfile> = {}): CalibrationProfile {
  return {
    id: "cp-1",
    subject: "Test profile",
    outcome: "suggested",
    confidence: 0.85,
    reasons: ["overconfidence"],
    generatedAt: GENERATED_AT,
    target: "recommendation_confidence_multiplier",
    targetName: "bucket_0.8_1.0",
    previousValue: 1.0,
    suggestedValue: 0.65,
    reason: "Observed overconfidence",
    evidenceRefs: ["ls-1"],
    sourceSignalIds: ["ls-1"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProposalFactory", () => {
  const factory = new ProposalFactory();

  it("produces a pending AdaptationProposal with action learning_adjustment", () => {
    const learning: LearningProposal = {
      id: "prop-learning-1",
      subject: "Recommendation calibration",
      outcome: "pending_learning",
      confidence: 0.85,
      reasons: [],
      generatedAt: GENERATED_AT,
      proposalType: "recommendation_calibration",
      profiles: [makeProfile()],
      expectedBenefit: "Reduce overconfidence",
      riskEstimate: "Low",
      sourceSignalIds: ["ls-1"],
      requiresApproval: true,
    };

    const proposal = factory.toAdaptationProposal(learning);

    expect(proposal.action).toBe("learning_adjustment");
    expect(proposal.status).toBe("pending");
    expect(proposal.target.kind).toBe("learning");
    expect(proposal.target).toMatchObject({ kind: "learning", area: "recommendation" });
    expect(proposal.provenance).toBe("manual");
    expect(proposal.sourceRecommendationType).toBe("learning_calibration");
  });

  it("maps each proposalType to the correct learning area", () => {
    const cases: Array<[LearningProposal["proposalType"], string]> = [
      ["recommendation_calibration", "recommendation"],
      ["risk_calibration", "risk"],
      ["governance_calibration", "governance"],
      ["routing_calibration", "routing"],
    ];

    for (const [proposalType, expectedArea] of cases) {
      const learning: LearningProposal = {
        id: `prop-${proposalType}`,
        subject: proposalType,
        outcome: "pending_learning",
        confidence: 0.7,
        reasons: [],
        generatedAt: GENERATED_AT,
        proposalType,
        profiles: [],
        expectedBenefit: "test",
        riskEstimate: "test",
        sourceSignalIds: [],
        requiresApproval: true,
      };
      const proposal = factory.toAdaptationProposal(learning);
      expect(proposal.target).toMatchObject({ kind: "learning", area: expectedArea });
    }
  });

  it("carries calibration profiles in the payload", () => {
    const profiles = [makeProfile({ id: "cp-a" }), makeProfile({ id: "cp-b" })];
    const learning: LearningProposal = {
      id: "prop-learning-2",
      subject: "test",
      outcome: "pending_learning",
      confidence: 0.8,
      reasons: [],
      generatedAt: GENERATED_AT,
      proposalType: "risk_calibration",
      profiles,
      expectedBenefit: "test",
      riskEstimate: "test",
      sourceSignalIds: ["ls-1", "ls-2"],
      requiresApproval: true,
    };

    const proposal = factory.toAdaptationProposal(learning);
    expect(proposal.payload.profiles).toEqual(profiles);
    expect(proposal.payload.sourceSignalIds).toEqual(["ls-1", "ls-2"]);
  });

  it("never sets approved or applied fields", () => {
    const learning: LearningProposal = {
      id: "prop-learning-3",
      subject: "test",
      outcome: "pending_learning",
      confidence: 0.7,
      reasons: [],
      generatedAt: GENERATED_AT,
      proposalType: "governance_calibration",
      profiles: [],
      expectedBenefit: "test",
      riskEstimate: "test",
      sourceSignalIds: [],
      requiresApproval: true,
    };

    const proposal = factory.toAdaptationProposal(learning);
    expect(proposal.status).toBe("pending");
    expect(proposal.approvedBy).toBeUndefined();
    expect(proposal.approvedAt).toBeUndefined();
    expect(proposal.appliedAt).toBeUndefined();
  });
});

describe("buildLearningProposal helper", () => {
  it("builds a LearningProposal with deduped source signal IDs", () => {
    const profiles = [
      makeProfile({ sourceSignalIds: ["ls-1", "ls-2"] }),
      makeProfile({ sourceSignalIds: ["ls-2", "ls-3"] }),
    ];

    const learning = buildLearningProposal(
      "recommendation_calibration",
      profiles,
      GENERATED_AT,
    );

    expect(learning.proposalType).toBe("recommendation_calibration");
    expect(learning.profiles).toEqual(profiles);
    expect(learning.sourceSignalIds).toEqual(["ls-1", "ls-2", "ls-3"]);
    expect(learning.requiresApproval).toBe(true);
  });

  it("averages profile confidence into the proposal confidence", () => {
    const profiles = [
      makeProfile({ confidence: 0.8 }),
      makeProfile({ confidence: 0.6 }),
    ];
    const learning = buildLearningProposal(
      "risk_calibration",
      profiles,
      GENERATED_AT,
    );
    expect(learning.confidence).toBeCloseTo(0.7, 2);
  });

  it("handles empty profiles with zero confidence", () => {
    const learning = buildLearningProposal(
      "governance_calibration",
      [],
      GENERATED_AT,
    );
    expect(learning.confidence).toBe(0);
    expect(learning.sourceSignalIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Governance sentinel: ProposalFactory is CLI-only
// ---------------------------------------------------------------------------

describe("governance boundary", () => {
  it("ProposalFactory lives in the CLI layer, not src/learning/", async () => {
    // Verify the import resolves from src/cli/, confirming the factory is
    // outside the learning module that the sentinels guard.
    const mod = await import("../../src/cli/learning-proposal-factory.js");
    expect(mod.ProposalFactory).toBeDefined();
    expect(typeof mod.ProposalFactory).toBe("function");
  });
});
