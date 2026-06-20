/**
 * P5.3.7 — BucketAggregator
 *
 * Groups enriched proposals across six dimensions, delegates per-bucket
 * statistics to EffectivenessTrendAnalyzer, and assembles the six BucketSet
 * outputs consumed by IntelligenceReporter.
 *
 * @module
 */

import type { EnrichedProposal, BucketSet } from "./intelligence-types.js";
import type { EffectivenessTrendAnalyzer } from "./effectiveness-trend-analyzer.js";

export class BucketAggregator {
  constructor(
    private readonly trendAnalyzer: EffectivenessTrendAnalyzer,
  ) {}

  aggregate(
    proposals: EnrichedProposal[],
    opts?: { minBucketSize?: number },
  ): {
    byAction: BucketSet;
    byTargetKind: BucketSet;
    bySourceRecommendationType: BucketSet;
    byProvenance: BucketSet;
    byCapability: BucketSet;
    byOutcome: BucketSet;
  } {
    return {
      byAction: this.computeDimension(
        proposals,
        "byAction",
        opts,
        (ep) => ep.proposal.action,
      ),
      byTargetKind: this.computeDimension(
        proposals,
        "byTargetKind",
        opts,
        (ep) => ep.proposal.target.kind,
      ),
      bySourceRecommendationType: this.computeDimension(
        proposals,
        "bySourceRecommendationType",
        opts,
        (ep) => ep.proposal.sourceRecommendationType,
      ),
      byProvenance: this.computeDimension(
        proposals,
        "byProvenance",
        opts,
        (ep) => ep.proposal.provenance ?? "manual",
      ),
      byCapability: this.computeDimension(
        proposals,
        "byCapability",
        opts,
        (ep) =>
          (ep.proposal.payload?.capability as string | undefined) ??
          (ep.proposal.target as { capability?: string }).capability ??
          "(none)",
      ),
      byOutcome: this.computeDimension(
        proposals,
        "byOutcome",
        opts,
        (ep) => ep.outcome,
      ),
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private computeDimension(
    proposals: EnrichedProposal[],
    dimension: string,
    opts: { minBucketSize?: number } | undefined,
    keyFn: (ep: EnrichedProposal) => string,
  ): BucketSet {
    // Group proposals by the dimension key
    const groups = new Map<string, EnrichedProposal[]>();
    for (const ep of proposals) {
      const key = keyFn(ep);
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(ep);
      } else {
        groups.set(key, [ep]);
      }
    }

    // Compute per-bucket stats
    const buckets = Array.from(groups.entries()).map(([key, group]) => {
      const stat = this.trendAnalyzer.analyze(group, opts?.minBucketSize);
      stat.value = key;
      return stat;
    });

    // Sort alphabetically by value
    buckets.sort((a, b) => a.value.localeCompare(b.value));

    const totalInDimension = buckets.reduce(
      (sum, b) => sum + b.totalProposals,
      0,
    );
    const insufficientDataCount = buckets.filter(
      (b) => b.insufficientData,
    ).length;

    return { dimension, buckets, totalInDimension, insufficientDataCount };
  }
}
