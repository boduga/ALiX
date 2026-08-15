/**
 * P5.5 — Capability Evolution Intelligence types.
 *
 * These types describe the output of the capability evolution analyzers.
 * A CapabilityEvolutionReport observes whether the current capability model
 * is still the right capability model — health, gaps, overlap, drift.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type LifecycleState =
  | "emerging"
  | "active"
  | "mature"
  | "stagnant"
  | "declining"
  | "deprecated";

// ---------------------------------------------------------------------------
// Capability health
// ---------------------------------------------------------------------------

export interface CapabilityHealth {
  capability: string;
  /** Number of agents that register this capability. */
  agentCount: number;
  /** Total resolution count (all time). */
  resolutionCount: number;
  /** Resolution count in the most recent 30-day window. */
  resolutionCountRecent: number;
  /** Resolution count 30-60 days ago (for trend comparison). */
  resolutionCountPrior: number;
  /** Proposal count in the most recent 30-day window. */
  proposalCountRecent: number;
  /** Proposal count 30-60 days ago (for trend comparison). */
  proposalCountPrior: number;
  /**
   * Demand score 0-1 combining goal decomposition references,
   * reflection reports, and unresolved capability_routed events.
   * Higher = more latent demand than current coverage can satisfy.
   */
  demandScore: number;
  /** Historical keep rate from IntelligenceReport (null if unavailable). */
  keepRate: number | null;
  /** Historical revert rate (null if unavailable). */
  revertRate: number | null;
  /** Total number of proposals targeting this capability. */
  proposalCount: number;
  /** Computed lifecycle state (trend-aware). */
  lifecycleState: LifecycleState;
  /** Human-readable rationale for the lifecycle assignment. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Capability gap
// ---------------------------------------------------------------------------

export interface CapabilityGap {
  /** Suggested capability name (derived from evidence). */
  suggestedCapability: string;
  /** Evidence snippets supporting this gap. */
  evidence: string[];
  /** Number of distinct signal types (1-3). */
  signalStrength: number;
  /** Confidence in this gap being real. */
  confidence: "high" | "medium" | "low";
}

// ---------------------------------------------------------------------------
// Capability overlap
// ---------------------------------------------------------------------------

export interface CapabilityOverlap {
  capabilityA: string;
  capabilityB: string;
  /** Symmetric 0-1 overlap score. */
  overlapScore: number;
  /** Proportion of A's agents/proposals that also involve B. */
  coverageAtoB: number;
  /** Proportion of B's agents/proposals that also involve A. */
  coverageBtoA: number;
  /** asymmetry = coverageAtoB - coverageBtoA (>0 = A depends on B more). */
  asymmetry: number;
  /** Number of shared signal dimensions. */
  sharedSignalCount: number;
  /** Whether this is a consolidation candidate (score > 0.7). */
  consolidationCandidate: boolean;
}

// ---------------------------------------------------------------------------
// Capability drift
// ---------------------------------------------------------------------------

export interface CapabilityDrift {
  capability: string;
  /** Original scope description (agent card + early proposals). */
  originalScope: string;
  /** Current observed scope (recent proposals + resolution patterns). */
  currentScope: string;
  /** Drift magnitude 0-1 (Jaccard distance). */
  driftMagnitude: number;
  /** Whether this is a split candidate (magnitude > 0.5). */
  splitCandidate: boolean;
}

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

export interface CapabilityEvolutionReport {
  generatedAt: string;
  /** Total registered capabilities across all agent cards. */
  // P5.6 — CapabilityEvolutionProposalGenerator consumes this report
  // to produce pending AdaptationProposals from actionable findings.
  totalCapabilities: number;
  /** Analyzed capability health entries. */
  healthAnalysis: CapabilityHealth[];
  /** Discovered capability gaps. */
  gapAnalysis: CapabilityGap[];
  /** Directional pairwise overlap. */
  overlapAnalysis: CapabilityOverlap[];
  /** Capabilities with scope drift. */
  driftAnalysis: CapabilityDrift[];
  /** Distribution across lifecycle states. */
  lifecycleDistribution: Record<LifecycleState, number>;
  /** Natural-language executive summary. */
  executiveSummary: string;
}

// ---------------------------------------------------------------------------
// CAP-9 A7 proposal candidate (Task 1 — additive)
// ---------------------------------------------------------------------------

import type { CapabilityDefinitionPatch } from "../capability/mutation-contract.js";
import type { CapabilityDefinition } from "../capability/canonical/definition.js";
import {
  type ConsolidationIdentity,
  type SourceDisposition,
  validateConsolidationIdentity,
} from "../capability/evolution/consolidation-identity.js";

/** CAP-9 — Evolution target discriminator. A7 emits candidates against a
 *  capability target (the only target kind A7 currently supports). The
 *  union is left open for future CAP-10+ targets (agent_card, skill, etc.). */
export type CapabilityEvolutionTarget =
  | { readonly kind: "capability"; readonly id: string };

/** CAP-9 — Risk class discriminator. Drives downstream validation and
 *  approval routing. */
export type CapabilityEvolutionRiskClass = "low" | "medium" | "high";

/**
 * CAP-9 — A7 proposal candidate.
 *
 * A7 (the proposal-intelligence layer) emits `CapabilityEvolutionCandidate`
 * shapes. `service.propose()` is the sole persistence boundary; A7 itself
 * never writes anywhere (ruling #5). The candidate body is the canonical
 * input to proposal-identity hashing (SHA-256 hex of canonical-JSON,
 * ruling #18) — same body → same id, enabling deduplication (ruling #21).
 *
 * Field semantics:
 *   - `candidateId` — A7-supplied stable id within a single A7 emission.
 *     Two A7 emissions can produce different `candidateId`s for the same
 *     canonical body (A7 owns the namespace); the proposal identity used
 *     by the ledger is `computeProposalId(candidate)` (see Task 2).
 *   - `sourcePatternId` — identifies the signal pattern that triggered the
 *     candidate (`gap`, `underperformer`, `consolidation_opportunity`,
 *     `deprecation_signal`).
 *   - `confidence` — 0..1, A7-supplied score from the underlying signal.
 *   - `target` — the capability (or future: agent/skill) being proposed.
 *   - `description` / `expectedEffect` — human-readable rationale.
 *   - `riskClass` — drives approval routing.
 *   - `evidenceIds` — opaque fingerprints that justify the candidate.
 */
export interface CapabilityEvolutionCandidate {
  readonly candidateId: string;
  readonly sourcePatternId: string;
  readonly confidence: number;
  readonly target: CapabilityEvolutionTarget;
  readonly description: string;
  readonly expectedEffect: string;
  readonly riskClass: CapabilityEvolutionRiskClass;
  readonly evidenceIds: ReadonlyArray<string>;
  /**
   * CAP-O: candidate-carried update patch for `underperformer` sourcePatternId.
   * Present (structurally non-empty) for `underperformer`; absent for other
   * sourcePatternIds. Provenance-only — no speculative semantic change to the
   * capability definition.
   */
  readonly proposedPatch?: CapabilityDefinitionPatch;
  /**
   * P5.5/P5.6 + CAP-P: caller-supplied absorbed-set carried verbatim from
   * `consolidation_opportunity` signal (ruling #534 — locked 2026-08-14).
   * Present only when `sourcePatternId === "consolidation_opportunity"`;
   * absent for every other sourcePatternId. Both survivor and absorbed
   * identities are caller-supplied and authoritative — A7 transports
   * without derivation, inference, expansion, or completion.
   */
  readonly absorbedCapabilityIds?: readonly string[];
  /**
   * CAP-P: caller-supplied target definition carried verbatim from the
   * `consolidation_opportunity` signal (locked decisions #534 and #544 —
   * 2026-08-14/15). Present only when
   * `sourcePatternId === "consolidation_opportunity"`; absent for every
   * other sourcePatternId. The governance caller (operator CLI per #544)
   * owns construction of this definition — A7 transports it without
   * derivation, inference, or synthesis. The executor's
   * `validateConsolidate()` (mutation-contract.ts:464) enforces the
   * conservative merge invariants against catalog-resolved sources.
   */
  readonly consolidateDefinition?: CapabilityDefinition;
  /**
   * CAP-P: caller-supplied disposition for absorbed capabilities carried
   * verbatim from the `consolidation_opportunity` signal (locked
   * decisions #534 and #544). Present only when
   * `sourcePatternId === "consolidation_opportunity"`; absent for every
   * other sourcePatternId. Either `"deprecate"` (sources transition to
   * `deprecated` lifecycle) or `"remove"` (sources removed from
   * catalog). Caller-supplied — A7 does NOT infer.
   */
  readonly sourceDisposition?: SourceDisposition;
}

/**
 * CAP-P — reconstruct the caller-supplied `ConsolidationIdentity` from a
 * `consolidation_opportunity` candidate.
 *
 * The candidate keeps the four fields flat because it is the WIRE shape
 * carried through the governance ledger; this helper is the single place
 * where they are re-bundled into the named identity, so downstream consumers
 * (execution-step construction, sentinels, the service) stop re-deriving the
 * clump by hand.
 *
 * Reads only. Throws (via `validateConsolidationIdentity`) when the candidate
 * does not carry a complete, well-formed governed set — it NEVER defaults,
 * derives, or completes a missing field (rulings #534, #544).
 */
export function consolidationIdentityFromCandidate(
  candidate: CapabilityEvolutionCandidate,
): ConsolidationIdentity {
  if (candidate.sourcePatternId !== "consolidation_opportunity") {
    throw new Error(
      `consolidationIdentityFromCandidate: candidate '${candidate.candidateId}' has sourcePatternId '${candidate.sourcePatternId}' — only 'consolidation_opportunity' carries a ConsolidationIdentity`,
    );
  }
  const identity = {
    survivorCapabilityId: candidate.target.id,
    absorbedCapabilityIds: candidate.absorbedCapabilityIds ?? [],
    consolidateDefinition: candidate.consolidateDefinition as CapabilityDefinition,
    sourceDisposition: candidate.sourceDisposition as SourceDisposition,
  } satisfies ConsolidationIdentity;
  validateConsolidationIdentity(identity);
  return identity;
}
