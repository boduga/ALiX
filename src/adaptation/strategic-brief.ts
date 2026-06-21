/**
 * P6.3 — StrategicBriefBuilder: pure synthesis class.
 *
 * Takes pre-built StrategicBriefInput and returns a StrategicBrief with
 * trends, hotspots, findings, and strategic actions derived from historical
 * intelligence, effectiveness, and evidence data.
 *
 * No store access, no builder imports, no evaluation logic.
 * Deterministic: same inputs in any order → same outputs.
 * No proposal IDs appear in findings, trends, hotspots, or strategicActions.
 *
 * @module
 */

import type {
  StrategicBrief,
  StrategicBriefInput,
  StrategicBriefOptions,
  StrategicFinding,
  Trend,
  Hotspot,
  TimeWindow,
} from "./strategic-brief-types.js";
import type { SourceArtifact } from "./decision-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TARGET_SAMPLE_SIZE = 30;
const HIGH_REVERT_THRESHOLD = 0.15;
const WINDOW_MS_MAP: Record<number, number> = {
  30: 30 * 24 * 60 * 60 * 1000,
  90: 90 * 24 * 60 * 60 * 1000,
  180: 180 * 24 * 60 * 60 * 1000,
};
const DEFAULT_WINDOW = 30;
const OUTCOME_BRIEF = "brief";

// ---------------------------------------------------------------------------
// StrategicBriefBuilder
// ---------------------------------------------------------------------------

export class StrategicBriefBuilder {
  /**
   * Build a StrategicBrief from historical intelligence, effectiveness,
   * and evidence records.
   *
   * Pure function — no stores, no side effects.
   * Deterministic for same inputs + same generatedAt.
   *
   * @param input - Pre-assembled decision artifacts per pending proposal
   * @param options - Optional window size and generatedAt override
   * @returns StrategicBrief with window-filtered trends, hotspots, findings
   */
  build(input: StrategicBriefInput, options?: StrategicBriefOptions): StrategicBrief {
    const windowSize = options?.window ?? DEFAULT_WINDOW;
    const generatedAt = options?.generatedAt ?? new Date().toISOString();
    const windowMs = WINDOW_MS_MAP[windowSize];
    const windowEnd = new Date(generatedAt);
    const windowStart = new Date(windowEnd.getTime() - windowMs);

    const period: TimeWindow = {
      start: windowStart.toISOString(),
      end: generatedAt,
    };

    // Filter inputs to the window
    const windowedInput = this.#filterByWindow(input, windowStart, windowEnd);

    // Detect trends from intelligence reports
    const trends = this.#detectTrends(windowedInput.intelligenceReports);

    // Identify hotspots from effectiveness reports
    const hotspots = this.#identifyHotspots(windowedInput.effectivenessReports);

    // Generate system warnings
    const findings = this.#generateFindings(windowedInput, trends, hotspots);

    // Compute confidence
    const sampleSize = this.#computeSampleSize(windowedInput);
    const confidence = Math.min(1, sampleSize / TARGET_SAMPLE_SIZE);

    // Build aggregate sourceArtifacts — no proposal IDs leak through
    const intelCount = windowedInput.intelligenceReports.length;
    const effCount = windowedInput.effectivenessReports.length;
    const evCount = windowedInput.evidenceRecords.length;
    const sourceArtifacts: SourceArtifact[] = [
      ...(intelCount > 0
        ? [{ type: "intelligence" as const, id: `intelligence:${intelCount}:${period.start}:${period.end}`, timestamp: generatedAt }]
        : []),
      ...(effCount > 0
        ? [{ type: "effectiveness" as const, id: `effectiveness:${effCount}:${period.start}:${period.end}`, timestamp: generatedAt }]
        : []),
      ...(evCount > 0
        ? [{ type: "proposal" as const, id: `evidence:${evCount}:${period.start}:${period.end}`, timestamp: generatedAt }]
        : []),
    ];

    // Build strategic actions from findings
    const strategicActions = this.#buildStrategicActions(findings, hotspots);

    return {
      id: `brief:${generatedAt}:${windowSize}d`,
      subject: `Strategic Brief — Last ${windowSize} days`,
      outcome: OUTCOME_BRIEF,
      confidence,
      reasons: this.#buildConfidenceReasons(sampleSize, windowedInput),
      evidenceRefs: [
        `intelligence:${windowedInput.intelligenceReports.length}`,
        `effectiveness:${windowedInput.effectivenessReports.length}`,
        `evidence:${windowedInput.evidenceRecords.length}`,
      ],
      generatedAt,
      period,
      findings,
      trends,
      hotspots,
      strategicActions,
      sourceArtifacts,
    };
  }

  // ---- private helpers ----

  /**
   * Filter input data to only include records within the rolling window.
   */
  #filterByWindow(
    input: StrategicBriefInput,
    start: Date,
    end: Date,
  ): StrategicBriefInput {
    return {
      intelligenceReports: input.intelligenceReports.filter((r) => {
        const t = new Date(r.generatedAt).getTime();
        return t >= start.getTime() && t <= end.getTime();
      }),
      effectivenessReports: input.effectivenessReports.filter((r) => {
        const t = new Date(r.assessedAt).getTime();
        return t >= start.getTime() && t <= end.getTime();
      }),
      evidenceRecords: input.evidenceRecords.filter((r) => {
        const t = new Date(r.timestamp).getTime();
        return t >= start.getTime() && t <= end.getTime();
      }),
    };
  }

  /**
   * Detect metric trends from intelligence report data.
   * Compares oldest vs newest report within the window.
   * Returns empty array when fewer than 2 reports available.
   */
  #detectTrends(reports: StrategicBriefInput["intelligenceReports"]): Trend[] {
    if (reports.length < 2) return [];

    // Sort by generatedAt ascending
    const sorted = [...reports].sort(
      (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime(),
    );

    const oldest = sorted[0];
    const newest = sorted[sorted.length - 1];
    const trends: Trend[] = [];

    // Trend: keep rate by action type (compare topPerforming/lowestPerforming)
    // ponytail: simple keep-rate trend from top-level references
    const oldBestKeep = oldest.topPerforming[0]?.keepRate ?? 0;
    const newBestKeep = newest.topPerforming[0]?.keepRate ?? 0;
    const keepDelta = newBestKeep - oldBestKeep;
    if (Math.abs(keepDelta) > 0.05) {
      trends.push({
        metric: "top-performing action keep rate",
        direction: keepDelta > 0 ? "increasing" : "decreasing",
        magnitude: Math.abs(keepDelta),
        sampleSize: Math.max(oldest.totalProposalsAnalyzed, newest.totalProposalsAnalyzed),
      });
    }

    // Trend: confidence calibration drift — compare first confidence bucket's range
    if (oldest.confidenceCalibration.buckets.length > 0 && newest.confidenceCalibration.buckets.length > 0) {
      const oldHighBucket = oldest.confidenceCalibration.buckets[oldest.confidenceCalibration.buckets.length - 1];
      const newHighBucket = newest.confidenceCalibration.buckets[newest.confidenceCalibration.buckets.length - 1];
      const oldKeepInHigh = oldHighBucket.keepRate ?? 0;
      const newKeepInHigh = newHighBucket.keepRate ?? 0;
      const calDelta = newKeepInHigh - oldKeepInHigh;
      if (Math.abs(calDelta) > 0.05) {
        trends.push({
          metric: "high-confidence outcome keep rate",
          direction: calDelta > 0 ? "increasing" : "decreasing",
          magnitude: Math.abs(calDelta),
          sampleSize: Math.max(oldHighBucket.totalProposals, newHighBucket.totalProposals),
        });
      }
    }

    // Trend: revert signal trend
    if (oldest.revertSignalAnalysis.totalAdvisoryReverts !== newest.revertSignalAnalysis.totalAdvisoryReverts) {
      const oldRate = oldest.totalProposalsAnalyzed > 0
        ? oldest.revertSignalAnalysis.totalAdvisoryReverts / oldest.totalProposalsAnalyzed
        : 0;
      const newRate = newest.totalProposalsAnalyzed > 0
        ? newest.revertSignalAnalysis.totalAdvisoryReverts / newest.totalProposalsAnalyzed
        : 0;
      const revertDelta = newRate - oldRate;
      if (Math.abs(revertDelta) > 0.05) {
        trends.push({
          metric: "advisory revert rate",
          direction: revertDelta > 0 ? "increasing" : "decreasing",
          magnitude: Math.abs(revertDelta),
          sampleSize: Math.max(oldest.totalProposalsAnalyzed, newest.totalProposalsAnalyzed),
        });
      }
    }

    return trends;
  }

  /**
   * Identify hotspots from effectiveness reports.
   * Flags areas where revert rates exceed threshold or recommendation
   * patterns suggest concentration.
   */
  #identifyHotspots(reports: StrategicBriefInput["effectivenessReports"]): Hotspot[] {
    if (reports.length === 0) return [];

    const hotspots: Hotspot[] = [];

    // ponytail: group by recommendation and check revert rates
    // Effectiveness reports don't carry action type at the interface level,
    // so relatedActionTypes uses "unknown" — extend when richer data is available.
    const byRecommendation = new Map<string, { total: number; revert: number }>();
    for (const report of reports) {
      const key = report.recommendation;
      if (!byRecommendation.has(key)) {
        byRecommendation.set(key, { total: 0, revert: 0 });
      }
      const entry = byRecommendation.get(key)!;
      entry.total++;
      if (report.recommendation === "revert") entry.revert++;
    }

    for (const [rec, data] of byRecommendation) {
      const revertRate = data.total > 0 ? data.revert / data.total : 0;
      if (revertRate > HIGH_REVERT_THRESHOLD) {
        hotspots.push({
          area: `${rec} recommendation concentration`,
          severity: revertRate > 0.3 ? "high" : "medium",
          relatedActionTypes: ["unknown"],
          evidence: `${data.revert}/${data.total} effectiveness reports recommend revert (${(revertRate * 100).toFixed(0)}%)`,
        });
      }
    }

    return hotspots;
  }

  /**
   * Generate strategic findings from the windowed input data.
   * Findings are descriptive, not prescriptive — they describe patterns.
   * No proposal IDs appear in findings.
   */
  #generateFindings(
    windowed: StrategicBriefInput,
    trends: Trend[],
    hotspots: Hotspot[],
  ): StrategicFinding[] {
    const findings: StrategicFinding[] = [];

    // System warnings based on data quality
    if (windowed.intelligenceReports.length === 0) {
      findings.push({
        category: "system_warning",
        summary: "No intelligence reports available in this window",
        detail: "Trend analysis is limited without intelligence data. Run `alix adaptation intelligence` to generate reports.",
        confidence: 1,
        evidenceRefs: [],
      });
    }

    if (windowed.effectivenessReports.length === 0) {
      findings.push({
        category: "system_warning",
        summary: "No effectiveness reports available in this window",
        detail: "Hotspot detection is limited without effectiveness data. Effectiveness reports are generated by the P5.2 assessment pipeline.",
        confidence: 1,
        evidenceRefs: [],
      });
    }

    // Add trend-based findings
    for (const trend of trends) {
      findings.push({
        category: "trend",
        summary: `${trend.metric} is ${trend.direction}`,
        detail: `Magnitude: ${(trend.magnitude * 100).toFixed(0)}%, based on ${trend.sampleSize} proposal(s)`,
        confidence: Math.min(1, trend.sampleSize / TARGET_SAMPLE_SIZE),
        evidenceRefs: [],
      });
    }

    // Add hotspot-based findings
    for (const hotspot of hotspots) {
      findings.push({
        category: "hotspot",
        summary: `Hotspot: ${hotspot.area}`,
        detail: hotspot.evidence,
        confidence: hotspot.severity === "high" ? 0.9 : 0.7,
        evidenceRefs: [],
      });
    }

    // Add strategic observations
    if (windowed.intelligenceReports.length > 0) {
      const latestReport = windowed.intelligenceReports[windowed.intelligenceReports.length - 1];
      if (latestReport.executiveSummary) {
        findings.push({
          category: "strategic_observation",
          summary: "Intelligence summary available for context",
          detail: latestReport.executiveSummary,
          confidence: 0.8,
          evidenceRefs: [],
        });
      }
    }

    return findings;
  }

  /**
   * Compute the effective sample size from all input sources.
   */
  #computeSampleSize(windowed: StrategicBriefInput): number {
    return (
      windowed.intelligenceReports.length +
      windowed.effectivenessReports.length +
      windowed.evidenceRecords.length
    );
  }

  /**
   * Build confidence rationale reasons.
   */
  #buildConfidenceReasons(
    sampleSize: number,
    windowed: StrategicBriefInput,
  ): string[] {
    const reasons: string[] = [];
    reasons.push(
      `Data sufficiency: ${sampleSize} total records (${TARGET_SAMPLE_SIZE} target) = ${Math.min(1, sampleSize / TARGET_SAMPLE_SIZE) < 1 ? "below target" : "at or above target"}`,
    );
    reasons.push(`Intelligence reports in window: ${windowed.intelligenceReports.length}`);
    reasons.push(`Effectiveness reports in window: ${windowed.effectivenessReports.length}`);
    reasons.push(`Evidence records in window: ${windowed.evidenceRecords.length}`);
    return reasons;
  }

  /**
   * Build strategic action areas from findings and hotspots.
   * These are action-type or capability-area level recommendations,
   * NOT per-proposal directives.
   */
  #buildStrategicActions(
    findings: StrategicFinding[],
    hotspots: Hotspot[],
  ): string[] {
    const actions: string[] = [];

    for (const hotspot of hotspots) {
      if (hotspot.severity === "high") {
        actions.push(
          `Investigate rising ${hotspot.area} — consider governance or process adjustments`,
        );
      } else {
        actions.push(
          `Monitor ${hotspot.area} for escalation`,
        );
      }
    }

    if (findings.filter((f) => f.category === "system_warning").length > 0) {
      actions.push(
        "Improve data collection to enable more reliable strategic analysis",
      );
    }

    return actions;
  }
}
