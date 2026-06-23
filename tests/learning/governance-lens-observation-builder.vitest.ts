/**
 * P8.5a.2 fix #5 — `buildLensObservations` is the single source of truth.
 *
 * Covers: join behavior, concernsRaised rule, excludedNoOutcome count,
 * empty inputs, multiple lens scores per review.
 *
 * Pure helper: tests run with plain objects, no store I/O.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  buildLensObservations,
  isWarningVerdict,
} from "../../src/learning/governance-lens-observation-builder.js";
import type {
  GovernanceReview,
  LensName,
  LensScore,
} from "../../src/adaptation/governance-review-types.js";
import type {
  GovernanceVerdict,
} from "../../src/adaptation/governance-review-types.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";

// ---------------------------------------------------------------------------
// Helpers (mirror the fixture pattern used by governance-calibration-adapter)
// ---------------------------------------------------------------------------

function makeLensScore(
  lens: LensName,
  recommendedVerdict: GovernanceVerdict,
): LensScore {
  return { lens, recommendedVerdict, confidence: 0.7, rationale: "fixture" };
}

function makeReview(overrides: Partial<GovernanceReview> = {}): GovernanceReview {
  return {
    id: "review-fixture-1",
    subject: "Governance review fixture",
    outcome: "reviewed",
    confidence: 0.7,
    reasons: ["council reached quorum"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    recommendationId: "rec-fixture-1",
    proposalId: "prop-A",
    verdict: "agree_with_concerns",
    concerns: [],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores: [
      makeLensScore("red_team", "challenge"),
      makeLensScore("historian", "agree"),
      makeLensScore("policy_auditor", "agree_with_concerns"),
      makeLensScore("confidence_critic", "agree"),
    ],
    councilVote: { agree: 2, agreeWithConcerns: 1, challenge: 1, insufficientInformation: 0 },
    sourceArtifacts: [],
    ...overrides,
  };
}

function makeOutcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "",
    subject: "Outcome fixture",
    outcome: "success",
    confidence: undefined,
    reasons: ["fixture"],
    generatedAt: "2026-06-22T00:00:00.000Z",
    subjectId: "prop-A",
    subjectType: "proposal",
    actionTaken: "Applied",
    observationWindowDays: 7,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildLensObservations (fix #5)", () => {
  it("emits one observation per lens score whose review has an outcome", () => {
    const reviews = [
      makeReview({
        proposalId: "prop-1",
        lensScores: [
          makeLensScore("red_team", "agree"),
          makeLensScore("historian", "challenge"),
        ],
      }),
    ];
    const outcomes = [makeOutcome({ subjectId: "prop-1", outcome: "success" })];

    const { observations, excludedNoOutcome } = buildLensObservations(
      reviews,
      outcomes,
    );

    expect(observations).toHaveLength(2);
    expect(excludedNoOutcome).toBe(0);
    expect(observations[0]).toMatchObject({
      lens: "red_team",
      verdict: "agree",
      outcome: "success",
      concernsRaised: 0,
    });
    expect(observations[1]).toMatchObject({
      lens: "historian",
      verdict: "challenge",
      outcome: "success",
      concernsRaised: 1,
    });
  });

  it("excludes reviews whose proposal has no outcome", () => {
    const reviews = [
      makeReview({ proposalId: "prop-with-outcome", lensScores: [makeLensScore("red_team", "agree")] }),
      makeReview({ proposalId: "prop-no-outcome", lensScores: [makeLensScore("red_team", "agree")] }),
    ];
    const outcomes = [
      makeOutcome({ subjectId: "prop-with-outcome", outcome: "failure" }),
    ];

    const { observations, excludedNoOutcome } = buildLensObservations(
      reviews,
      outcomes,
    );

    expect(observations).toHaveLength(1);
    expect(excludedNoOutcome).toBe(1);
  });

  it("infers concernsRaised from warning verdicts (1) vs non-warning (0)", () => {
    // Fix #4 — same rule as `isWarningVerdict`. Verify the helper applies
    // the same definition so adapter and CLI agree byte-for-byte.
    const reviews = [
      makeReview({ proposalId: "p1", lensScores: [makeLensScore("red_team", "agree")] }),
      makeReview({ proposalId: "p2", lensScores: [makeLensScore("red_team", "agree_with_concerns")] }),
      makeReview({ proposalId: "p3", lensScores: [makeLensScore("red_team", "challenge")] }),
      makeReview({ proposalId: "p4", lensScores: [makeLensScore("red_team", "insufficient_information")] }),
    ];
    const outcomes = [
      makeOutcome({ subjectId: "p1", outcome: "success" }),
      makeOutcome({ subjectId: "p2", outcome: "failure" }),
      makeOutcome({ subjectId: "p3", outcome: "partial_success" }),
      makeOutcome({ subjectId: "p4", outcome: "neutral" }),
    ];

    const { observations } = buildLensObservations(reviews, outcomes);

    expect(observations.map((o) => o.concernsRaised)).toEqual([0, 1, 1, 0]);
  });

  it("returns empty arrays for empty inputs", () => {
    const { observations, excludedNoOutcome } = buildLensObservations([], []);
    expect(observations).toEqual([]);
    expect(excludedNoOutcome).toBe(0);
  });

  it("isWarningVerdict is re-exported from the helper module (fix #4 wiring)", () => {
    // The helper re-exports isWarningVerdict so callers needing just the
    // rule (e.g. CLI) can import from one place. Verify the export exists.
    expect(typeof isWarningVerdict).toBe("function");
    expect(isWarningVerdict("agree_with_concerns")).toBe(true);
    expect(isWarningVerdict("agree")).toBe(false);
  });
});