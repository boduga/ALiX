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
 */
export interface ProposalGovernanceRecord {
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly kind:
    | "proposal.submitted"
    | "proposal.approved"
    | "proposal.rejected"
    | "proposal.executed"
    | "proposal.execution_failed";
  readonly operatorId?: string;          // from ProposalApprovedPayload.approvedBy or ProposalRejectedPayload.rejectedBy
  readonly operatorReason?: string;       // from ProposalRejectedPayload.reason
  readonly recommendation?: { readonly kind: string; readonly confidence: number };
  readonly recordedAt: string;
  readonly eventId: string;               // EventLog eventId for audit
}

/**
 * measurement-events-adapter output: outcome events.
 * Source: EventLog capability.governance.measurement.* events (CAP-10).
 */
export interface MeasurementOutcomeRecord {
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly outcome: "effective" | "ineffective" | "inconclusive";
  readonly sourceProposalIds: ReadonlyArray<string>; // proposals whose execution produced this outcome
  readonly recordedAt: string;
  readonly eventId: string;
}

/**
 * enriched-proposals-adapter output: P10.8a enriched proposal records.
 * Source: EnrichedProposal[] pipeline.
 */
export interface EnrichedProposalRecord {
  readonly proposalId: string;
  readonly capabilityId: string;
  readonly enrichedFields: ReadonlyArray<string>;
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