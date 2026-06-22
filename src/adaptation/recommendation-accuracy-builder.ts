/**
 * P7b — RecommendationAccuracyBuilder.
 *
 * Pure accuracy computation from outcome records. No I/O, no store access,
 * no side effects. Deterministic — same inputs always produce the same output.
 *
 * @module
 */

import type { OutcomeRecord } from "./outcome-types.js";
import type { RecommendationAccuracyReport } from "./outcome-types.js";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class RecommendationAccuracyBuilder {
  /**
   * Build an accuracy report from outcome records.
   *
   * Counts all five outcome values and computes success/failure/partial-success
   * rates over known (non-unknown) outcomes only. When there are no known
   * outcomes, all rates are zero.
   *
   * @param records  Outcome records to analyze (typically pre-filtered by window).
   * @param options  Optional windowDays override and generatedAt timestamp.
   */
  build(
    records: OutcomeRecord[],
    options?: { windowDays?: number; generatedAt?: string },
  ): RecommendationAccuracyReport {
    const windowDays = options?.windowDays ?? 30;
    const generatedAt = options?.generatedAt ?? new Date().toISOString();

    // Count each outcome value
    const outcomeDistribution: Record<string, number> = {
      success: 0,
      partial_success: 0,
      neutral: 0,
      failure: 0,
      unknown: 0,
    };

    for (const record of records) {
      const key = record.outcome;
      outcomeDistribution[key] = (outcomeDistribution[key] ?? 0) + 1;
    }

    const totalOutcomes = records.length;
    const unknownCount = outcomeDistribution.unknown;
    const knownOutcomes = totalOutcomes - unknownCount;

    // Compute rates from known outcomes only. Guard against division by zero.
    let successRate = 0;
    let partialSuccessRate = 0;
    let failureRate = 0;

    if (knownOutcomes > 0) {
      successRate = outcomeDistribution.success / knownOutcomes;
      partialSuccessRate = outcomeDistribution.partial_success / knownOutcomes;
      failureRate = outcomeDistribution.failure / knownOutcomes;
    }

    return {
      windowDays,
      generatedAt,
      totalOutcomes,
      outcomeDistribution: outcomeDistribution as RecommendationAccuracyReport["outcomeDistribution"],
      accuracy: {
        knownOutcomes,
        successRate,
        partialSuccessRate,
        failureRate,
      },
    };
  }
}
