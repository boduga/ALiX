/**
 * P8.5a.2 fix #5 — Pure governance lens observation derivation.
 *
 * Consolidates the join + `concernsRaised` rule that was previously
 * duplicated in:
 *   - `governance-calibration-adapter.ts` (inline `for` loop, local
 *     `isWarningVerdict` re-definition)
 *   - `src/cli/commands/decision.ts` `runOutcomeLensCalibration`
 *     (inline `for` loop, inline ternary rule)
 *
 * Single source of truth. Pure: no I/O, no store imports, no
 * `LearningStore`. Both consumers (the adapter and the CLI) just call
 * `buildLensObservations(reviews, outcomes)` and get back the same
 * observation array.
 *
 * Adapter Purity Invariant: this file imports only TYPES from
 * `governance-review-types` and `outcome-types` — no mutation surface.
 * Sentinel-enforced.
 *
 * @module
 */

import type {
  GovernanceReview,
  GovernanceVerdict,
  LensScore,
} from "../adaptation/governance-review-types.js";
import type { OutcomeRecord, OutcomeValue } from "../adaptation/outcome-types.js";
import type { LensObservation } from "../adaptation/lens-calibration-builder.js";

// Re-export `isWarningVerdict` so callers needing just the rule get it
// from the same canonical place as the observation derivation. Fix #4.
export { isWarningVerdict } from "../adaptation/lens-calibration-builder.js";

export interface BuildLensObservationsResult {
  /** One observation per lens score whose review had a matching outcome. */
  observations: LensObservation[];
  /** Reviews that had no outcome in the supplied set — kept for diagnostics. */
  excludedNoOutcome: number;
}

/**
 * Join `reviews × outcomes` by `review.proposalId → outcome.subjectId` and
 * derive `LensObservation[]`. One observation per `lensScores` entry in
 * each review whose proposal has an outcome on record.
 *
 * `concernsRaised` is INFERRED from `recommendedVerdict` (1 for warning
 * verdicts "agree_with_concerns" | "challenge", 0 otherwise). This is the
 * LOW-fidelity inference used today; a future P9+ telemetry phase may
 * replace this with real per-lens counts.
 */
export function buildLensObservations(
  reviews: GovernanceReview[],
  outcomes: OutcomeRecord[],
): BuildLensObservationsResult {
  // Build outcomeByProposal for O(1) join lookup.
  const outcomeByProposal = new Map<string, OutcomeValue>();
  for (const o of outcomes) {
    outcomeByProposal.set(o.subjectId, o.outcome);
  }

  const observations: LensObservation[] = [];
  let excludedNoOutcome = 0;

  for (const review of reviews) {
    const outcome = outcomeByProposal.get(review.proposalId);
    if (outcome === undefined) {
      excludedNoOutcome += 1;
      continue;
    }
    for (const ls of review.lensScores as LensScore[]) {
      observations.push({
        lens: ls.lens,
        verdict: ls.recommendedVerdict as GovernanceVerdict,
        outcome,
        concernsRaised: ls.recommendedVerdict === "agree_with_concerns" ||
          ls.recommendedVerdict === "challenge"
          ? 1
          : 0, // LOW_FIDELITY inference
      });
    }
  }

  return { observations, excludedNoOutcome };
}