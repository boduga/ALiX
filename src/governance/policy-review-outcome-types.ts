/**
 * P26.1 — Policy Review Outcome Types.
 *
 * Types append-only outcome records on P25 policy review candidates.
 * P25 remains lifecycle authority. P26 records human review outcomes
 * only — it never mutates candidates, transitions state, or makes
 * lifecycle decisions.
 */

// ---------------------------------------------------------------------------
// Outcome type
// ---------------------------------------------------------------------------

export type PolicyReviewOutcomeType =
  | "accepted_for_policy_work"
  | "dismissed_no_change"
  | "deferred_needs_more_evidence"
  | "superseded_by_newer_candidate"
  | "closed_as_duplicate"
  | "closed_out_of_scope"
  | "closed_no_action";

export const OUTCOME_TYPES: readonly PolicyReviewOutcomeType[] = [
  "accepted_for_policy_work",
  "dismissed_no_change",
  "deferred_needs_more_evidence",
  "superseded_by_newer_candidate",
  "closed_as_duplicate",
  "closed_out_of_scope",
  "closed_no_action",
];

// ---------------------------------------------------------------------------
// Outcome record
// ---------------------------------------------------------------------------

export interface PolicyReviewOutcome {
  outcomeId: string;
  candidateId: string;
  candidateTitle: string;
  outcomeType: PolicyReviewOutcomeType;
  recordedAt: string;
  recordedBy: string;
  rationale: string;
  evidenceRefs: string[];
  candidateStateAtRecording: string;
  linkedEventIds: string[];
  notes: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Outcome filter for list queries
// ---------------------------------------------------------------------------

export interface OutcomeFilter {
  candidateId?: string;
  outcomeType?: PolicyReviewOutcomeType;
}

// ---------------------------------------------------------------------------
// Ledger interface
// ---------------------------------------------------------------------------

export interface PolicyReviewOutcomeLedger {
  recordOutcome(opts: {
    candidateId: string;
    candidateTitle?: string;
    candidateStateAtRecording?: string;
    linkedEventIds?: string[];
    outcomeType: PolicyReviewOutcomeType;
    recordedBy: string;
    rationale: string;
    evidenceRefs?: string[];
    notes?: string;
  }): Promise<PolicyReviewOutcome>;

  listOutcomes(filter?: OutcomeFilter): Promise<PolicyReviewOutcome[]>;

  getOutcome(outcomeId: string): Promise<PolicyReviewOutcome | null>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_OUTCOME_ROOT = ".alix/governance/policy-review-outcomes";
