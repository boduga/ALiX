/**
 * P5.3.8 — IntelligenceReporter: orchestrates the P5.3 analysis pipeline.
 *
 * Coordinates all analyzers, assembles the IntelligenceReport, generates the
 * executive summary, and persists the report to disk.
 *
 * Pure orchestration — no mutations, no evidence writes, no proposal creation.
 *
 * @module
 */

import type {
  EnrichedProposal,
  IntelligenceReport,
  IntelligenceOptions,
  BucketSet,
  BucketStat,
  BucketReference,
  DataWindow,
} from "./intelligence-types.js";
import type { ProposalLifecycleAnalyzer } from "./proposal-lifecycle-analyzer.js";
import type { BucketAggregator } from "./bucket-aggregator.js";
import type { RevertSignalAnalyzer } from "./revert-signal-analyzer.js";
import type { ConfidenceCalibrationAnalyzer } from "./confidence-calibration-analyzer.js";
import type { IntelligenceStore } from "./intelligence-store.js";

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------

export class IntelligenceReporter {
  constructor(
    private readonly lifecycleAnalyzer: ProposalLifecycleAnalyzer,
    private readonly bucketAggregator: BucketAggregator,
    private readonly revertSignalAnalyzer: RevertSignalAnalyzer,
    private readonly confidenceCalibrationAnalyzer: ConfidenceCalibrationAnalyzer,
    private readonly intelligenceStore: IntelligenceStore,
  ) {}

  /**
   * Run the full P5.3 analysis pipeline and produce an IntelligenceReport.
   *
   * Steps:
   *   1. Load and enrich proposals via ProposalLifecycleAnalyzer.
   *   2. Aggregate into bucket sets via BucketAggregator.
   *   3. Compute revert signal via RevertSignalAnalyzer.
   *   4. Compute confidence calibration via ConfidenceCalibrationAnalyzer.
   *   5. Assemble the report, generate executive summary, persist.
   */
  async generateReport(opts?: IntelligenceOptions): Promise<IntelligenceReport> {
    // 1. Enrich proposals
    const enriched = await this.lifecycleAnalyzer.analyze(opts);

    // 2. Aggregate buckets
    const bucketSets = this.bucketAggregator.aggregate(enriched, opts);

    // 3. Revert signal analysis
    const revertSignal = this.revertSignalAnalyzer.analyze(enriched, bucketSets);

    // 4. Confidence calibration
    const confidence = this.confidenceCalibrationAnalyzer.analyze(enriched, opts?.minBucketSize);

    // 5. Data window
    const dataWindow = computeDataWindow(enriched);

    // 6. Top / lowest performing buckets
    const allStats = collectBucketStats(bucketSets);
    const topPerforming = computeTopPerforming(allStats, 5);
    const lowestPerforming = computeLowestPerforming(allStats, 5);

    // 7. Executive summary
    const executiveSummary = generateExecutiveSummary(enriched, bucketSets, confidence, revertSignal);

    // 8. Assemble report
    const report: IntelligenceReport = {
      generatedAt: new Date().toISOString(),
      totalProposalsAnalyzed: enriched.length,
      dataWindow,
      executiveSummary,
      buckets: bucketSets,
      confidenceCalibration: confidence,
      revertSignalAnalysis: revertSignal,
      topPerforming,
      lowestPerforming,
    };

    // 9. Persist
    await this.intelligenceStore.save(report);

    return report;
  }
}

// ---------------------------------------------------------------------------
// Data window
// ---------------------------------------------------------------------------

function computeDataWindow(proposals: EnrichedProposal[]): DataWindow {
  if (proposals.length === 0) {
    return {
      oldestProposalCreatedAt: "",
      newestProposalCreatedAt: "",
      oldestEffectivenessAssessedAt: null,
    };
  }

  const createdAtDates = proposals.map((ep) => new Date(ep.proposal.createdAt).getTime());
  const assessedDates = proposals
    .filter((ep) => ep.effectivenessReport !== null)
    .map((ep) => new Date(ep.effectivenessReport!.assessedAt).getTime());

  return {
    oldestProposalCreatedAt: new Date(Math.min(...createdAtDates)).toISOString(),
    newestProposalCreatedAt: new Date(Math.max(...createdAtDates)).toISOString(),
    oldestEffectivenessAssessedAt:
      assessedDates.length > 0
        ? new Date(Math.min(...assessedDates)).toISOString()
        : null,
  };
}

// ---------------------------------------------------------------------------
// Top / lowest performing
// ---------------------------------------------------------------------------

/** Collect every bucket from every dimension into a flat list. */
function collectBucketStats(bucketSets: Record<string, BucketSet>): BucketStat[] {
  const all: BucketStat[] = [];
  for (const [dimension, set] of Object.entries(bucketSets)) {
    for (const bucket of set.buckets) {
      // Tag with dimension for reference
      all.push({ ...bucket, _dimension: dimension } as BucketStat & { _dimension: string });
    }
  }
  return all;
}

function computeTopPerforming(
  allStats: (BucketStat & { _dimension?: string })[],
  count: number,
): BucketReference[] {
  return allStats
    .filter((s) => !s.insufficientData && s.keepRate !== undefined)
    .sort((a, b) => (b.keepRate ?? 0) - (a.keepRate ?? 0))
    .slice(0, count)
    .map((s) => ({
      dimension: (s as BucketStat & { _dimension: string })._dimension ?? "",
      value: s.value,
      keepRate: s.keepRate ?? 0,
      total: s.totalProposals,
    }));
}

function computeLowestPerforming(
  allStats: (BucketStat & { _dimension?: string })[],
  count: number,
): BucketReference[] {
  return allStats
    .filter((s) => !s.insufficientData && s.keepRate !== undefined)
    .sort((a, b) => (a.keepRate ?? 0) - (b.keepRate ?? 0))
    .slice(0, count)
    .map((s) => ({
      dimension: (s as BucketStat & { _dimension: string })._dimension ?? "",
      value: s.value,
      keepRate: s.keepRate ?? 0,
      total: s.totalProposals,
    }));
}

// ---------------------------------------------------------------------------
// Executive summary generation
// ---------------------------------------------------------------------------

function generateExecutiveSummary(
  proposals: EnrichedProposal[],
  bucketSets: Record<string, BucketSet>,
  confidence: { totalAssessed: number; confidenceOutcomeCorrelation: number | null },
  revertSignal: { totalAdvisoryReverts: number; totalActualReverts: number; totalUnactedReverts: number; humansOverruledCount: number },
): string {
  if (proposals.length === 0) {
    return "No proposals found in the given date range. Run more adaptations before generating an intelligence report.";
  }

  const lines: string[] = [];

  // Opening: total proposals and data quality
  const totalWithEffectiveness = proposals.filter((ep) => ep.effectivenessReport !== null).length;
  const sufficientBuckets = countSufficientBuckets(bucketSets);

  if (sufficientBuckets === 0) {
    lines.push(
      `${proposals.length} proposals analyzed, ${totalWithEffectiveness} with effectiveness assessments. ` +
      `All buckets are below the minimum threshold — not enough data yet to draw reliable conclusions. ` +
      `Continue accumulating adaptation history; actionable patterns will emerge as the dataset grows.`,
    );

    if (totalWithEffectiveness === 0) {
      lines.push(
        "No effectiveness reports exist yet. Run `alix adaptation effectiveness` on applied proposals to generate them.",
      );
    }

    return lines.join("\n\n");
  }

  // Sufficient data exists — generate substantive summary
  const totalAssessed = proposals.filter((ep) => ep.effectivenessReport !== null).length;
  const keepCount = proposals.filter((ep) => ep.effectivenessReport?.recommendation === "keep").length;
  const revertCount = proposals.filter((ep) => ep.effectivenessReport?.recommendation === "revert").length;

  lines.push(
    `${proposals.length} proposals analyzed, ${totalAssessed} with effectiveness assessments. ` +
    `${sufficientBuckets} bucket(s) have sufficient data for reliable metrics. ` +
    `Overall keep rate: ${totalAssessed > 0 ? Math.round((keepCount / totalAssessed) * 100) : 0}% ` +
    `(${keepCount} keep, ${revertCount} revert, ${totalAssessed - keepCount - revertCount} investigate).`,
  );

  // Revert signal
  if (revertSignal.totalAdvisoryReverts > 0) {
    const actedPct = Math.round(
      ((revertSignal.totalAdvisoryReverts - revertSignal.totalUnactedReverts) / revertSignal.totalAdvisoryReverts) * 100,
    );
    lines.push(
      `Revert signal: ${revertSignal.totalAdvisoryReverts} advisory reverts, ` +
      `${revertSignal.totalActualReverts} executed (${actedPct}% action rate). ` +
      `${revertSignal.totalUnactedReverts} advisory reverts still unaddressed.`,
    );

    if (revertSignal.humansOverruledCount > 0) {
      lines.push(
        `Humans overruled effectiveness on ${revertSignal.humansOverruledCount} proposal(s) ` +
        `that were assessed as "keep" but later reverted.`,
      );
    }
  } else {
    lines.push("No revert signals detected — all proposals either kept or had insufficient data.");
  }

  // Confidence calibration
  if (confidence.totalAssessed >= 10 && confidence.confidenceOutcomeCorrelation !== null) {
    const corrDesc =
      confidence.confidenceOutcomeCorrelation > 0.3
        ? "positive correlation"
        : confidence.confidenceOutcomeCorrelation < -0.3
          ? "negative correlation"
          : "weak or no correlation";
    lines.push(
      `Confidence calibration: ${confidence.totalAssessed} proposals with sourceConfidence data ` +
      `show ${corrDesc} between confidence and keep rate ` +
      `(${confidence.confidenceOutcomeCorrelation.toFixed(2)}).`,
    );
  }

  return lines.join("\n\n");
}

/** Count how many buckets across all dimensions have sufficient data. */
function countSufficientBuckets(bucketSets: Record<string, BucketSet>): number {
  let count = 0;
  for (const set of Object.values(bucketSets)) {
    for (const bucket of set.buckets) {
      if (!bucket.insufficientData) count++;
    }
  }
  return count;
}
