/**
 * P5.3.4 — EffectivenessTrendAnalyzer. Analyzes a single bucket of enriched proposals
 * and returns per-bucket statistics (BucketStat).
 *
 * This analyzer operates on a SINGLE bucket value group. It receives a flat array
 * of enriched proposals (all belonging to one bucket, e.g. all `update_agent_card`
 * proposals) and returns one `BucketStat` for that group.
 *
 * @module
 */
import type { EnrichedProposal, BucketStat } from "./intelligence-types.js";
import { MINIMUM_BUCKET_SIZE } from "./intelligence-types.js";

export class EffectivenessTrendAnalyzer {
  /**
   * Analyze a single bucket of enriched proposals.
   *
   * @param proposals - Flat array of enriched proposals, all belonging to one bucket value.
   * @param minBucketSize - Minimum proposals before metrics are populated (default: MINIMUM_BUCKET_SIZE).
   * @returns BucketStat — caller must set the `value` field after calling analyze.
   */
  analyze(proposals: EnrichedProposal[], minBucketSize: number = MINIMUM_BUCKET_SIZE): BucketStat {
    const totalProposals = proposals.length;
    const insufficientData = totalProposals < minBucketSize;

    const stat: BucketStat = {
      value: "", // Caller must set this — the analyzer doesn't know the bucket value.
      totalProposals,
      insufficientData,
    };

    if (insufficientData) {
      return stat;
    }

    // --- Counts ---
    let keepCount = 0;
    let advisoryRevertCount = 0;
    let investigateCount = 0;
    let notAssessedCount = 0;
    let applyFailureCount = 0;
    let rejectionCount = 0;
    let actualRevertCount = 0;
    let humansOverruledCount = 0;

    // Approval rate components
    let approvedOrAppliedCount = 0;
    let actedOnCount = 0; // status !== "pending"

    // Numeric arrays for median / mean
    const timeToApprovalValues: number[] = [];
    const timeToApplyValues: number[] = [];
    const sourceConfidenceValues: number[] = [];

    for (const ep of proposals) {
      const rec = ep.effectivenessReport?.recommendation;

      // Effectiveness recommendation counts
      if (rec === "keep") {
        keepCount++;
        if (ep.wasReverted === true) {
          humansOverruledCount++;
        }
      } else if (rec === "revert") {
        advisoryRevertCount++;
      } else if (rec === "investigate") {
        investigateCount++;
      }

      // Not-assessed count (no effectiveness report at all)
      if (ep.effectivenessReport === null) {
        notAssessedCount++;
      }

      // Lifecycle status counts
      const status = ep.proposal.status;
      if (status === "failed") {
        applyFailureCount++;
      }
      if (status === "rejected") {
        rejectionCount++;
      }
      if (status === "approved" || status === "applied") {
        approvedOrAppliedCount++;
      }
      if (status !== "pending") {
        actedOnCount++;
      }

      // Actual revert
      if (ep.wasReverted === true) {
        actualRevertCount++;
      }

      // Time metrics
      if (ep.timeToApprovalHours !== null) {
        timeToApprovalValues.push(ep.timeToApprovalHours);
      }
      if (ep.timeToApplyHours !== null) {
        timeToApplyValues.push(ep.timeToApplyHours);
      }

      // Source confidence
      sourceConfidenceValues.push(ep.proposal.sourceConfidence);
    }

    // --- Rates ---
    stat.keepCount = keepCount;
    stat.keepRate = keepCount / totalProposals;
    stat.advisoryRevertCount = advisoryRevertCount;
    stat.advisoryRevertRate = advisoryRevertCount / totalProposals;
    stat.investigateCount = investigateCount;
    stat.investigateRate = investigateCount / totalProposals;
    stat.notAssessedCount = notAssessedCount;
    stat.notAssessedRate = notAssessedCount / totalProposals;
    stat.applyFailureCount = applyFailureCount;
    stat.applyFailureRate = applyFailureCount / totalProposals;
    stat.rejectionCount = rejectionCount;
    stat.rejectionRate = rejectionCount / totalProposals;
    stat.approvalRate = actedOnCount > 0 ? approvedOrAppliedCount / actedOnCount : 0;
    stat.actualRevertCount = actualRevertCount;
    stat.actualRevertRate = actualRevertCount / totalProposals;
    stat.medianTimeToApprovalHours = median(timeToApprovalValues);
    stat.medianTimeToApplyHours = median(timeToApplyValues);
    stat.meanSourceConfidence = sourceConfidenceValues.length > 0
      ? mean(sourceConfidenceValues)
      : undefined;
    stat.humansOverruledCount = humansOverruledCount;

    return stat;
  }
}

/** Standard statistical median. Returns undefined for empty arrays. */
function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  // Even-length array: average the two middle values.
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Arithmetic mean. Returns undefined for empty arrays. */
function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
