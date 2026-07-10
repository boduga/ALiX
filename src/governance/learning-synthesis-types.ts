/**
 * P27.1 — Learning Synthesis Types.
 *
 * Trace model for P24→P25→P26 correlation. DriftOutcomeTrace joins
 * outcome records to candidates to embedded signal metadata using only
 * recorded relationships. Partial traces permitted when artifacts missing.
 *
 * Primary invariant: descriptive governance intelligence only.
 * No prescriptive fields. No causation claims. No predictive scores.
 */

// ---------------------------------------------------------------------------
// DriftOutcomeTrace — single correlated record
// ---------------------------------------------------------------------------

export interface DriftOutcomeTrace {
  outcomeId: string;
  candidateId: string;
  signalId: string;

  // P24 signal metadata (from candidate.source)
  signalKind: string;
  signalSeverity: string;
  signalDirection: string;
  windowStart: string;
  windowEnd: string;

  // P25 candidate metadata
  candidateTitle: string;
  candidateStatus: string;
  candidateCreatedAt: string;
  candidateClosedAt: string;

  // P26 outcome metadata
  outcomeType: string;
  outcomeRecordedAt: string;
  outcomeRationale: string;

  // Derived
  timeToReviewDays: number;
  timeToOutcomeDays: number;
}

// ---------------------------------------------------------------------------
// Correlation analytics
// ---------------------------------------------------------------------------

export interface DriftCorrelationAnalytics {
  totalOutcomes: number;
  outcomeBySignalKind: Record<string, Record<string, number>>;
  outcomeBySeverity: Record<string, Record<string, number>>;
  timeStats: { avgTimeToReviewDays: number; avgTimeToOutcomeDays: number };
  repeatedPatterns: string[];
  traceCompleteness: number;
  missingOutcomes: number;
}

// ---------------------------------------------------------------------------
// LearningSynthesisReport — descriptive only, never prescriptive
// ---------------------------------------------------------------------------

export interface LearningSynthesisReport {
  reportId: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;

  totalSignals: number;
  totalCandidates: number;
  totalOutcomes: number;

  outcomeBySignalKind: Record<string, Record<string, number>>;
  outcomeBySeverity: Record<string, Record<string, number>>;
  timeStats: { avgTimeToReviewDays: number; avgTimeToOutcomeDays: number };
  traceCompleteness: number;
  missingOutcomes: number;
  repeatedPatterns: string[];
  confidenceByOutcome: Record<string, number>;
  signalKindFrequency: Record<string, number>;

  footnotes: string[];

  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
