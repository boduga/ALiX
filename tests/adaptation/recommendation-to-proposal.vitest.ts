import { describe, it, expect } from "vitest";
import { RecommendationToProposal } from "../../src/adaptation/recommendation-to-proposal.js";
import type { Recommendation } from "../../src/reflection/reflection-types.js";

function makeRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    type: "capability_gap",
    confidence: 0.85,
    title: "Need a new capability",
    evidence: ["ev-001", "ev-002"],
    recommendedAction: "Create new agent card for FooCapability",
    ...overrides,
  };
}

describe("RecommendationToProposal", () => {
  describe("type mapping", () => {
    it("maps capability_gap to create_agent_card", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "capability_gap" }));
      expect(proposal?.action).toBe("create_agent_card");
    });

    it("maps routing_adjustment to suggest_routing_weight", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "routing_adjustment" }));
      expect(proposal?.action).toBe("suggest_routing_weight");
    });

    it("maps skill_revision to adjust_skill_definition", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "skill_revision" }));
      expect(proposal?.action).toBe("adjust_skill_definition");
    });

    it("maps agent_card_update to update_agent_card", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "agent_card_update" }));
      expect(proposal?.action).toBe("update_agent_card");
    });

    it("maps process_change to create_improvement_issue", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "process_change" }));
      expect(proposal?.action).toBe("create_improvement_issue");
    });
  });

  describe("proposal shape", () => {
    it("returns null for unknown recommendation type", () => {
      const proposal = RecommendationToProposal.convert(
        makeRecommendation({ type: "bogus_type" as unknown as "capability_gap" })
      );
      expect(proposal).toBeNull();
    });

    it("starts in pending status", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation());
      expect(proposal?.status).toBe("pending");
    });

    it("preserves sourceRecommendationType", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "capability_gap" }));
      expect(proposal?.sourceRecommendationType).toBe("capability_gap");
    });

    it("preserves sourceConfidence", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ confidence: 0.42 }));
      expect(proposal?.sourceConfidence).toBe(0.42);
    });

    it("preserves evidenceFingerprints from recommendation.evidence", () => {
      const proposal = RecommendationToProposal.convert(
        makeRecommendation({ evidence: ["ev-a", "ev-b", "ev-c"] })
      );
      expect(proposal?.evidenceFingerprints).toEqual(["ev-a", "ev-b", "ev-c"]);
    });

    it("preserves reason from recommendation title + recommendedAction", () => {
      const proposal = RecommendationToProposal.convert(
        makeRecommendation({ title: "My title", recommendedAction: "My action" })
      );
      expect(proposal?.reason).toContain("My title");
      expect(proposal?.reason).toContain("My action");
    });
  });

  describe("id generation", () => {
    it("generates id with prop-YYYY-MM-DD-NNN format", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation());
      expect(proposal?.id).toMatch(/^prop-\d{4}-\d{2}-\d{2}-\d{3}$/);
    });

    it("generates id with current date prefix", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation());
      const today = new Date().toISOString().slice(0, 10);
      expect(proposal?.id.startsWith(`prop-${today}-`)).toBe(true);
    });

    it("sets createdAt to current ISO timestamp", () => {
      const before = new Date().toISOString();
      const proposal = RecommendationToProposal.convert(makeRecommendation());
      const after = new Date().toISOString();
      expect(proposal?.createdAt).not.toBeNull();
      expect(proposal!.createdAt >= before).toBe(true);
      expect(proposal!.createdAt <= after).toBe(true);
    });
  });

  describe("target derivation", () => {
    it("derives target for capability_gap", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "capability_gap" }));
      expect(proposal?.target.kind).toBe("agent_card");
    });

    it("derives target for routing_adjustment", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "routing_adjustment" }));
      expect(proposal?.target.kind).toBe("routing_weight");
    });

    it("derives target for process_change", () => {
      const proposal = RecommendationToProposal.convert(makeRecommendation({ type: "process_change" }));
      expect(proposal?.target.kind).toBe("issue");
    });
  });

  describe("payload derivation", () => {
    it("derives a non-empty payload from recommendation", () => {
      const proposal = RecommendationToProposal.convert(
        makeRecommendation({ title: "T", recommendedAction: "A", evidence: ["e1"] })
      );
      expect(proposal?.payload).toBeDefined();
      expect(Object.keys(proposal!.payload).length).toBeGreaterThan(0);
    });
  });
});
