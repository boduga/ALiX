/**
 * P5.3.5 — RevertSignalAnalyzer
 *
 * Computes top-level revert signal analysis across all enriched proposals:
 * advisory vs actual reverts, revert precision, unacted revert hotspots,
 * and human overruled counts.
 *
 * @module
 */

import type {
  EnrichedProposal,
  BucketSet,
  RevertSignalAnalysis,
} from "./intelligence-types.js";

// ---------------------------------------------------------------------------
// Bucket-value extraction per dimension
// ---------------------------------------------------------------------------

/** Maps a dimension name to a function that extracts the bucket value from an EnrichedProposal. */
type BucketExtractor = (ep: EnrichedProposal) => string | null;

const BUCKET_EXTRACTORS: Record<string, BucketExtractor> = {
  byAction: (ep) => ep.proposal.action,
  byTargetKind: (ep) => ep.proposal.target.kind,
  bySourceRecommendationType: (ep) => ep.proposal.sourceRecommendationType,
  byProvenance: (ep) => ep.proposal.provenance ?? "manual",
  byCapability: (ep) =>
    ep.proposal.target.kind === "capability"
      ? ep.proposal.target.capability
      : null,
  byOutcome: (ep) => ep.outcome,
};

// ---------------------------------------------------------------------------
// Analyzer
// ---------------------------------------------------------------------------

export class RevertSignalAnalyzer {
  /**
   * Compute cross-proposal revert signal analysis.
   *
   * @param proposals     Array of enriched proposals to analyze.
   * @param bucketSets    Pre-computed bucket sets (used for dimension discovery;
   *                      bucket values themselves are recomputed from raw proposals
   *                      for accuracy in `topUnactedRevertBuckets`).
   * @param minBucketSize Minimum total proposals a bucket must have to appear in
   *                      `topUnactedRevertBuckets`. Defaults to 1 (include all).
   */
  analyze(
    proposals: EnrichedProposal[],
    bucketSets: {
      byAction: BucketSet;
      byTargetKind: BucketSet;
      bySourceRecommendationType: BucketSet;
      byProvenance: BucketSet;
      byCapability: BucketSet;
      byOutcome: BucketSet;
    },
    minBucketSize = 1,
  ): RevertSignalAnalysis {
    // --- 1. totalAdvisoryReverts ---
    const totalAdvisoryReverts = proposals.filter(
      (ep) => ep.effectivenessReport?.recommendation === "revert",
    ).length;

    // --- 2. totalActualReverts ---
    const totalActualReverts = proposals.filter(
      (ep) => ep.wasReverted === true,
    ).length;

    // --- 3. totalUnactedReverts ---
    const totalUnactedReverts = Math.max(
      0,
      totalAdvisoryReverts - totalActualReverts,
    );

    // --- 4. revertPrecision ---
    let revertPrecision: number | null = null;
    if (totalActualReverts > 0) {
      const alignedCount = proposals.filter(
        (ep) =>
          ep.wasReverted === true &&
          ep.effectivenessReport?.recommendation === "revert",
      ).length;
      revertPrecision = alignedCount / totalActualReverts;
    }

    // --- 5. topUnactedRevertBuckets ---
    const dimensions = Object.keys(bucketSets) as Array<keyof typeof bucketSets>;
    const bucketUnactedMap = new Map<
      string,
      { dimension: string; value: string; count: number; total: number }
    >();

    for (const dimension of dimensions) {
      const extractor = BUCKET_EXTRACTORS[dimension];
      if (!extractor) continue;

      // Group proposals by bucket value for this dimension
      const grouped = new Map<string, EnrichedProposal[]>();
      for (const ep of proposals) {
        const value = extractor(ep);
        if (value === null) continue;
        if (!grouped.has(value)) grouped.set(value, []);
        grouped.get(value)!.push(ep);
      }

      // Compute unacted revert count per bucket
      for (const [value, bucketProposals] of grouped) {
        const unactedCount = bucketProposals.filter(
          (ep) =>
            ep.effectivenessReport?.recommendation === "revert" &&
            ep.wasReverted === false,
        ).length;

        if (unactedCount > 0) {
          const key = `${dimension}:${value}`;
          const existing = bucketUnactedMap.get(key);
          if (existing) {
            existing.count += unactedCount;
            existing.total += bucketProposals.length;
          } else {
            bucketUnactedMap.set(key, {
              dimension,
              value,
              count: unactedCount,
              total: bucketProposals.length,
            });
          }
        }
      }
    }

    const topUnactedRevertBuckets = Array.from(bucketUnactedMap.values())
      .filter((b) => b.total >= minBucketSize)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map(({ dimension, value, count }) => ({ dimension, value, count }));

    // --- 6. humansOverruledCount ---
    const humansOverruledCount = proposals.filter(
      (ep) =>
        ep.effectivenessReport?.recommendation === "keep" &&
        ep.wasReverted === true,
    ).length;

    return {
      totalAdvisoryReverts,
      totalActualReverts,
      totalUnactedReverts,
      revertPrecision,
      topUnactedRevertBuckets,
      humansOverruledCount,
    };
  }
}
