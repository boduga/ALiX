/**
 * P5.3.6 — ConfidenceCalibrationAnalyzer.
 *
 * Buckets assessed proposals by sourceConfidence into 10 decile ranges and
 * computes per-bucket outcome metrics (keep rate, revert rate, failure rate).
 * Also computes the Spearman rank correlation between sourceConfidence and
 * the binary "keep" outcome.
 *
 * Pure compute — no I/O, no mutations, no stores.
 *
 * @module
 */

import type {
  EnrichedProposal,
  ConfidenceBucket,
  ConfidenceCalibration,
} from "./intelligence-types.js";

// ---------------------------------------------------------------------------
// Bucket definitions
// ---------------------------------------------------------------------------

interface BucketDef {
  range: string;
  low: number;
  high: number;
}

const BUCKETS: BucketDef[] = [
  { range: "0.0-0.1", low: 0.0, high: 0.1 },
  { range: "0.1-0.2", low: 0.1, high: 0.2 },
  { range: "0.2-0.3", low: 0.2, high: 0.3 },
  { range: "0.3-0.4", low: 0.3, high: 0.4 },
  { range: "0.4-0.5", low: 0.4, high: 0.5 },
  { range: "0.5-0.6", low: 0.5, high: 0.6 },
  { range: "0.6-0.7", low: 0.6, high: 0.7 },
  { range: "0.7-0.8", low: 0.7, high: 0.8 },
  { range: "0.8-0.9", low: 0.8, high: 0.9 },
  { range: "0.9-1.0", low: 0.9, high: 1.0 },
];

/**
 * Assign a confidence value to the correct bucket index (0-9).
 * rangeLow inclusive; rangeHigh exclusive for all buckets except the
 * 0.9-1.0 bucket which is inclusive on both ends.
 */
function bucketIndex(confidence: number): number {
  // Edge case: 1.0 belongs to the last bucket
  if (confidence === 1.0) return 9;
  // All other values: floor to the nearest 0.1
  if (confidence < 0) return 0;
  const idx = Math.floor(confidence * 10);
  return Math.min(Math.max(idx, 0), 9);
}

// ---------------------------------------------------------------------------
// Spearman rank correlation
// ---------------------------------------------------------------------------

/**
 * Compute Spearman's rank correlation coefficient between two arrays.
 *
 * Algorithm:
 * 1. Convert each array to ranks (handling ties with average rank).
 * 2. Compute Pearson correlation on the ranks.
 *
 * Returns a value between -1 and 1.
 */
export function spearmanRankCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;

  // Rank x values
  const xRanks = rankArray(xs);
  // Rank y values
  const yRanks = rankArray(ys);

  // Compute Pearson correlation on ranks
  const meanXR = xRanks.reduce((a, b) => a + b, 0) / n;
  const meanYR = yRanks.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xRanks[i] - meanXR;
    const dy = yRanks[i] - meanYR;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return 0;
  return cov / Math.sqrt(varX * varY);
}

/**
 * Convert an array of numbers to ranks, with ties receiving the average rank.
 *
 * Example: [3, 1, 2, 1] → [3.5, 1.5, 2, 1.5]
 */
function rankArray(values: number[]): number[] {
  const n = values.length;

  // Create index-value pairs, sort by value
  const indexed: Array<{ value: number; idx: number }> = values.map(
    (v, i) => ({ value: v, idx: i }),
  );
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(n);

  let i = 0;
  while (i < n) {
    // Find the extent of this tie group
    let j = i;
    while (j < n && indexed[j].value === indexed[i].value) {
      j++;
    }
    // Ranks for positions i..j-1: average of (i+1) through j
    // Since ranks are 1-based, the sum of ranks i..j-1 is:
    //   sum_{k=i}^{j-1} (k+1) = (i+1 + j) * (j-i) / 2
    const avgRank = (i + 1 + j) / 2; // (first rank + last rank) / 2
    for (let k = i; k < j; k++) {
      ranks[indexed[k].idx] = avgRank;
    }
    i = j;
  }

  return ranks;
}

// ---------------------------------------------------------------------------
// ConfidenceCalibrationAnalyzer
// ---------------------------------------------------------------------------

export class ConfidenceCalibrationAnalyzer {
  /**
   * Analyze assessed proposals, bucketing them by sourceConfidence decile and
   * computing per-bucket outcome metrics plus the Spearman rank correlation
   * between confidence and keep outcome.
   *
   * @param proposals - All enriched proposals (will be filtered to those with
   *   an effectiveness report).
   * @param minBucketSize - Minimum proposals per bucket before metrics are
   *   reported (default 5). Buckets with fewer proposals are marked
   *   insufficientData.
   */
  analyze(
    proposals: EnrichedProposal[],
    minBucketSize = 5,
  ): ConfidenceCalibration {
    // 1. Filter to assessed proposals (those with an effectiveness report)
    const assessed = proposals.filter((ep) => ep.effectivenessReport !== null);

    // 2. Initialize empty buckets
    const buckets: ConfidenceBucket[] = BUCKETS.map((def) => ({
      range: def.range,
      rangeLow: def.low,
      rangeHigh: def.high,
      totalProposals: 0,
      insufficientData: true,
    }));

    // 3. Assign each assessed proposal to a bucket
    for (const ep of assessed) {
      const idx = bucketIndex(ep.proposal.sourceConfidence);
      buckets[idx].totalProposals++;
    }

    // 4. Compute per-bucket metrics for buckets with sufficient data
    //    We need to reassign proposals to compute the metrics
    //    Build a map: bucketIndex → proposals[]
    const bucketProposals: EnrichedProposal[][] = Array.from(
      { length: 10 },
      () => [],
    );
    for (const ep of assessed) {
      const idx = bucketIndex(ep.proposal.sourceConfidence);
      bucketProposals[idx].push(ep);
    }

    for (let i = 0; i < 10; i++) {
      const b = buckets[i];
      if (b.totalProposals < minBucketSize) {
        // Already set insufficientData: true; leave metrics undefined
        continue;
      }

      b.insufficientData = false;

      const props = bucketProposals[i];
      const keepCount = props.filter(
        (ep) => ep.effectivenessReport!.recommendation === "keep",
      ).length;
      const advisoryRevertCount = props.filter(
        (ep) => ep.effectivenessReport!.recommendation === "revert",
      ).length;
      const applyFailureCount = props.filter(
        (ep) => ep.proposal.status === "failed",
      ).length;
      const actualRevertCount = props.filter((ep) => ep.wasReverted).length;

      const total = b.totalProposals;
      b.keepCount = keepCount;
      b.keepRate = keepCount / total;
      b.advisoryRevertCount = advisoryRevertCount;
      b.advisoryRevertRate = advisoryRevertCount / total;
      b.applyFailureCount = applyFailureCount;
      b.applyFailureRate = applyFailureCount / total;
      b.actualRevertCount = actualRevertCount;
      b.actualRevertRate = actualRevertCount / total;
    }

    // 5. Compute confidenceOutcomeCorrelation
    const confidenceOutcomeCorrelation =
      computeConfidenceOutcomeCorrelation(assessed);

    return {
      buckets,
      totalAssessed: assessed.length,
      confidenceOutcomeCorrelation,
    };
  }
}

// ---------------------------------------------------------------------------
// Correlation helper
// ---------------------------------------------------------------------------

/**
 * Compute Spearman rank correlation between sourceConfidence and binary keep
 * outcome across all assessed proposals.
 *
 * Returns null if fewer than 10 data points OR if all proposals fall into a
 * single confidence bucket (no variance).
 */
function computeConfidenceOutcomeCorrelation(
  assessed: EnrichedProposal[],
): number | null {
  if (assessed.length < 10) return null;

  // Check for variance: all in same bucket?
  const uniqueBuckets = new Set(
    assessed.map((ep) => bucketIndex(ep.proposal.sourceConfidence)),
  );
  if (uniqueBuckets.size <= 1) return null;

  // Build [confidence, isKeep] pairs
  const confidences: number[] = [];
  const keepOutcomes: number[] = [];

  for (const ep of assessed) {
    confidences.push(ep.proposal.sourceConfidence);
    keepOutcomes.push(
      ep.effectivenessReport!.recommendation === "keep" ? 1 : 0,
    );
  }

  return spearmanRankCorrelation(confidences, keepOutcomes);
}
