/**
 * A9 Slice 3 — A2.5/A3 governance path tests.
 *
 * Covers:
 *   - the A9 bridge (forecast band → A2.5 recommendation kind),
 *   - the A2.5 sixth kind (RISK_GATED_REVIEW),
 *   - the A2.5 → A3 map entry (RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE),
 *   - the end-to-end flow (high-band forecast → A3 decision → UNDER_REVIEW).
 *
 * @module a9-governance
 */

import { describe, it, expect } from "vitest";
import {
  buildGovernanceRecommendation,
  forecastBandToRecommendationKind,
} from "../../src/evolution/a9/a9-bridge.js";
import type { A9Forecast } from "../../src/evolution/a9/contracts/a9-contract.js";
import {
  A9_FORECAST_VERSION,
  A9_GENERATOR_VERSION,
} from "../../src/evolution/a9/contracts/a9-contract.js";
import {
  GOVERNANCE_RECOMMENDATION_KINDS,
  isValidGovernanceRecommendationKind,
  validateGovernanceRecommendation,
} from "../../src/evolution/verification/contracts/recommendation-contract.js";
import type { GovernanceRecommendationKind } from "../../src/evolution/verification/contracts/recommendation-contract.js";
import {
  generateDecision,
  decisionKindToTargetState,
} from "../../src/evolution/governance/index.js";
import type { GovernanceDecisionKind } from "../../src/evolution/governance/contracts/decision-contract.js";
import { createVerificationEvidence } from "../../src/evolution/verification/index.js";
import type {
  VerificationEvidenceInput,
  ConfidenceProfile,
} from "../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an A9Forecast literal. Default band is "high". */
function makeForecast(
  overrides: Partial<A9Forecast> = {},
): A9Forecast {
  return {
    forecastId: "a9-" + "1".repeat(63),
    forecastVersion: A9_FORECAST_VERSION,
    subject: "prop-001",
    subjectCapability: "cap-001",
    prediction: { kind: "trust-velocity", band: "high", internalScore: 0.7 },
    horizon: { from: "2026-08-14T00:00:00.000Z", to: "2026-09-13T00:00:00.000Z" },
    confidence: 0.8,
    provenance: {
      generatedAt: "2026-08-14T00:00:00.000Z",
      generatorVersion: A9_GENERATOR_VERSION,
      evidenceRefs: ["ev-1", "ev-2"],
    },
    ...overrides,
  };
}

/** Build an A9Forecast with the given risk band. */
function forecastWithBand(band: A9Forecast["prediction"]["band"]): A9Forecast {
  const internalScore =
    band === "low" ? 0.1 : band === "medium" ? 0.4 : band === "high" ? 0.7 : 0.9;
  return makeForecast({
    prediction: { kind: "trust-velocity", band, internalScore },
  });
}

function makeProfile(overall: number): ConfidenceProfile {
  return {
    replayFidelity: 0.95,
    coverage: 0.9,
    determinism: 1.0,
    historicalSimilarity: 0.9,
    overallConfidence: overall,
  };
}

function makeEvidence(
  overallConfidence: number,
  behavioralChanges: string[] = [],
  overrides: Partial<VerificationEvidenceInput> = {},
): ReturnType<typeof createVerificationEvidence> {
  return createVerificationEvidence({
    verificationId: "ver-run-a9-001",
    proposalId: "prop-001",
    replayDatasetId: "ds-001",
    proposalSnapshotHash: "hash-prop",
    environmentHash: "hash-env",
    baselineMetrics: { m: 1 },
    candidateMetrics: { m: 2 },
    metricDeltas: { m: 1 },
    behavioralChanges,
    confidenceProfile: makeProfile(overallConfidence),
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: "2026-08-14T00:00:00.000Z",
    expiresAt: "2099-12-31T00:00:00.000Z",
    ...overrides,
  });
}

/** Build A2 evidence that drives generateDecision to a specific decision kind. */
function evidenceForDecision(
  kind: GovernanceDecisionKind,
): ReturnType<typeof createVerificationEvidence> {
  switch (kind) {
    case "APPROVE":
      return makeEvidence(0.9, [], { reproducibilityLevel: 2 });
    case "MONITOR":
      return makeEvidence(0.6, [], { reproducibilityLevel: 2 });
    case "REJECT":
      return makeEvidence(0.2, [], { reproducibilityLevel: 2 });
    case "REQUEST_MORE_EVIDENCE":
      // reproducibilityLevel below the default min (2) → REQUEST_MORE_EVIDENCE
      return makeEvidence(0.9, [], { reproducibilityLevel: 1 });
  }
}

/** Build an A2.5 recommendation of the given kind (validator-conformant). */
function makeRecommendationOfKind(
  kind: GovernanceRecommendationKind,
): ReturnType<typeof buildGovernanceRecommendation> {
  return {
    recommendationId: "a9-rec-" + "2".repeat(63),
    evidenceId: "ev-a9-001",
    proposalId: "prop-001",
    kind,
    confidence: 0.8,
    reasoning: "A9 governance path test recommendation",
    supportingEvidence: ["ev-a9-001"],
    risks: [],
    createdAt: "2026-08-14T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// A9 → A2.5 bridge
// ---------------------------------------------------------------------------

describe("A9 → A2.5 bridge (buildGovernanceRecommendation)", () => {
  it("maps low band → MONITOR", () => {
    const rec = buildGovernanceRecommendation(forecastWithBand("low"));
    expect(rec.kind).toBe("MONITOR");
  });

  it("maps medium band → MONITOR", () => {
    const rec = buildGovernanceRecommendation(forecastWithBand("medium"));
    expect(rec.kind).toBe("MONITOR");
  });

  it("maps high band → RISK_GATED_REVIEW", () => {
    const rec = buildGovernanceRecommendation(forecastWithBand("high"));
    expect(rec.kind).toBe("RISK_GATED_REVIEW");
  });

  it("maps critical band → RISK_GATED_REVIEW", () => {
    const rec = buildGovernanceRecommendation(forecastWithBand("critical"));
    expect(rec.kind).toBe("RISK_GATED_REVIEW");
  });

  it("exposes the verbatim band→kind mapping as a pure function", () => {
    expect(forecastBandToRecommendationKind("low")).toBe("MONITOR");
    expect(forecastBandToRecommendationKind("medium")).toBe("MONITOR");
    expect(forecastBandToRecommendationKind("high")).toBe("RISK_GATED_REVIEW");
    expect(forecastBandToRecommendationKind("critical")).toBe("RISK_GATED_REVIEW");
  });

  it("references the A9 forecast identity (recommendationId = a9-rec:<forecastId>)", () => {
    const forecast = forecastWithBand("high");
    const rec = buildGovernanceRecommendation(forecast);
    expect(rec.recommendationId).toBe(`a9-rec:${forecast.forecastId}`);
    expect(rec.recommendationId.startsWith("a9-rec:")).toBe(true);
  });

  it("traces proposalId to the forecast subject", () => {
    const forecast = forecastWithBand("high");
    const rec = buildGovernanceRecommendation(forecast);
    expect(rec.proposalId).toBe(forecast.subject);
  });

  it("derives a deterministic evidenceId from the forecast evidence refs", () => {
    const forecast = forecastWithBand("high");
    const a = buildGovernanceRecommendation(forecast).evidenceId;
    const b = buildGovernanceRecommendation(forecast).evidenceId;
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("satisfies validateGovernanceRecommendation", () => {
    for (const band of ["low", "medium", "high", "critical"] as const) {
      const rec = buildGovernanceRecommendation(forecastWithBand(band));
      const result = validateGovernanceRecommendation(rec);
      expect(result.valid, `${band}: ${result.errors.join(", ")}`).toBe(true);
    }
  });

  it("carries forecast provenance into supportingEvidence and createdAt", () => {
    const forecast = forecastWithBand("critical");
    const rec = buildGovernanceRecommendation(forecast);
    expect(rec.supportingEvidence).toEqual([...forecast.provenance.evidenceRefs]);
    expect(rec.createdAt).toBe(forecast.provenance.generatedAt);
    expect(rec.confidence).toBe(forecast.confidence);
    expect(rec.risks).toEqual([]);
  });

  it("is deterministic — same forecast yields an identical recommendation", () => {
    const forecast = forecastWithBand("high");
    const a = buildGovernanceRecommendation(forecast);
    const b = buildGovernanceRecommendation(forecast);
    expect(b).toEqual(a);
    expect(b.recommendationId).toBe(a.recommendationId);
    expect(b.evidenceId).toBe(a.evidenceId);
  });
});

// ---------------------------------------------------------------------------
// A2.5 sixth kind
// ---------------------------------------------------------------------------

describe("A2.5 sixth kind — RISK_GATED_REVIEW", () => {
  it("has exactly 6 kinds", () => {
    expect(GOVERNANCE_RECOMMENDATION_KINDS.length).toBe(6);
  });

  it("includes RISK_GATED_REVIEW", () => {
    expect(GOVERNANCE_RECOMMENDATION_KINDS).toContain("RISK_GATED_REVIEW");
  });

  it("keeps all 5 pre-existing kinds", () => {
    for (const kind of [
      "APPROVE",
      "MONITOR",
      "REQUEST_ADDITIONAL_EVIDENCE",
      "REJECT",
      "ESCALATE",
    ] as const) {
      expect(GOVERNANCE_RECOMMENDATION_KINDS).toContain(kind);
    }
  });

  it("isValidGovernanceRecommendationKind('RISK_GATED_REVIEW') === true", () => {
    expect(isValidGovernanceRecommendationKind("RISK_GATED_REVIEW")).toBe(true);
    expect(isValidGovernanceRecommendationKind("NOT_A_KIND")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A2.5 → A3 mapping (behavioral: RECOMMENDATION_KIND_MAP is module-private,
// so the mapping is asserted through decision tracking fields)
// ---------------------------------------------------------------------------

describe("A2.5 → A3 mapping", () => {
  it("maps RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE", () => {
    const rec = makeRecommendationOfKind("RISK_GATED_REVIEW");
    const decision = generateDecision(
      evidenceForDecision("REQUEST_MORE_EVIDENCE"),
      rec,
    );
    expect(decision.kind).toBe("REQUEST_MORE_EVIDENCE");
    expect(decision.followedRecommendation).toBe(true);
    expect(decision.recommendationId).toBe(rec.recommendationId);
  });

  it("keeps the pre-existing A2.5→A3 entries unchanged (5 map keys behaviorally)", () => {
    const cases: ReadonlyArray<
      [GovernanceRecommendationKind, GovernanceDecisionKind]
    > = [
      ["APPROVE", "APPROVE"],
      ["MONITOR", "MONITOR"],
      ["REJECT", "REJECT"],
      ["REQUEST_ADDITIONAL_EVIDENCE", "REQUEST_MORE_EVIDENCE"],
    ];
    for (const [recKind, decisionKind] of cases) {
      const rec = makeRecommendationOfKind(recKind);
      const decision = generateDecision(evidenceForDecision(decisionKind), rec);
      expect(decision.kind).toBe(decisionKind);
      expect(
        decision.followedRecommendation,
        `${recKind} should still map to ${decisionKind}`,
      ).toBe(true);
    }
  });

  it("ESCALATE still has no map entry (negative control)", () => {
    const rec = makeRecommendationOfKind("ESCALATE");
    const decision = generateDecision(
      evidenceForDecision("REQUEST_MORE_EVIDENCE"),
      rec,
    );
    expect(decision.kind).toBe("REQUEST_MORE_EVIDENCE");
    expect(decision.followedRecommendation).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: A9 forecast → A2.5 recommendation → A3 decision
// ---------------------------------------------------------------------------

describe("A9 → A2.5 → A3 end-to-end", () => {
  it("high-band forecast → RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE → UNDER_REVIEW", () => {
    const forecast = forecastWithBand("high");
    const recommendation = buildGovernanceRecommendation(forecast);
    expect(recommendation.kind).toBe("RISK_GATED_REVIEW");

    const decision = generateDecision(
      evidenceForDecision("REQUEST_MORE_EVIDENCE"),
      recommendation,
    );
    expect(decision.kind).toBe("REQUEST_MORE_EVIDENCE");
    expect(decision.followedRecommendation).toBe(true);
    expect(decisionKindToTargetState(decision.kind)).toBe("UNDER_REVIEW");
  });

  it("low-band forecast → MONITOR → MONITOR → UNDER_REVIEW", () => {
    const forecast = forecastWithBand("low");
    const recommendation = buildGovernanceRecommendation(forecast);
    expect(recommendation.kind).toBe("MONITOR");

    const decision = generateDecision(
      evidenceForDecision("MONITOR"),
      recommendation,
    );
    expect(decision.kind).toBe("MONITOR");
    expect(decision.followedRecommendation).toBe(true);
    expect(decisionKindToTargetState(decision.kind)).toBe("UNDER_REVIEW");
  });
});
