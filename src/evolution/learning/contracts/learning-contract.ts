/**
 * A8 — Organizational Learning contracts.
 *
 * A8 detects organizational patterns from proposal/measurement/recommendation
 * history and surfaces them as diagnostic LearningProposal artifacts.
 * A8 is read-only; the LearningProposal is structurally non-executable.
 *
 * Architectural progression (locked):
 *   adapters (read-only) → pure detectors → LearningFinding[]
 *   → LearningProposal (or null if 0 findings) → A2.5 bridge
 *   → GovernanceRecommendation(kind: "MONITOR") → A3 generateDecision
 */

// ---------------------------------------------------------------------------
// Three detector kinds (locked)
// ---------------------------------------------------------------------------

export type LearningFindingKind =
  | "underperformer"
  | "outcome-contradiction"
  | "repeated-pattern-failure";

// ---------------------------------------------------------------------------
// Reconnaissance-derived defaults (Task 1 reconnaissance)
// ---------------------------------------------------------------------------

/**
 * Reconnaissance-derived default for minimum finding cardinality.
 *
 * Source: `src/evolution/pattern-discovery/strategies/execution-failure-strategy.ts`
 * line 41 — `DEFAULT_EXECUTION_FAILURE_CONFIG.minimumOccurrences: 3`.
 *
 * Same semantic role: a pattern-discovery strategy that only emits a
 * PatternObservation when the observed count of an identity key meets a
 * minimum threshold. A8's LearningFinding has the same gate, so the
 * precedent value (3) is reused verbatim.
 */
export const DEFAULT_MIN_CARDINALITY = 3;

/**
 * Reconnaissance-derived default for evidence window duration (days).
 *
 * Source: `src/cli/commands/decision.ts` line 972 — `observationWindowDays: 30`
 * on the `OutcomeRecord` shape (A5 measurement outcome pipeline).
 *
 * Same semantic role: the rolling lookback over which outcome evidence is
 * considered when scoring a capability/proposal. A8's LearningFinding
 * `evidenceWindow` mirrors this, so the precedent value (30) is reused
 * verbatim.
 */
export const DEFAULT_EVIDENCE_WINDOW_DAYS = 30;

// ---------------------------------------------------------------------------
// LearningFinding
// ---------------------------------------------------------------------------

export interface LearningFinding {
  readonly findingId: string;
  readonly kind: LearningFindingKind;
  readonly identityKey: string;
  readonly evidenceWindow: { readonly from: string; readonly to: string };
  readonly occurrences: number;
  readonly evidenceRefs: ReadonlyArray<string>; // preserved exactly for auditability
  readonly summary: string;
}

// ---------------------------------------------------------------------------
// LearningProposal — STRUCTURALLY NON-EXECUTABLE
// ---------------------------------------------------------------------------

/**
 * Aggregate of findings from a single engine run.
 *
 * CRITICAL: this type has NO mutation/execution fields and CANNOT be
 * converted directly into a capability mutation. This is a structural
 * boundary, not a convention. A8 does NOT mutate governance config,
 * A5 measurement policy, A7 proposal-generation policy, or capability
 * mutations.
 *
 * If a future program wants A8 to recommend strategy changes, that
 * is a NEW architectural increment, not an A8 expansion.
 */
export interface LearningProposal {
  readonly proposalId: string;
  readonly generatedAt: string;
  readonly findings: ReadonlyArray<LearningFinding>;
}

// ---------------------------------------------------------------------------
// Read-only adapter contract
// ---------------------------------------------------------------------------

export interface LearningAdapter<T> {
  readonly name: string;
  list(): Promise<ReadonlyArray<T>>;
}

// ---------------------------------------------------------------------------
// Normalized adapter records (each adapter returns its own shape)
// ---------------------------------------------------------------------------

/**
 * proposal-events-adapter output: governance lifecycle events for proposals.
 * Source: EventLog capability.governance.proposal.* events (CAP-9).
 *
 * Reconciled to actual schemas (A8 wayfinder map #517 spec amendment):
 * - `proposalId` lives on the event itself (not in payload).
 * - `capabilityId` is OPTIONAL: populated only for `proposal.submitted`
 *   events (via `payload.candidate.target.id`); empty string for the
 *   other 4 event types because the payload does not carry it.
 * - `recommendation` does NOT exist on any governance payload type and
 *   is removed from this contract.
 * - `operatorId` / `operatorReason` are populated only for `proposal.approved`
 *   / `proposal.rejected` events; absent for the other 3 types.
 */
export interface ProposalGovernanceRecord {
  readonly proposalId: string;
  readonly capabilityId: string;          // empty for 4/5 event types; populated only for proposal.submitted
  readonly kind:
    | "proposal.submitted"
    | "proposal.approved"
    | "proposal.rejected"
    | "proposal.executed"
    | "proposal.execution_failed";
  readonly operatorId?: string;          // from ProposalApprovedPayload.approvedBy or ProposalRejectedPayload.rejectedBy
  readonly operatorReason?: string;       // from ProposalRejectedPayload.reason
  readonly error?: string;                // from ProposalExecutionFailedPayload.error (T5 amendment; A8 wayfinder map #517)
  readonly recordedAt: string;            // from event.timestamp
  readonly eventId: string;               // from event.seq (no public eventId field on the type union)
}

/**
 * measurement-events-adapter output: outcome events.
 * Source: EventLog capability.governance.measurement.* events (CAP-10).
 *
 * Reconciled to actual schemas (A8 wayfinder map #517 spec amendment):
 * - Measurement events are CAPABILITY-targeted, NOT proposal-targeted.
 *   `proposalId` and `sourceProposalIds` do NOT exist on the measurement
 *   payload by design. Removed from this contract.
 * - `capabilityId` reachable at `payload.measurement.capabilityId`.
 * - `outcome` is a nested object `payload.outcome.kind` (effective /
 *   ineffective / inconclusive).
 */
export interface MeasurementOutcomeRecord {
  readonly capabilityId: string;
  readonly outcome: "effective" | "ineffective" | "inconclusive";
  readonly recordedAt: string;
  readonly eventId: string;
}

/**
 * enriched-proposals-adapter output: P10.8a enriched proposal records.
 * Source: EnrichedProposal[] pipeline.
 *
 * Reconciled to actual schemas (A8 wayfinder map #517 spec amendment):
 * - `EnrichedProposal` has nested `proposal: AdaptationProposal`, not flat fields.
 * - `proposalId` from `proposal.id`.
 * - `capabilityId` from `proposal.target` (ProposalTarget union; may not be
 *   capability-typed). For non-capability targets, capabilityId is "".
 * - `recordedAt` from `proposal.createdAt` (closest analogue; EnrichedProposal
 *   itself has no timestamp).
 */
export interface EnrichedProposalRecord {
  readonly proposalId: string;
  readonly capabilityId: string;          // "" if proposal.target is not capability-typed
  readonly enrichedFields: ReadonlyArray<string>;
  readonly recordedAt: string;            // from proposal.createdAt
}

/**
 * recommendations-adapter output: A2.5 governance recommendations.
 * Source: `governance-store` JSONL file `recommendations.jsonl`.
 *
 * Architectural decision (A8 wayfinder map #517 ruling, locked):
 * - `recommendation` was REMOVED from `ProposalGovernanceRecord` during
 *   T1-reconciliation because governance event payloads do NOT carry the
 *   recommendation (A2.5 writes recommendations to a separate JSONL).
 * - This 4th adapter reads that JSONL; correlation by `proposalId` happens
 *   in the DETECTOR layer (not in the adapter — adapter does not join).
 *
 * Field adaptations (T4 reconnaissance, A8 wayfinder map #517):
 * - Source `GovernanceRecommendation` carries:
 *     `{ recommendationId, evidenceId, proposalId, kind, confidence,
 *        reasoning, supportingEvidence, risks, createdAt }`
 * - `recordId`  ← source `recommendationId`
 * - `evidenceRefs` ← source `supportingEvidence` (string[]; NOT `evidenceId`)
 * - `recordedAt` ← source `createdAt`
 * - `kind`      ← source `kind`
 * - `confidence` ← source `confidence`
 * - `reasoning` ← source `reasoning`
 *
 * Invariants (per `validateGovernanceRecommendation`):
 * - `proposalId` is REQUIRED and non-empty (no silent defaults).
 * - `kind` must be one of APPROVE | MONITOR | REQUEST_ADDITIONAL_EVIDENCE |
 *   REJECT | ESCALATE.
 * - `confidence` ∈ [0, 1].
 */
export interface RecommendationRecord {
  readonly recordId: string;
  readonly proposalId: string;
  readonly kind:
    | "APPROVE"
    | "MONITOR"
    | "REQUEST_ADDITIONAL_EVIDENCE"
    | "REJECT"
    | "ESCALATE";
  readonly confidence: number;
  readonly reasoning?: string;
  readonly evidenceRefs: ReadonlyArray<string>;
  readonly recordedAt: string;
}

// ---------------------------------------------------------------------------
// Engine options
// ---------------------------------------------------------------------------

export interface LearningEngineOptions {
  readonly minCardinality: number;
  readonly evidenceWindowDays: number;
}

export const DEFAULT_LEARNING_ENGINE_OPTIONS: LearningEngineOptions = {
  minCardinality: DEFAULT_MIN_CARDINALITY,
  evidenceWindowDays: DEFAULT_EVIDENCE_WINDOW_DAYS,
};