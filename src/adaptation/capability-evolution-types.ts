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
