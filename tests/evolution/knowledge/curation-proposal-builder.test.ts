// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCurationProposal,
  buildEvidenceFromFindings,
  buildGovernanceRecommendation,
} from "../../../src/evolution/knowledge/curation-proposal-builder.js";
import type { CurationFinding } from "../../../src/evolution/knowledge/contracts/curation-contract.js";
import { generateDecision } from "../../../src/evolution/governance/decision-engine.js";
import { validateGovernanceRecommendation } from "../../../src/evolution/verification/contracts/recommendation-contract.js";
import { validateVerificationEvidence } from "../../../src/evolution/verification/contracts/verification-contract.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFinding(id: string, overrides: Partial<CurationFinding> = {}): CurationFinding {
  return {
    findingId: id,
    kind: "stale",
    reasonCode: "age",
    store: "learning",
    artifactId: `art-${id}`,
    artifactKind: "LearningSignal",
    severity: "medium",
    rationale: `stale finding for ${id}`,
    evidenceRefs: [`ev-${id}`],
    confidence: 0.9,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildCurationProposal
// ---------------------------------------------------------------------------

describe("buildCurationProposal", () => {
  it("returns null for empty findings (zero-findings invariant)", () => {
    assert.equal(buildCurationProposal([]), null);
  });

  it("returns a proposal with the finding list and a non-empty summary", () => {
    const findings = [makeFinding("f1")];
    const proposal = buildCurationProposal(findings);

    assert.ok(proposal !== null);
    assert.equal(proposal.findings.length, 1);
    assert.ok(proposal.summary.length > 0);
    assert.ok(proposal.proposalId.length > 0);
    assert.ok(proposal.createdAt.length > 0);
  });

  it("summarizes findings by kind: 'N stale, M duplicate, ...'", () => {
    const findings = [
      makeFinding("a", { kind: "stale" }),
      makeFinding("b", { kind: "stale" }),
      makeFinding("c", { kind: "duplicate", reasonCode: "exact", targetId: "a" }),
    ];
    const proposal = buildCurationProposal(findings);

    assert.ok(proposal !== null);
    assert.equal(proposal.summary, "2 stale, 1 duplicate");
    assert.deepEqual(proposal.dimension, ["stale", "duplicate"]);
  });

  it("derives a deterministic proposalId from the finding set", () => {
    const findings = [makeFinding("f1"), makeFinding("f2")];
    const first = buildCurationProposal(findings);
    const second = buildCurationProposal([...findings].reverse());

    assert.ok(first !== null && second !== null);
    assert.equal(first.proposalId, second.proposalId);
  });
});

// ---------------------------------------------------------------------------
// buildEvidenceFromFindings
// ---------------------------------------------------------------------------

describe("buildEvidenceFromFindings", () => {
  it("builds projected verification evidence with a non-empty proposalId", () => {
    const evidence = buildEvidenceFromFindings([makeFinding("f1")]);

    assert.equal(evidence.evidenceClass, "projected");
    assert.ok(evidence.proposalId.length > 0);
    assert.equal(evidence.reproducibilityLevel, 2);
    assert.ok(evidence.evidenceId.length > 0);
    assert.ok(evidence.integrityHash.length > 0);
  });

  it("passes structural validation as VerificationEvidence", () => {
    const evidence = buildEvidenceFromFindings([makeFinding("f1")]);
    assert.ok(validateVerificationEvidence(evidence).valid);
  });

  it("aggregates finding confidence into overallConfidence", () => {
    const findings = [
      makeFinding("lo", { confidence: 0.8 }),
      makeFinding("hi", { confidence: 1.0 }),
    ];
    const evidence = buildEvidenceFromFindings(findings);

    assert.equal(evidence.confidenceProfile.overallConfidence, 0.9);
  });

  it("throws on empty findings (no evidence without findings)", () => {
    assert.throws(() => buildEvidenceFromFindings([]));
  });
});

// ---------------------------------------------------------------------------
// buildGovernanceRecommendation
// ---------------------------------------------------------------------------

describe("buildGovernanceRecommendation", () => {
  it("builds the A2.5 recommendation shape with kind APPROVE", () => {
    const proposal = buildCurationProposal([makeFinding("f1")]);
    assert.ok(proposal !== null);

    const recommendation = buildGovernanceRecommendation(proposal);

    // Every A2.5 field present.
    for (const field of [
      "recommendationId",
      "evidenceId",
      "proposalId",
      "kind",
      "confidence",
      "reasoning",
      "supportingEvidence",
      "risks",
      "createdAt",
    ] as const) {
      assert.ok(field in recommendation, `missing field: ${field}`);
    }
    assert.equal(recommendation.kind, "APPROVE");
    assert.ok(recommendation.recommendationId.startsWith("rec-curate-"));
  });

  it("passes structural validation as GovernanceRecommendation", () => {
    const proposal = buildCurationProposal([makeFinding("f1")]);
    assert.ok(proposal !== null);
    assert.ok(validateGovernanceRecommendation(buildGovernanceRecommendation(proposal)).valid);
  });

  it("carries the aggregated finding confidence and finding rationale as risks", () => {
    const findings = [
      makeFinding("lo", { confidence: 0.8, rationale: "low risk stale" }),
      makeFinding("hi", { confidence: 1.0, rationale: "high risk duplicate" }),
    ];
    const proposal = buildCurationProposal(findings);
    assert.ok(proposal !== null);

    const recommendation = buildGovernanceRecommendation(proposal);

    assert.equal(recommendation.confidence, 0.9);
    assert.equal(recommendation.reasoning, proposal.summary);
    assert.deepEqual(recommendation.risks, ["low risk stale", "high risk duplicate"]);
    assert.deepEqual(recommendation.supportingEvidence, ["ev-lo", "ev-hi"]);
  });
});

// ---------------------------------------------------------------------------
// A6 → A3 round-trip
// ---------------------------------------------------------------------------

describe("A6 → A3 round-trip", () => {
  it("recommendation.evidenceId equals buildEvidenceFromFindings evidenceId", () => {
    const proposal = buildCurationProposal([makeFinding("f1")]);
    assert.ok(proposal !== null);

    const recommendation = buildGovernanceRecommendation(proposal);
    const evidence = buildEvidenceFromFindings(proposal.findings);

    assert.equal(recommendation.evidenceId, evidence.evidenceId);
  });

  it("generateDecision consumes the built evidence + recommendation and returns a valid GovernanceDecision", () => {
    const proposal = buildCurationProposal([makeFinding("f1")]);
    assert.ok(proposal !== null);

    const evidence = buildEvidenceFromFindings(proposal.findings);
    const recommendation = buildGovernanceRecommendation(proposal);
    const decision = generateDecision(evidence, recommendation);

    assert.ok(decision.decisionId.startsWith("govd-"));
    assert.ok(decision.kind.length > 0);
    assert.equal(typeof decision.confidence, "number");
    assert.ok(decision.confidence >= 0 && decision.confidence <= 1);
    assert.equal(decision.evidenceId, evidence.evidenceId);
    assert.equal(decision.recommendationId, recommendation.recommendationId);
    // Confidence 0.9 + reproducibility 2 + no regressions → APPROVE.
    assert.equal(decision.kind, "APPROVE");
    assert.equal(decision.followedRecommendation, true);
  });
});
