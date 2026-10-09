/**
 * P8.5b — Dashboard integrity score.
 *
 * Pure function. No I/O, no store access, no side effects.
 * Independently testable. Reusable by P9 Meta-Governance.
 *
 * Core invariant: the score is a derived operational metric, NOT a governance
 * artifact. It must never be written back into ExplanationIntegrity, LearningStore,
 * EvidenceChain, or any governance surface. Different weightings produce different
 * scores for the same input data — it is computed for operator visibility and P9
 * input, never authoritative governance state.
 */

import type { AggregatedIntegrity, ChainAlertPanel } from "./learning-dashboard.js";

export interface IntegrityScoreInput {
  aggregatedIntegrity: AggregatedIntegrity;
  chainAlerts: ChainAlertPanel;
}

/**
 * Compute a single synthetic health score (0-100).
 *
 * Weighting:
 *   - Average completeness               40%
 *   - Evidence chain usage               30%
 *   - Missing layer penalty (inverse)    20%
 *   - Alert count penalty (inverse)      10%
 *
 * All sub-scores are 0-100; the result is a weighted sum clamped to [0, 100].
 * Round to 1 decimal place.
 */
export function computeDashboardIntegrityScore(input: IntegrityScoreInput): number {
  const { aggregatedIntegrity, chainAlerts } = input;

  // No-data guard: when no proposals exist, score deterministically returns 0.
  if (aggregatedIntegrity.totalExplanations === 0) return 0;

  // 1. Average completeness (40%)
  const completenessScore = aggregatedIntegrity.averageCompleteness;

  // 2. Evidence chain usage (30%)
  const chainScore = aggregatedIntegrity.evidenceChainUsage;

  // 3. Missing layer penalty (20%) — inverse of (1 - missing/total)
  const totalLayers = 6;
  let missingTotal = 0;
  for (const counts of Object.values(aggregatedIntegrity.layerAvailabilityCounts)) {
    missingTotal += counts.missing;
  }
  const totalLayerSlots = aggregatedIntegrity.totalExplanations * totalLayers;
  const missingRatio = totalLayerSlots > 0 ? missingTotal / totalLayerSlots : 0;
  const layerPenalty = (1 - missingRatio) * 100;

  // 4. Alert count penalty (10%)
  const alertRatio = Math.min(chainAlerts.totalAlerts / aggregatedIntegrity.totalExplanations, 1);
  const alertPenalty = (1 - alertRatio) * 100;

  const score = completenessScore * 0.40 + chainScore * 0.30 + layerPenalty * 0.20 + alertPenalty * 0.10;
  return Math.round(Math.max(0, Math.min(100, score)) * 10) / 10;
}
