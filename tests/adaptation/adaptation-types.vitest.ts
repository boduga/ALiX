import { describe, it, expect } from "vitest";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

describe("AdaptationProposal types", () => {
  it("constructs a valid proposal", () => {
    const proposal: AdaptationProposal = {
      id: "prop-2026-06-19-001",
      createdAt: "2026-06-19T00:00:00.000Z",
      status: "pending",
      action: "create_agent_card",
      target: { kind: "agent_card", id: "new.agent" },
      payload: {
        id: "new.agent",
        name: "New Agent",
        description: "Fills a capability gap",
        version: "1.0.0",
        domains: ["general"],
        capabilities: ["capability.x"],
        enabled: true,
      },
      sourceRecommendationType: "capability_gap",
      sourceConfidence: 0.92,
      evidenceFingerprints: ["abc123def456"],
      reason: "12 goals required capability.x but no agent covers it",
    };
    expect(proposal.status).toBe("pending");
    expect(proposal.action).toBe("create_agent_card");
  });
});
