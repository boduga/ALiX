/**
 * P26.3 -- Review Outcome Analytics.
 *
 * Pure read-only analytics functions over policy review outcome records.
 * Computes outcome distributions, documentation gaps, and closure patterns.
 *
 * No ranking logic. No reviewer scores. No leaderboards.
 * No auto-resolution of missing outcomes.
 */

import type { PolicyReviewOutcome, PolicyReviewOutcomeType } from "./policy-review-outcome-types.js";
import { OUTCOME_TYPES } from "./policy-review-outcome-types.js";

// ---------------------------------------------------------------------------
// Analytics shape
// ---------------------------------------------------------------------------

export interface OutcomeAnalytics {
  totalOutcomeCount: number;
  outcomeDistribution: Record<string, number>;
  candidatesWithMultipleOutcomes: string[];
  outcomesMissingRationale: string[];
  outcomesMissingEvidence: string[];
}

// ---------------------------------------------------------------------------
// computeOutcomeAnalytics
// ---------------------------------------------------------------------------

export function computeOutcomeAnalytics(
  outcomes: PolicyReviewOutcome[],
): OutcomeAnalytics {
  // Initialize distribution with all 7 types at 0
  const outcomeDistribution: Record<string, number> = {};
  for (const t of OUTCOME_TYPES) {
    outcomeDistribution[t] = 0;
  }

  // Count per-candidate outcomes
  const candidateCounts = new Map<string, number>();
  const outcomesMissingRationale: string[] = [];
  const outcomesMissingEvidence: string[] = [];

  for (const outcome of outcomes) {
    outcomeDistribution[outcome.outcomeType] = (outcomeDistribution[outcome.outcomeType] ?? 0) + 1;
    candidateCounts.set(outcome.candidateId, (candidateCounts.get(outcome.candidateId) ?? 0) + 1);

    if (!outcome.rationale || outcome.rationale.trim().length === 0) {
      outcomesMissingRationale.push(outcome.outcomeId);
    }
    if (!outcome.evidenceRefs || outcome.evidenceRefs.length === 0) {
      outcomesMissingEvidence.push(outcome.outcomeId);
    }
  }

  // Deterministic sort for arrays
  outcomesMissingRationale.sort();
  outcomesMissingEvidence.sort();

  const candidatesWithMultipleOutcomes = Array.from(candidateCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([candidateId]) => candidateId)
    .sort();

  return {
    totalOutcomeCount: outcomes.length,
    outcomeDistribution,
    candidatesWithMultipleOutcomes,
    outcomesMissingRationale,
    outcomesMissingEvidence,
  };
}
