/**
 * P6.6a — PipelineHealthBuilder pure computation.
 *
 * Pure function (build) that computes a PipelineHealthReport from a
 * PipelineHealthInput. No side effects, no storage, no I/O.
 *
 * Health rules (worst wins):
 *   attention_needed: proposalStore unavailable or broken lineage present
 *   degraded: non-foundational store missing, stale proposals, strategic brief
 *             unavailable with data, or low confidence with samples
 *   healthy: none of the above
 *
 * @module
 */

import type {
  PipelineHealthInput,
  PipelineHealthReport,
  PipelineHealthStatus,
} from "./pipeline-health-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Proposals older than this many days are considered stale. */
const STALE_THRESHOLD_DAYS = 30;

/** Confidence averages below this threshold signal degradation. */
const LOW_CONFIDENCE_THRESHOLD = 0.3;

/** Allowed window sizes. */
const VALID_WINDOWS = new Set<number>([30, 90, 180]);

/** Default window when not specified or invalid. */
const DEFAULT_WINDOW_DAYS = 30;

/** The outcome field for all PipelineHealthReport artifacts. */
const OUTPUT_OUTCOME = "observed";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface HealthBuilderOptions {
  /** ISO-8601 timestamp for the report (defaults to now). */
  generatedAt?: string;
  /** Analysis window in days (30, 90, or 180; defaults to 30). */
  windowDays?: number;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class PipelineHealthBuilder {
  /**
   * Build a PipelineHealthReport from the given input.
   *
   * Pure computation — referentially transparent for the same input and options.
   */
  build(
    input: PipelineHealthInput,
    options?: HealthBuilderOptions,
  ): PipelineHealthReport {
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const windowDays = this.#validateWindow(options?.windowDays);

    const scoped = this.#computeScopedProposals(input.scopedProposalInputs);
    const health = this.#computeHealth(input, scoped);
    const healthSignals = this.#computeSignals(input, scoped);

    const evidenceRefs = [
      `proposals:${input.proposalCounts.total}`,
      `effects:${input.effectivenessReports}`,
      `events:${input.lifecycleEvents.total}`,
    ];

    return {
      // DecisionArtifact fields
      id: `status:${generatedAt}:${windowDays}d`,
      subject: `Pipeline Health — Last ${windowDays} days`,
      outcome: OUTPUT_OUTCOME,
      confidence:
        scoped.total > 0 ? Math.min(1, scoped.total / 10) : 1,
      reasons: this.#buildReasons(health, scoped, input),
      warnings:
        healthSignals.length > 0
          ? healthSignals.map((s) => ({ message: s.message, severity: s.severity }))
          : undefined,
      evidenceRefs,
      generatedAt,

      // PipelineHealthReport-specific fields
      windowDays: windowDays as PipelineHealthReport["windowDays"],
      health,
      healthSignals,
      storeAvailability: { ...input.storeAvailability },
      storeErrors: input.storeErrors,
      proposalCounts: { ...input.proposalCounts },
      scopedProposals: scoped,
      effectivenessReports: input.effectivenessReports,
      intelligenceReports: input.intelligenceReports,
      lifecycleEvents: { ...input.lifecycleEvents },
      strategicBrief: { ...input.strategicBrief },
      governanceReview: {
        frameworkAvailable: true,
        liveLensExecutionAvailable: false,
        persistedReviews: false,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Validate and clamp the windowDays option.
   */
  #validateWindow(raw?: number): number {
    if (raw !== undefined && VALID_WINDOWS.has(raw)) return raw;
    return DEFAULT_WINDOW_DAYS;
  }

  /**
   * Aggregate per-proposal scoped data into the report shape.
   */
  #computeScopedProposals(
    inputs: PipelineHealthInput["scopedProposalInputs"],
  ): PipelineHealthReport["scopedProposals"] {
    let staleCount = 0;
    let brokenCount = 0;
    let contextSum = 0;
    let riskSum = 0;
    let riskCount = 0;
    let recSum = 0;
    let recCount = 0;
    let newest = Infinity;
    let oldest = 0;

    for (const p of inputs) {
      // Staleness
      if (p.ageDays > STALE_THRESHOLD_DAYS) staleCount++;

      // Lineage
      if (p.lineageCompleteness === "broken") brokenCount++;

      // Confidence sums
      contextSum += p.contextConfidence;
      if (p.riskConfidence !== undefined) {
        riskSum += p.riskConfidence;
        riskCount++;
      }
      if (p.recommendationConfidence !== undefined) {
        recSum += p.recommendationConfidence;
        recCount++;
      }

      // Data freshness
      if (p.dataFreshness.newestDays < newest) newest = p.dataFreshness.newestDays;
      if (p.dataFreshness.oldestDays > oldest) oldest = p.dataFreshness.oldestDays;
    }

    return {
      total: inputs.length,
      staleProposals: staleCount,
      brokenLineage: brokenCount,
      confidence: {
        contextAvg: inputs.length > 0 ? contextSum / inputs.length : 0,
        riskAvg: riskCount > 0 ? riskSum / riskCount : undefined,
        recommendationAvg:
          recCount > 0 ? recSum / recCount : undefined,
        sampleSize: inputs.length,
      },
      dataFreshness: {
        newestDays: newest === Infinity ? null : newest,
        oldestDays: oldest === 0 ? null : oldest,
      },
    };
  }

  /**
   * Determine overall health status from input and computed scoped data.
   *
   * Priority: attention_needed > degraded > healthy. Worst wins.
   */
  #computeHealth(
    input: PipelineHealthInput,
    scoped: PipelineHealthReport["scopedProposals"],
  ): PipelineHealthStatus {
    // ---- attention_needed (highest priority) ----
    if (input.storeAvailability.proposalStore === false) {
      return "attention_needed";
    }
    if (scoped.brokenLineage > 0) {
      return "attention_needed";
    }

    // ---- degraded ----

    // Non-foundational store unavailable
    if (
      input.storeAvailability.evidenceStore === false ||
      input.storeAvailability.effectivenessStore === false ||
      input.storeAvailability.intelligenceStore === false
    ) {
      return "degraded";
    }

    // Stale proposals
    if (scoped.staleProposals > 0) {
      return "degraded";
    }

    // Strategic brief unavailable with enough data
    const enoughData =
      scoped.total > 0 ||
      input.effectivenessReports > 0 ||
      input.intelligenceReports > 0 ||
      input.lifecycleEvents.total > 0;
    if (!input.strategicBrief.available && enoughData) {
      return "degraded";
    }

    // Low confidence with actual samples
    if (scoped.confidence.sampleSize > 0) {
      if (scoped.confidence.contextAvg < LOW_CONFIDENCE_THRESHOLD) {
        return "degraded";
      }
      if (
        scoped.confidence.recommendationAvg !== undefined &&
        scoped.confidence.recommendationAvg < LOW_CONFIDENCE_THRESHOLD
      ) {
        return "degraded";
      }
    }

    // ---- healthy ----
    return "healthy";
  }

  /**
   * Build structured health signals from input and computed scoped data.
   */
  #computeSignals(
    input: PipelineHealthInput,
    scoped: PipelineHealthReport["scopedProposals"],
  ): PipelineHealthReport["healthSignals"] {
    const signals: PipelineHealthReport["healthSignals"] = [];

    // No proposals at all
    if (scoped.total === 0) {
      signals.push({
        severity: "info",
        message: "No proposals in window — pipeline has no active work to observe",
      });
    }

    // Stale proposals
    if (scoped.staleProposals > 0) {
      signals.push({
        severity: "warning",
        message: `${scoped.staleProposals} stale proposal${scoped.staleProposals > 1 ? "s" : ""} (>${STALE_THRESHOLD_DAYS}d) — may need age-based prioritization`,
      });
    }

    // Broken lineage
    if (scoped.brokenLineage > 0) {
      signals.push({
        severity: "critical",
        message: `${scoped.brokenLineage} proposal${scoped.brokenLineage > 1 ? "s" : ""} with broken lineage — unable to verify provenance`,
      });
    }

    // Low context confidence
    if (
      scoped.confidence.sampleSize > 0 &&
      scoped.confidence.contextAvg < LOW_CONFIDENCE_THRESHOLD
    ) {
      signals.push({
        severity: "warning",
        message: `Average context confidence (${scoped.confidence.contextAvg.toFixed(2)}) below threshold (${LOW_CONFIDENCE_THRESHOLD})`,
      });
    }

    // Low recommendation confidence
    if (
      scoped.confidence.recommendationAvg !== undefined &&
      scoped.confidence.recommendationAvg < LOW_CONFIDENCE_THRESHOLD
    ) {
      signals.push({
        severity: "warning",
        message: `Average recommendation confidence (${scoped.confidence.recommendationAvg.toFixed(2)}) below threshold (${LOW_CONFIDENCE_THRESHOLD})`,
      });
    }

    // Strategic brief unavailable with enough data
    const enoughData =
      scoped.total > 0 ||
      input.effectivenessReports > 0 ||
      input.intelligenceReports > 0 ||
      input.lifecycleEvents.total > 0;
    if (!input.strategicBrief.available && enoughData) {
      signals.push({
        severity: "warning",
        message:
          "Strategic brief unavailable — pipeline lacks long-horizon synthesis",
      });
    }

    // Store availability signals
    if (!input.storeAvailability.proposalStore) {
      signals.push({
        severity: "critical",
        message: "ProposalStore unavailable — cannot observe pipeline state",
      });
    }
    if (!input.storeAvailability.evidenceStore) {
      signals.push({
        severity: "warning",
        message: "EvidenceStore unavailable — lifecycle events not observable",
      });
    }
    if (!input.storeAvailability.effectivenessStore) {
      signals.push({
        severity: "warning",
        message:
          "EffectivenessStore unavailable — effectiveness data not observable",
      });
    }
    if (!input.storeAvailability.intelligenceStore) {
      signals.push({
        severity: "warning",
        message:
          "IntelligenceStore unavailable — intelligence data not observable",
      });
    }

    return signals;
  }

  /**
   * Build human-readable reasons summarizing the report.
   */
  #buildReasons(
    health: PipelineHealthStatus,
    scoped: PipelineHealthReport["scopedProposals"],
    input: PipelineHealthInput,
  ): string[] {
    const reasons: string[] = [];
    reasons.push(`Status: ${health}`);
    reasons.push(
      `Proposals: ${input.proposalCounts.total} total (${input.proposalCounts.pending} pending)`,
    );
    reasons.push(`Scoped proposals: ${scoped.total}`);
    reasons.push(`Effectiveness reports: ${input.effectivenessReports}`);
    reasons.push(`Intelligence reports: ${input.intelligenceReports}`);
    reasons.push(
      `Lifecycle events: ${input.lifecycleEvents.total} total (${input.lifecycleEvents.inWindow} in window)`,
    );
    reasons.push(
      `Strategic brief: ${input.strategicBrief.available ? `available (${input.strategicBrief.findings} findings)` : "unavailable"}`,
    );
    return reasons;
  }
}
