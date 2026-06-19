import { describe, it, expect } from "vitest";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
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

function makeBaseProposal(): AdaptationProposal {
  return {
    id: "prop-2026-06-19-001",
    createdAt: "2026-06-19T00:00:00.000Z",
    status: "pending",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "new.agent" },
    payload: { foo: "bar" },
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.92,
    evidenceFingerprints: ["abc123def456"],
    reason: "some reason",
  };
}

describe("AdaptationProposal.provenance (P5.2c.1)", () => {
  it("accepts a proposal without provenance (backwards-compatible)", () => {
    const proposal: AdaptationProposal = makeBaseProposal();
    expect(proposal.provenance).toBeUndefined();
  });

  it("accepts provenance: 'auto'", () => {
    const proposal: AdaptationProposal = { ...makeBaseProposal(), provenance: "auto" };
    expect(proposal.provenance).toBe("auto");
  });

  it("accepts provenance: 'manual'", () => {
    const proposal: AdaptationProposal = { ...makeBaseProposal(), provenance: "manual" };
    expect(proposal.provenance).toBe("manual");
  });

  it("RecommendationToProposal.convert leaves provenance undefined (manual)", () => {
    const proposal = RecommendationToProposal.convert(makeRecommendation());
    expect(proposal).not.toBeNull();
    expect(proposal!.provenance).toBeUndefined();
  });

  it("declares provenance as 'auto' | 'manual' | undefined on the interface", () => {
    // Compile-time check: the property must be present in the interface declaration.
    // If provenance is removed, this assignment fails TypeScript compilation.
    const provenanceType: "auto" | "manual" | undefined = ({} as AdaptationProposal).provenance;
    expect(provenanceType === undefined || provenanceType === "auto" || provenanceType === "manual").toBe(true);
  });
});