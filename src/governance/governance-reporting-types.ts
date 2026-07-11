/**
 * P29.1 — Compliance Package & reporting types.
 *
 * Foundation types for governance compliance reporting:
 * - CompliancePackage: aggregated compliance snapshot with boundary flags
 * - 4 summary types: SignalSummary, CandidateSummary, OutcomeSummary, TraceSummary
 * - 1 execution summary type: ComplianceExecutionSummary (from X3a bridge)
 * - 2 supporting types: DriftCorrelationAnalytics, GovernanceExplanation
 *
 * All types are pure data — no stores, no fs, no execution adapters.
 * Boundary flags are readonly literal `true` to enforce compile-time safety.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Cross-module imports
// ---------------------------------------------------------------------------

import type { ComplianceExecutionSummary } from "./governance-execution-types.js";

// ---------------------------------------------------------------------------
// Supporting types (consumed by CompliancePackage)
// ---------------------------------------------------------------------------

/**
 * Analytics describing correlations between governance signals and outcomes.
 */
export interface DriftCorrelationAnalytics {
  /** Per-signal-kind to outcome-type correlation pairs. */
  signalToOutcomeCorrelations: Array<{
    signalKind: string;
    outcomeType: string;
    correlationStrength: number;
    sampleSize: number;
  }>;
  /** Aggregate evidence-coverage metrics. */
  evidenceCoverage: {
    totalSignals: number;
    withOutcome: number;
    coverageRate: number;
  };
  /** Recurring patterns observed across signals and outcomes. */
  commonPatterns: string[];
}

/**
 * An explanation for a specific governance finding, correlation, or drift.
 */
export interface GovernanceExplanation {
  explanationId: string;
  type: "correlation" | "gain" | "drift" | "anomaly";
  description: string;
  relatedIds: string[];
  confidence: number;
}

// ---------------------------------------------------------------------------
// Summary types
// ---------------------------------------------------------------------------

/**
 * Condensed view of a governance signal within a compliance window.
 */
export interface ComplianceSignalSummary {
  signalId: string;
  kind: string;
  severity: string;
  direction: string;
  windowStart: string;
  windowEnd: string;
}

/**
 * Condensed view of a policy-review candidate within a compliance window.
 */
export interface ComplianceCandidateSummary {
  candidateId: string;
  title: string;
  status: string;
  signalKind: string;
  signalSeverity: string;
  createdAt: string;
  hasOutcome: boolean;
}

/**
 * Condensed view of a governance outcome within a compliance window.
 */
export interface ComplianceOutcomeSummary {
  outcomeId: string;
  candidateId: string;
  outcomeType: string;
  recordedBy: string;
  rationale: string;
}

/**
 * Condensed trace linking an outcome back to its originating signal.
 */
export interface ComplianceTraceSummary {
  outcomeId: string;
  candidateId: string;
  signalKind: string;
  outcomeType: string;
  timeToOutcomeDays: number;
}

// ---------------------------------------------------------------------------
// CompliancePackage
// ---------------------------------------------------------------------------

/**
 * Aggregated compliance snapshot for a governance reporting window.
 *
 * Contains inventory counts, per-type summaries, correlation analytics,
 * explanations, and phase metadata. All 5 boundary flags are readonly
 * literal `true` — no consumer can mutate governance policy through
 * this structure.
 */
export interface CompliancePackage {
  /** Unique identifier for this compliance package. */
  packageId: string;
  /** ISO-8601 timestamp when this package was generated. */
  generatedAt: string;
  /** ISO-8601 start of the reporting window. */
  windowStart: string;
  /** ISO-8601 end of the reporting window. */
  windowEnd: string;

  // Inventory fields
  totalSignals: number;
  totalCandidates: number;
  totalOutcomes: number;
  totalTraces: number;

  // Summaries
  signalSummary: ComplianceSignalSummary[];
  candidateSummary: ComplianceCandidateSummary[];
  outcomeSummary: ComplianceOutcomeSummary[];
  traceSummary: ComplianceTraceSummary[];

  // Execution evidence
  executionEvidenceCount: number;
  executionOutcomes: { readonly success: number; readonly failed: number; readonly partial: number; };
  executionSummary: readonly ComplianceExecutionSummary[];

  // Analytics & explanations
  correlationAnalytics: DriftCorrelationAnalytics;
  keyExplanations: GovernanceExplanation[];

  // Phase metadata
  phasesIncluded: string[];

  // ---- Boundary flags (all readonly literal `true`) ----

  /** Prevents mutation of governance state through this package. */
  readonly readOnly: true;
  /** Prevents policy mutation through this package. */
  readonly noPolicyMutation: true;
  /** Prevents threshold changes through this package. */
  readonly noThresholdChange: true;
  /** Prevents auto-adoption of proposals through this package. */
  readonly noAutoAdoption: true;
  /** Prevents ranking changes through this package. */
  readonly noRanking: true;
}
