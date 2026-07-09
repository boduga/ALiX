/**
 * P24.1 — Governance Calibration & Policy Drift Types.
 *
 * Read-only calibration signal types for governance policy drift analysis.
 * No stores, no fs, no execution adapters, no audit emitters.
 *
 * PolicyDriftSignal ≠ DriftFinding.
 * PolicyDriftSignal is the rich internal diagnostic.
 * DriftFinding is the external/report-compatible projection (handled by
 * drift-finding-adapter.ts).
 */

// ---------------------------------------------------------------------------
// Signal kind, direction, severity
// ---------------------------------------------------------------------------

export type PolicyDriftSignalKind =
  | "calibration_skew"
  | "replay_divergence"
  | "convergent_gap"
  | "trend_direction"
  | "evidence_coverage"
  | "volatility";

export type PolicyDriftDirection =
  | "too_loose"
  | "too_strict"
  | "stale"
  | "unstable"
  | "improving"
  | "insufficient_evidence"
  | "neutral";

export type PolicyDriftSeverity = "none" | "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// Evidence reference
// ---------------------------------------------------------------------------

export interface PolicyDriftEvidenceRef {
  source: "p22_calibration" | "p23_replay_diff" | "p23_candidate_lesson";
  lifecycleId?: string;
  handoffId?: string;
  replayId?: string;
  basis?: string;
}

// ---------------------------------------------------------------------------
// Trend metadata
// ---------------------------------------------------------------------------

export interface PolicyDriftTrend {
  previousWindowStart: string;
  previousWindowEnd: string;
  previousValue: number;
  currentValue: number;
  delta: number;
  direction: "improving" | "degrading" | "stable" | "insufficient_history";
}

// ---------------------------------------------------------------------------
// PolicyDriftSignal — the rich internal diagnostic
// ---------------------------------------------------------------------------

export interface PolicyDriftSignal {
  signalId: string;
  kind: PolicyDriftSignalKind;
  windowStart: string;
  windowEnd: string;
  direction: PolicyDriftDirection;
  severity: PolicyDriftSeverity;
  confidence: number;

  sampleSize: {
    p22CalibrationCount: number;
    p23ReplayCount: number;
    pairedLifecycleCount: number;
  };

  rates: {
    overconfidentRate?: number;
    underconfidentRate?: number;
    accurateRate?: number;
    readinessChangedRate?: number;
    blockedInCounterfactualRate?: number;
    evidenceGapChangedRate?: number;
    convergentGapRate?: number;
  };

  trend?: PolicyDriftTrend;

  implicatedPolicyAreas: string[];
  evidenceRefs: PolicyDriftEvidenceRef[];
  rationale: string[];
}

// ---------------------------------------------------------------------------
// Threshold configuration
// ---------------------------------------------------------------------------

export interface CalibrationSkewThreshold {
  medium: { minRate: number; minSampleSize: number };
  high:   { minRate: number; minSampleSize: number };
}

export interface ReplayDivergenceThreshold {
  medium: { minRate: number; minReplayCount: number };
  high:   { minRate: number; minReplayCount: number };
}

export interface ConvergentGapThreshold {
  medium: { minRate: number; minPairedCount: number };
  high:   { minRate: number; minPairedCount: number };
}

export interface PolicyDriftThresholds {
  calibrationSkew: CalibrationSkewThreshold;
  replayDivergence: ReplayDivergenceThreshold;
  convergentGap: ConvergentGapThreshold;
}

export const DEFAULT_POLICY_DRIFT_THRESHOLDS: PolicyDriftThresholds = {
  calibrationSkew: {
    medium: { minRate: 0.60, minSampleSize: 10 },
    high:   { minRate: 0.70, minSampleSize: 20 },
  },
  replayDivergence: {
    medium: { minRate: 0.40, minReplayCount: 10 },
    high:   { minRate: 0.60, minReplayCount: 20 },
  },
  convergentGap: {
    medium: { minRate: 0.30, minPairedCount: 8 },
    high:   { minRate: 0.50, minPairedCount: 12 },
  },
};

// ---------------------------------------------------------------------------
// Boundary artifact (applied to externally-exposed outputs only)
// ---------------------------------------------------------------------------

export interface PolicyDriftBoundaryFlags {
  readonly readOnly: true;
  readonly noPolicyMutation: true;
  readonly noThresholdChange: true;
  readonly noAutoAdoption: true;
  readonly noRanking: true;
}
