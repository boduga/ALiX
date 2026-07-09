/**
 * P25.1 — Policy Review Candidate Types.
 *
 * Candidate model, event types, state machine transition map for
 * governed human-review lifecycle. Types-only module — no stores, no fs,
 * no execution adapters, no audit emitters.
 */

// ---------------------------------------------------------------------------
// Candidate status
// ---------------------------------------------------------------------------

export type PolicyReviewCandidateStatus =
  | "proposed"
  | "under_review"
  | "needs_info"
  | "deferred"
  | "accepted_for_policy_review"
  | "dismissed"
  | "closed";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type PolicyReviewCandidateEventType =
  | "candidate_opened"
  | "status_changed"
  | "note_added";

// ---------------------------------------------------------------------------
// Evidence reference (mirrors P24 PolicyDriftEvidenceRef shape)
// ---------------------------------------------------------------------------

export interface PolicyReviewEvidenceRef {
  source: string;
  lifecycleId?: string;
  handoffId?: string;
  replayId?: string;
  basis?: string;
}

// ---------------------------------------------------------------------------
// Candidate record (persisted)
// ---------------------------------------------------------------------------

export interface PolicyReviewCandidate {
  candidateId: string;

  source: {
    phase: "P24";
    signalId: string;
    signalKind: string;
    signalSeverity: string;
    signalDirection: string;
    windowStart: string;
    windowEnd: string;
  };

  title: string;
  summary: string;

  status: PolicyReviewCandidateStatus;
  createdAt: string;
  updatedAt: string;

  evidenceRefs: PolicyReviewEvidenceRef[];

  review: {
    reviewerId?: string;
    rationale?: string;
    notes: string[];
    decisionBasis: string[];
  };

  boundaries: {
    readonly readOnlyEvidence: true;
    readonly noPolicyMutation: true;
    readonly noThresholdChange: true;
    readonly noAutoAdoption: true;
    readonly noRanking: true;
    readonly requiresHumanReview: true;
  };
}

// ---------------------------------------------------------------------------
// Event record (append-only log)
// ---------------------------------------------------------------------------

export interface PolicyReviewCandidateEvent {
  eventId: string;
  candidateId: string;
  occurredAt: string;
  type: PolicyReviewCandidateEventType;
  previousStatus?: PolicyReviewCandidateStatus;
  nextStatus?: PolicyReviewCandidateStatus;
  actor?: string;
  rationale?: string;
  boundaries: {
    readonly noPolicyMutation: true;
    readonly noThresholdChange: true;
    readonly noAutoAdoption: true;
  };
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface PolicyReviewCandidateStore {
  openCandidate(opts: {
    candidate: PolicyReviewCandidate;
    rationale?: string;
  }): Promise<PolicyReviewCandidate>;

  transitionCandidate(opts: {
    candidateId: string;
    nextStatus: PolicyReviewCandidateStatus;
    rationale: string;
  }): Promise<PolicyReviewCandidate>;

  addNote(opts: {
    candidateId: string;
    note: string;
  }): Promise<PolicyReviewCandidate>;

  listCandidates(opts?: {
    status?: PolicyReviewCandidateStatus;
  }): Promise<PolicyReviewCandidate[]>;

  showCandidate(candidateId: string): Promise<{
    candidate: PolicyReviewCandidate | null;
    events: PolicyReviewCandidateEvent[];
  }>;
}

// ---------------------------------------------------------------------------
// State machine allowed transitions
// ---------------------------------------------------------------------------

export const ALLOWED_TRANSITIONS: Record<
  PolicyReviewCandidateStatus,
  PolicyReviewCandidateStatus[]
> = {
  proposed: ["under_review", "dismissed", "deferred"],
  under_review: [
    "needs_info",
    "deferred",
    "accepted_for_policy_review",
    "dismissed",
  ],
  needs_info: ["under_review", "deferred", "dismissed"],
  deferred: ["under_review", "dismissed"],
  accepted_for_policy_review: ["closed"],
  dismissed: ["closed"],
  closed: [], // terminal state
};

// ---------------------------------------------------------------------------
// Default store root
// ---------------------------------------------------------------------------

export const DEFAULT_STORE_ROOT = ".alix/governance/policy-review-candidates";
