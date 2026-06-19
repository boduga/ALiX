import { describe, it, expect } from "vitest";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

describe("AdaptationProposal revert types", () => {
  it("constructs a proposal with action 'revert_proposal'", () => {
    const proposal: AdaptationProposal = {
      id: "prop-2026-06-19-002",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "pending",
      action: "revert_proposal",
      target: { kind: "agent_card", id: "existing.agent" },
      payload: {
        reason: "Agent card change caused regression",
      },
      sourceRecommendationType: "guided_adaptation",
      sourceConfidence: 0.85,
      evidenceFingerprints: ["snap001"],
      reason: "Revert agent card change",
    };
    expect(proposal.status).toBe("pending");
    expect(proposal.action).toBe("revert_proposal");
  });

  it("constructs a proposal with target kind 'revert'", () => {
    const proposal: AdaptationProposal = {
      id: "prop-2026-06-19-003",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "pending",
      action: "create_agent_card",
      target: { kind: "revert", sourceProposalId: "prop-123" },
      payload: {
        reason: "Reverting prop-123",
      },
      sourceRecommendationType: "guided_adaptation",
      sourceConfidence: 0.90,
      evidenceFingerprints: ["snap002"],
      reason: "Revert proposal test",
    };
    expect(proposal.target.kind).toBe("revert");
    if (proposal.target.kind === "revert") {
      expect(proposal.target.sourceProposalId).toBe("prop-123");
    }
  });

  it("constructs a full AdaptationProposal with revert_proposal action and revert target", () => {
    const proposal: AdaptationProposal = {
      id: "prop-2026-06-19-004",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "pending",
      action: "revert_proposal",
      target: { kind: "revert", sourceProposalId: "prop-123" },
      payload: {
        reason: "Regression detected in capability routing",
        snapshotFingerprint: "abc123def456",
      },
      sourceRecommendationType: "guided_adaptation",
      sourceConfidence: 0.92,
      evidenceFingerprints: ["abc123def456"],
      reason: "Agent card change caused capability routing regression",
    };
    expect(proposal.action).toBe("revert_proposal");
    expect(proposal.target.kind).toBe("revert");
    if (proposal.target.kind === "revert") {
      expect(proposal.target.sourceProposalId).toBe("prop-123");
    }
    expect(proposal.status).toBe("pending");
  });
});
