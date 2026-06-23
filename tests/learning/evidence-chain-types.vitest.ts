import { describe, it, expect } from "vitest";
import {
  PROVENANCE_RELATIONSHIPS,
  ARTIFACT_TYPES,
  EXPLAIN_DEFAULT_DEPTH,
  EXPLAIN_MAX_DEPTH,
  isProvenanceRelationship,
  isArtifactType,
} from "../../src/learning/evidence-chain-types.js";
import type {
  ProvenanceLink,
  ProvenanceRelationship,
  ArtifactType,
  LearningEvidenceChain,
} from "../../src/learning/evidence-chain-types.js";

describe("evidence-chain-types: relationships and artifact types", () => {
  it("exposes exactly six required provenance relationships", () => {
    expect(PROVENANCE_RELATIONSHIPS).toEqual([
      "derived_from",
      "supports",
      "generated",
      "approved_from",
      "reviewed_from",
      "proposal_from_recommendation",
    ]);
  });

  it("accepts and rejects relationship values via guard", () => {
    for (const r of PROVENANCE_RELATIONSHIPS) {
      expect(isProvenanceRelationship(r)).toBe(true);
    }
    expect(isProvenanceRelationship("unknown_relationship")).toBe(false);
    expect(isProvenanceRelationship("")).toBe(false);
    expect(isProvenanceRelationship(null)).toBe(false);
    expect(isProvenanceRelationship(undefined)).toBe(false);
  });

  it("lists every P6/P7/P8 artifact type in ARTIFACT_TYPES", () => {
    const expected = [
      "decision_context",
      "risk_score",
      "recommendation",
      "governance_review",
      "outcome_record",
      "lens_calibration_report",
      "recommendation_accuracy_report",
      "adaptation_proposal",
      "learning_signal",
      "calibration_profile",
      "learning_proposal",
      "learning_evidence_chain",
    ];
    expect(ARTIFACT_TYPES).toEqual(expected);
    for (const t of expected) {
      expect(isArtifactType(t)).toBe(true);
    }
  });

  it("rejects unknown artifact types via guard", () => {
    expect(isArtifactType("nope")).toBe(false);
    expect(isArtifactType("")).toBe(false);
    expect(isArtifactType(null)).toBe(false);
    expect(isArtifactType(undefined)).toBe(false);
  });

  it("exposes EXPLAIN_DEFAULT_DEPTH=5 and EXPLAIN_MAX_DEPTH=12", () => {
    expect(EXPLAIN_DEFAULT_DEPTH).toBe(5);
    expect(EXPLAIN_MAX_DEPTH).toBe(12);
    expect(EXPLAIN_MAX_DEPTH).toBeGreaterThan(EXPLAIN_DEFAULT_DEPTH);
  });

  it("PROVENANCE_RELATIONSHIPS is readonly (frozen array)", () => {
    expect(Object.isFrozen(PROVENANCE_RELATIONSHIPS) || PROVENANCE_RELATIONSHIPS.length === 6).toBe(true);
    // attempting mutation should not change the canonical length
    const before = PROVENANCE_RELATIONSHIPS.length;
    try {
      // @ts-expect-error — readonly array should reject push
      PROVENANCE_RELATIONSHIPS.push("hacked");
    } catch {
      // expected
    }
    expect(PROVENANCE_RELATIONSHIPS.length).toBe(before);
  });
});

describe("evidence-chain-types: shape contracts", () => {
  it("ProvenanceLink has the required fields and a strict relationship", () => {
    const link: ProvenanceLink = {
      sourceArtifactId: "a",
      sourceArtifactType: "decision_context",
      targetArtifactId: "b",
      targetArtifactType: "outcome_record",
      relationship: "derived_from",
      recordedAt: "2026-06-22T00:00:00.000Z",
    };
    expect(link.sourceArtifactId).toBe("a");
    expect(link.relationship).toBe("derived_from");
  });

  it("ProvenanceRelationship narrows to the canonical six values", () => {
    const r1: ProvenanceRelationship = "derived_from";
    const r2: ProvenanceRelationship = "supports";
    const r3: ProvenanceRelationship = "generated";
    const r4: ProvenanceRelationship = "approved_from";
    const r5: ProvenanceRelationship = "reviewed_from";
    const r6: ProvenanceRelationship = "proposal_from_recommendation";
    expect([r1, r2, r3, r4, r5, r6]).toHaveLength(6);
  });

  it("ArtifactType narrows to the canonical twelve values", () => {
    const types: ArtifactType[] = [
      "decision_context",
      "risk_score",
      "recommendation",
      "governance_review",
      "outcome_record",
      "lens_calibration_report",
      "recommendation_accuracy_report",
      "adaptation_proposal",
      "learning_signal",
      "calibration_profile",
      "learning_proposal",
      "learning_evidence_chain",
    ];
    expect(types).toHaveLength(12);
  });

  it("LearningEvidenceChain extends DecisionArtifact (inherits base fields)", () => {
    const chain: LearningEvidenceChain = {
      id: "chain-1",
      subject: "Chain for signal-123",
      outcome: "chain_assembled",
      confidence: 1.0,
      reasons: ["explain"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      rootArtifactId: "signal-123",
      rootArtifactType: "learning_signal",
      links: [],
      depth: 1,
      generatedBy: "alix explain",
    };
    expect(chain.id).toBe("chain-1");
    expect(chain.rootArtifactType).toBe("learning_signal");
    expect(chain.depth).toBe(1);
  });

  it("LearningEvidenceChain links array accepts ProvenanceLink values", () => {
    const chain: LearningEvidenceChain = {
      id: "c",
      subject: "s",
      outcome: "o",
      confidence: 1,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      rootArtifactId: "r",
      rootArtifactType: "outcome_record",
      links: [
        {
          sourceArtifactId: "r",
          sourceArtifactType: "outcome_record",
          targetArtifactId: "dec-1",
          targetArtifactType: "decision_context",
          relationship: "derived_from",
          recordedAt: "2026-06-22T00:00:00.000Z",
        },
      ],
      depth: 1,
    };
    expect(chain.links[0].relationship).toBe("derived_from");
  });
});
