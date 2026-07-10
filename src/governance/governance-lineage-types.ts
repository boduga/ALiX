/**
 * P30.1 — Lineage Types.
 *
 * Foundation types for evidence navigation and lineage browsing:
 * - 6 shallow phase refs (SignalRef, CandidateRef, OutcomeRef, TraceRef,
 *   ExplanationRef, ComplianceRef) — each carries just enough for navigation
 *   without embedding full phase objects.
 * - LineageRecord: aggregated lineage with phasePresence (p24–p29) and
 *   boundary flags.
 * - LineageIndex: 4 lookup maps for byCandidateId, bySignalKind,
 *   byOutcomeType, byCompliancePackageId.
 *
 * All types are pure data — no stores, no fs, no execution adapters.
 * Boundary flags are readonly literal `true` to enforce compile-time safety.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Shallow phase refs (p24–p29)
// ---------------------------------------------------------------------------

/**
 * Shallow reference to a P24 policy-drift signal.
 * Carries only the fields needed for navigation.
 */
export interface SignalRef {
  /** Unique identifier for the signal. */
  signalId: string;
  /** Signal kind (e.g. calibration_skew, replay_divergence). */
  signalKind: string;
  /** ISO-8601 end of the signal's observation window. */
  windowEnd: string;
}

/**
 * Shallow reference to a P25 policy-review candidate.
 * Carries only the fields needed for navigation.
 */
export interface CandidateRef {
  /** Unique identifier for the candidate. */
  candidateId: string;
  /** Human-readable title. */
  title: string;
  /** Current lifecycle status. */
  status: string;
}

/**
 * Shallow reference to a P26 policy-review outcome.
 * Carries only the fields needed for navigation.
 */
export interface OutcomeRef {
  /** Unique identifier for the outcome. */
  outcomeId: string;
  /** The candidate this outcome was recorded against. */
  candidateId: string;
  /** Outcome type (e.g. accepted_for_policy_work, dismissed_no_change). */
  outcomeType: string;
}

/**
 * Shallow reference to a P27 trace linking an outcome to its signal.
 * Carries only the fields needed for navigation.
 */
export interface TraceRef {
  /** The outcome side of the traced link. */
  outcomeId: string;
  /** The candidate side of the traced link. */
  candidateId: string;
  /** The signal kind that originated the traced flow. */
  signalKind: string;
}

/**
 * Shallow reference to a P28 governance explanation.
 * Carries only the fields needed for navigation.
 */
export interface ExplanationRef {
  /** Unique identifier for the explanation. */
  explanationId: string;
  /** Explanation type (correlation, gain, drift, anomaly). */
  type: string;
}

/**
 * Shallow reference to a P29 compliance package.
 * Carries only the fields needed for navigation.
 */
export interface ComplianceRef {
  /** Unique identifier for the compliance package. */
  packageId: string;
  /** ISO-8601 start of the reporting window. */
  windowStart: string;
  /** ISO-8601 end of the reporting window. */
  windowEnd: string;
}

// ---------------------------------------------------------------------------
// LineageRecord
// ---------------------------------------------------------------------------

/**
 * Aggregated lineage record that maps which phases have data for
 * a particular evidence lineage, plus shallow refs into each phase.
 *
 * Each phase ref is deliberately shallow — never embed full phase objects.
 * Consumers navigate deeper via the phase-specific stores.
 */
export interface LineageRecord {
  /** Unique identifier for this lineage record. */
  lineageId: string;
  /** ISO-8601 timestamp when this lineage was assembled. */
  assembledAt: string;

  /** Which P24–P29 phases have data in this lineage. */
  phasePresence: {
    p24: boolean;
    p25: boolean;
    p26: boolean;
    p27: boolean;
    p28: boolean;
    p29: boolean;
  };

  // ---- Shallow phase refs ----

  /** Optional reference to P24 signal. */
  signalRef?: SignalRef;
  /** Optional reference to P25 candidate. */
  candidateRef?: CandidateRef;
  /** Optional reference to P26 outcome. */
  outcomeRef?: OutcomeRef;
  /** Optional reference to P27 trace. */
  traceRef?: TraceRef;
  /** Optional reference to P28 explanation. */
  explanationRef?: ExplanationRef;
  /** Optional reference to P29 compliance package. */
  complianceRef?: ComplianceRef;

  // ---- Boundary flags (all readonly literal `true`) ----

  /** Prevents mutation of governance state through this record. */
  readonly readOnly: true;
  /** Prevents policy mutation through this record. */
  readonly noPolicyMutation: true;
  /** Prevents threshold changes through this record. */
  readonly noThresholdChange: true;
  /** Prevents auto-adoption of proposals through this record. */
  readonly noAutoAdoption: true;
  /** Prevents ranking changes through this record. */
  readonly noRanking: true;
}

// ---------------------------------------------------------------------------
// LineageIndex
// ---------------------------------------------------------------------------

/**
 * Index maps for quick lookup of lineage records by various keys.
 *
 * All maps are `Map<string, string[]>` where the key is the lookup dimension
 * and the value is an array of lineageId values matching that key.
 */
export interface LineageIndex {
  /** Maps candidateId → lineageId[]. */
  byCandidateId: Map<string, string[]>;
  /** Maps signalKind → lineageId[]. */
  bySignalKind: Map<string, string[]>;
  /** Maps outcomeType → lineageId[]. */
  byOutcomeType: Map<string, string[]>;
  /** Maps compliance packageId → lineageId[]. */
  byCompliancePackageId: Map<string, string[]>;
}
