/**
 * Evolution-loop projection snapshot (locked Q-S1..S4, Q-C3b).
 *
 * ONE immutable read model per collector cycle: a single `generatedAt`, a
 * capability-rooted spine, flat stage states, and a reference-by-id link
 * index. This is an ASSOCIATION layer over canonical artifacts (A7/A8/A9/
 * A2.5/measurements) — never a new domain store; domain identities are never
 * rewritten; no per-stage timestamps.
 */
import type { Correlation, Forecast } from '../../../evolution/forecast/contracts/contract.js';
import type { GovernanceRecommendationKind } from '../../../evolution/verification/contracts/recommendation-contract.js';
import type { GovernanceDecisionKind } from '../../../evolution/governance/contracts/decision-contract.js';
import type { LifecycleState } from '../../../adaptation/capability-evolution-types.js';
import type { LearningFinding } from '../../../evolution/learning/contracts/learning-contract.js';

/** Q-C3b — stage health. empty ≠ unavailable (a healthy source with zero
 *  artifacts is 'empty'; a failed source is 'unavailable', never a falsely
 *  complete zero). No 'stale' state in v1. */
export type StageStatus = 'available' | 'empty' | 'unavailable';

export interface StageState<T> {
  readonly status: StageStatus;
  /** Canonical artifacts for this stage. ALWAYS empty when status !== 'available'. */
  readonly items: readonly T[];
}

/** The six evolution-loop stages — the canonical stage-name union (Q-L1..L4),
 *  shared by the snapshot, the view state (`PerTabState`), and the renderer. */
export type EvolutionStageName =
  | 'lifecycle'
  | 'learning'
  | 'forecasts'
  | 'decisions'
  | 'measurements'
  | 'correlations';

/** A7 lifecycle row (canonical registry state, eligibility is a pure lookup). */
export interface LifecycleRow {
  readonly capabilityId: string;
  readonly state: LifecycleState;
  readonly eligible: boolean;
}

/** A9 forecast row — canonical `forecastId` + minimal presentation fields. */
export interface ForecastRow {
  readonly forecastId: string;
  readonly kind: string;
  readonly band: string;
  readonly confidence: number;
  readonly subject: string;
  readonly subjectCapability: string;
}

/** A8 learning pattern row — canonical `findingId` + presentation fields. */
export interface LearningPatternRow {
  readonly findingId: string;
  readonly kind: string;
  readonly occurrences: number;
  readonly summary: string;
}

/** Q-S2/Q-L4a — a projected decision. Derived from a canonical A2.5
 *  recommendation via `recommendationKindToDecisionKind`; NEVER an
 *  authoritative A3 decisionRecord; no invented A3 identity/timestamp.
 *  Keyed by the canonical `recommendationId`; `projectedDecision`/`targetState`
 *  are null when the recommendation maps to no decision (e.g. ESCALATE). */
export interface DecisionRow {
  readonly recommendationId: string;
  /** Canonical A2.5 kind (6-kind union) — never a string downgrade. */
  readonly recommendationKind: GovernanceRecommendationKind;
  readonly proposalId: string;
  readonly confidence: number;
  readonly projectedDecision: GovernanceDecisionKind | null;
  readonly targetState: 'APPROVED' | 'REJECTED' | 'UNDER_REVIEW' | null;
}

/** A5 measurement row — canonical `measurementId` (the EventLog event UUID).
 *  MUST NOT carry proposalId / sourceProposalIds / forecastId / correlationId
 *  (sentinel: CapabilityMeasurementPayload has none). */
export interface MeasurementRow {
  readonly measurementId: string;
  readonly capabilityId: string;
  readonly recordedAt: string;
  readonly status: string;
  readonly outcomeKind: string;
  readonly confidence: number;
}

/** A9 correlation row — canonical ids, the bridge between a forecast and a
 *  measurement. */
export interface CorrelationRow {
  readonly correlationId: string;
  readonly forecastId: string;
  readonly measurementId: string;
  readonly delta: string;
  readonly band: string;
  readonly forecastBand: string;
}

/** Q-S1 — capability-rooted composite spine entry. */
export interface CapabilitySpineEntry {
  readonly capabilityId: string;
  readonly lifecycle: LifecycleRow | null;
  readonly learning: StageState<LearningPatternRow>;
  readonly forecasts: StageState<ForecastRow>;
  readonly decisions: StageState<DecisionRow>;
  readonly measurements: StageState<MeasurementRow>;
  readonly correlations: StageState<CorrelationRow>;
}

/** Q-S4 — reference-by-id link. Direction carries NO causality; many-to-many is
 *  preserved (no primary designation). */
export type EvolutionLinkKind =
  | 'forecast→recommendation'
  | 'recommendation→decision'
  | 'decision→measurement'
  | 'measurement→correlation'
  | 'forecast→correlation';
export type EvolutionNodeType = 'forecast' | 'recommendation' | 'decision' | 'measurement' | 'correlation';
export interface EvolutionLink {
  readonly from: string;
  readonly fromType: EvolutionNodeType;
  readonly to: string;
  readonly toType: EvolutionNodeType;
  readonly kind: EvolutionLinkKind;
}

/** Q-S1/Q-C3b — one generatedAt + flat stage states + spine + link index. */
export interface EvolutionProjectionSnapshot {
  readonly generatedAt: number;
  readonly stages: {
    readonly lifecycle: StageState<LifecycleRow>;
    readonly learning: StageState<LearningPatternRow>;
    readonly forecasts: StageState<ForecastRow>;
    readonly decisions: StageState<DecisionRow>;
    readonly measurements: StageState<MeasurementRow>;
    readonly correlations: StageState<CorrelationRow>;
  };
  readonly spine: readonly CapabilitySpineEntry[];
  readonly links: readonly EvolutionLink[];
}
