/**
 * P10.8c — Predictive Signal Correlation.
 *
 * Correlates recommendation subsystem targets with later outcome report
 * SubsystemDeltas. Answers: how well do recommendation signals predict
 * subsystem health changes?
 *
 * Pure functions + CorrelationMatcher interface — no I/O, no mutation.
 * CLI handler owns store reads.
 *
 * @module
 */

import type { RecommendationEntry } from "./recommendation-effectiveness.js";
import type { ExecutiveOutcomeEvaluationReport, SubsystemDelta } from "./outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CorrelationMode = "strict" | "loose";

export interface SubsystemCorrelationEntry {
  reportId: string;
  generatedAt: string;
  recIndex: number;
  subsystem: string;
  signal: string;
  severity: string;
  signalConfidence: number;
  recommendationDisposition?: string;
  outcomeReportId: string;
  outcomeGeneratedAt: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
  lagDays: number;
}

export interface ConfidenceBucket {
  range: string;
  low: number;
  high: number;
  recommendationCount: number;
  matchedDeltaCount: number;
  averageDelta: number;
  averageAbsoluteDelta: number;
  improvingRate: number;
}

export interface SubsystemCorrelation {
  subsystem: string;
  recommendationCount: number;
  outcomeReportCount: number;
  matchedRecommendationCount: number;
  matchedDeltaCount: number;
  uncorrelatedRecommendationCount: number;
  averageDelta: number;
  averageAbsoluteDelta: number;
  improvingCount: number;
  degradingCount: number;
  unchangedCount: number;
  netDelta: number;
  correlationEffectiveness: number;
  confidenceBuckets: ConfidenceBucket[];
}

export interface SignalCorrelation {
  signal: string;
  recommendationCount: number;
  matchedRecommendationCount: number;
  matchedDeltaCount: number;
  averageDelta: number;
  averageAbsoluteDelta: number;
  improvingRate: number;
  coverageRate: number;
  confidenceBuckets: ConfidenceBucket[];
}

export const PSC_OK = "ok";
export const PSC_PARTIAL = "partial";
export const PSC_NO_DATA = "no_data";

export interface SubsystemCorrelationReport {
  correlationStatus: typeof PSC_OK | typeof PSC_PARTIAL | typeof PSC_NO_DATA;
  correlationMode: CorrelationMode;
  correlationLagDays: number;
  reportGeneratedAt: string;
  outcomeReportCount: number;
  totalRecommendations: number;
  matchedRecommendationCount: number;
  unmatchedRecommendationCount: number;
  subsystemCorrelations: SubsystemCorrelation[];
  signalCorrelations: SignalCorrelation[];
  correlations: SubsystemCorrelationEntry[];
  loadWarnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CORRELATION_LAG_DAYS = 30;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// CorrelationMatcher interface
// ---------------------------------------------------------------------------

export interface CorrelationMatcher {
  match(
    rec: RecommendationEntry,
    reports: readonly ExecutiveOutcomeEvaluationReport[],
  ): Promise<Array<{ report: ExecutiveOutcomeEvaluationReport; delta: SubsystemDelta }>>;
}

// ---------------------------------------------------------------------------
// SubsystemTimeMatcher
// ---------------------------------------------------------------------------

export class SubsystemTimeMatcher implements CorrelationMatcher {
  constructor(
    private readonly mode: CorrelationMode,
    private readonly lagDays: number = DEFAULT_CORRELATION_LAG_DAYS,
  ) {}

  async match(
    rec: RecommendationEntry,
    reports: readonly ExecutiveOutcomeEvaluationReport[],
  ): Promise<Array<{ report: ExecutiveOutcomeEvaluationReport; delta: SubsystemDelta }>> {
    const results: Array<{ report: ExecutiveOutcomeEvaluationReport; delta: SubsystemDelta }> = [];
    const recTime = new Date(rec.generatedAt).getTime();

    for (const report of reports) {
      if (report.evaluationStatus !== "completed") continue;

      const reportTime = new Date(report.generatedAt).getTime();

      // Strict mode time gate
      if (this.mode === "strict") {
        if (reportTime <= recTime) continue;
        if (reportTime > recTime + this.lagDays * MS_PER_DAY) continue;
      }

      // Scan objectives for matching SubsystemDelta
      for (const objective of report.objectives) {
        for (const sd of objective.subsystemDeltas) {
          if (sd.subsystem !== rec.subsystem) continue;
          results.push({ report, delta: sd });
        }
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const CONFIDENCE_BUCKETS = [
  { range: "0.00-0.25", low: 0.00, high: 0.25 },
  { range: "0.25-0.50", low: 0.25, high: 0.50 },
  { range: "0.50-0.75", low: 0.50, high: 0.75 },
  { range: "0.75-1.00", low: 0.75, high: 1.00 },
];

function computeConfidenceBucket(confidence: number): string {
  if (confidence < 0.25) return "0.00-0.25";
  if (confidence < 0.50) return "0.25-0.50";
  if (confidence < 0.75) return "0.50-0.75";
  return "0.75-1.00";
}

function buildEmptyBuckets(): ConfidenceBucket[] {
  return CONFIDENCE_BUCKETS.map((b) => ({
    range: b.range, low: b.low, high: b.high,
    recommendationCount: 0, matchedDeltaCount: 0,
    averageDelta: 0, averageAbsoluteDelta: 0, improvingRate: 0,
  }));
}

function aggregateConfidenceBuckets(entries: SubsystemCorrelationEntry[]): ConfidenceBucket[] {
  const buckets = new Map<string, { deltas: number[]; absDeltas: number[]; improving: number; recCount: Set<string> }>();
  for (const b of CONFIDENCE_BUCKETS) {
    buckets.set(b.range, { deltas: [], absDeltas: [], improving: 0, recCount: new Set() });
  }
  for (const e of entries) {
    const range = computeConfidenceBucket(e.signalConfidence);
    const bucket = buckets.get(range)!;
    bucket.deltas.push(e.delta);
    bucket.absDeltas.push(Math.abs(e.delta));
    if (e.delta > 0) bucket.improving++;
    bucket.recCount.add(`${e.reportId}:${e.recIndex}`);
  }
  return CONFIDENCE_BUCKETS.map((b) => {
    const data = buckets.get(b.range)!;
    const count = data.deltas.length;
    return {
      range: b.range, low: b.low, high: b.high,
      recommendationCount: data.recCount.size,
      matchedDeltaCount: count,
      averageDelta: count > 0 ? round2(data.deltas.reduce((s, v) => s + v, 0) / count) : 0,
      averageAbsoluteDelta: count > 0 ? round2(data.absDeltas.reduce((s, v) => s + v, 0) / count) : 0,
      improvingRate: count > 0 ? round2(data.improving / count) : 0,
    };
  });
}

/** Track unique matched recommendations per group (subsystem or signal). */
function matchedRecSet(entries: SubsystemCorrelationEntry[]): Set<string> {
  const set = new Set<string>();
  for (const e of entries) set.add(`${e.reportId}:${e.recIndex}`);
  return set;
}

function aggregateBySubsystem(entries: SubsystemCorrelationEntry[]): SubsystemCorrelation[] {
  const map = new Map<string, SubsystemCorrelationEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.subsystem) ?? [];
    arr.push(e);
    map.set(e.subsystem, arr);
  }

  const correlations: SubsystemCorrelation[] = [];
  const recCountMap = new Map<string, Set<string>>();
  for (const e of entries) {
    const key = `${e.reportId}:${e.recIndex}`;
    const set = recCountMap.get(e.subsystem) ?? new Set();
    set.add(key);
    recCountMap.set(e.subsystem, set);
  }

  for (const [subsystem, matches] of map) {
    const totalDeltas = matches.reduce((sum, m) => sum + m.delta, 0);
    const totalAbsDeltas = matches.reduce((sum, m) => sum + Math.abs(m.delta), 0);
    const improving = matches.filter((m) => m.delta > 0).length;
    const degrading = matches.filter((m) => m.delta < 0).length;
    const unchanged = matches.filter((m) => m.delta === 0).length;
    const deltaCount = matches.length;
    const matchedRecs = matchedRecSet(matches).size;

    correlations.push({
      subsystem,
      recommendationCount: recCountMap.get(subsystem)?.size ?? 0,
      outcomeReportCount: new Set(matches.map((m) => m.outcomeReportId)).size,
      matchedRecommendationCount: matchedRecs,
      matchedDeltaCount: deltaCount,
      uncorrelatedRecommendationCount: 0, // filled in after aggregation
      averageDelta: deltaCount > 0 ? round2(totalDeltas / deltaCount) : 0,
      averageAbsoluteDelta: deltaCount > 0 ? round2(totalAbsDeltas / deltaCount) : 0,
      improvingCount: improving,
      degradingCount: degrading,
      unchangedCount: unchanged,
      netDelta: round2(totalDeltas),
      correlationEffectiveness: deltaCount > 0 ? round2(improving / deltaCount) : 0,
      confidenceBuckets: aggregateConfidenceBuckets(matches),
    });
  }

  return correlations;
}

function aggregateBySignal(entries: SubsystemCorrelationEntry[], totalRecsBySignal: Map<string, number>): SignalCorrelation[] {
  const map = new Map<string, SubsystemCorrelationEntry[]>();
  for (const e of entries) {
    const arr = map.get(e.signal) ?? [];
    arr.push(e);
    map.set(e.signal, arr);
  }

  const correlations: SignalCorrelation[] = [];
  for (const [signal, matches] of map) {
    const totalDeltas = matches.reduce((sum, m) => sum + m.delta, 0);
    const totalAbsDeltas = matches.reduce((sum, m) => sum + Math.abs(m.delta), 0);
    const improving = matches.filter((m) => m.delta > 0).length;
    const deltaCount = matches.length;
    const totalRecs = totalRecsBySignal.get(signal) ?? 0;
    const matchedRecs = matchedRecSet(matches).size;

    correlations.push({
      signal,
      recommendationCount: totalRecs,
      matchedRecommendationCount: matchedRecs,
      matchedDeltaCount: deltaCount,
      averageDelta: deltaCount > 0 ? round2(totalDeltas / deltaCount) : 0,
      averageAbsoluteDelta: deltaCount > 0 ? round2(totalAbsDeltas / deltaCount) : 0,
      improvingRate: deltaCount > 0 ? round2(improving / deltaCount) : 0,
      coverageRate: totalRecs > 0 ? round2(matchedRecs / totalRecs) : 0,
      confidenceBuckets: aggregateConfidenceBuckets(matches),
    });
  }

  return correlations;
}

// ---------------------------------------------------------------------------
// Main correlation function
// ---------------------------------------------------------------------------

export async function computeSubsystemCorrelation(
  recommendations: readonly RecommendationEntry[],
  outcomeReports: readonly ExecutiveOutcomeEvaluationReport[],
  matcher: CorrelationMatcher,
  correlationMode: CorrelationMode,
  correlationLagDays: number = DEFAULT_CORRELATION_LAG_DAYS,
  generatedAt: string,
): Promise<SubsystemCorrelationReport> {
  if (recommendations.length === 0 || outcomeReports.length === 0) {
    return emptyReport(PSC_NO_DATA, recommendations.length, correlationMode, correlationLagDays, generatedAt);
  }

  const entries: SubsystemCorrelationEntry[] = [];
  const matchedRecKeys = new Set<string>();
  const recCountBySignal = new Map<string, number>();

  for (const rec of recommendations) {
    recCountBySignal.set(rec.signal, (recCountBySignal.get(rec.signal) ?? 0) + 1);

    const matches = await matcher.match(rec, outcomeReports);
    if (matches.length > 0) {
      matchedRecKeys.add(`${rec.reportId}:${rec.recIndex}`);
    }

    for (const { report, delta } of matches) {
      const lagDays = Math.floor(
        (new Date(report.generatedAt).getTime() - new Date(rec.generatedAt).getTime()) / MS_PER_DAY,
      );
      entries.push({
        reportId: rec.reportId,
        generatedAt: rec.generatedAt,
        recIndex: rec.recIndex,
        subsystem: rec.subsystem,
        signal: rec.signal,
        severity: rec.severity,
        signalConfidence: rec.signalConfidence,
        recommendationDisposition: rec.disposition,
        outcomeReportId: report.generatedAt,
        outcomeGeneratedAt: report.generatedAt,
        baselineScore: delta.baselineScore,
        currentScore: delta.currentScore,
        delta: delta.delta,
        lagDays,
      });
    }
  }

  if (entries.length === 0) {
    return emptyReport(PSC_NO_DATA, recommendations.length, correlationMode, correlationLagDays, generatedAt);
  }

  const subsystemCorrelations = aggregateBySubsystem(entries);
  const matchedSubsystems = new Set(subsystemCorrelations.map((s) => s.subsystem));

  // Add zero-match entries for subsystems with recommendations but no matches
  for (const rec of recommendations) {
    if (!matchedSubsystems.has(rec.subsystem)) {
      subsystemCorrelations.push({
        subsystem: rec.subsystem,
        recommendationCount: 0,
        outcomeReportCount: 0,
        matchedRecommendationCount: 0,
        matchedDeltaCount: 0,
        uncorrelatedRecommendationCount: 0,
        averageDelta: 0,
        averageAbsoluteDelta: 0,
        improvingCount: 0,
        degradingCount: 0,
        unchangedCount: 0,
        netDelta: 0,
        correlationEffectiveness: 0,
        confidenceBuckets: buildEmptyBuckets(),
      });
      matchedSubsystems.add(rec.subsystem);
    }
  }

  // Compute recommendationCount and uncorrelated counts for all subsystem entries
  for (const sub of subsystemCorrelations) {
    const subRecs = recommendations.filter((r) => r.subsystem === sub.subsystem);
    sub.recommendationCount = subRecs.length;
    sub.uncorrelatedRecommendationCount = subRecs.length - sub.matchedRecommendationCount;
  }

  const signalCorrelations = aggregateBySignal(entries, recCountBySignal);
  const outcomeReportIds = new Set(entries.map((e) => e.outcomeReportId));
  const matchedRecommendationCount = matchedRecKeys.size;
  const unmatchedRecommendationCount = recommendations.length - matchedRecommendationCount;

  // partial if fewer than half of recs had outcome data
  const status: typeof PSC_OK | typeof PSC_PARTIAL | typeof PSC_NO_DATA = matchedRecommendationCount === 0 ? PSC_NO_DATA
    : matchedRecommendationCount < recommendations.length / 2 ? PSC_PARTIAL
    : PSC_OK;

  const report: SubsystemCorrelationReport = {
    correlationStatus: status,
    correlationMode,
    correlationLagDays,
    reportGeneratedAt: generatedAt,
    outcomeReportCount: outcomeReportIds.size,
    totalRecommendations: recommendations.length,
    matchedRecommendationCount,
    unmatchedRecommendationCount,
    subsystemCorrelations,
    signalCorrelations,
    correlations: entries,
    loadWarnings: [],
  };
  return report;
}

function emptyReport(
  status: string,
  totalRecs: number,
  mode: CorrelationMode,
  lagDays: number,
  generatedAt: string,
): SubsystemCorrelationReport {
  return {
    correlationStatus: status as typeof PSC_OK | typeof PSC_PARTIAL | typeof PSC_NO_DATA,
    correlationMode: mode,
    correlationLagDays: lagDays,
    reportGeneratedAt: generatedAt,
    outcomeReportCount: 0,
    totalRecommendations: totalRecs,
    matchedRecommendationCount: 0,
    unmatchedRecommendationCount: totalRecs,
    subsystemCorrelations: [],
    signalCorrelations: [],
    correlations: [],
    loadWarnings: [],
  };
}
