export type ProposalAction =
  | "create_agent_card"
  | "update_agent_card"
  | "add_capability"
  | "adjust_skill_definition"
  | "create_improvement_issue"
  | "suggest_routing_weight"
  | "revert_proposal"
  | "learning_adjustment"
  | "governance_change"; // P9.2: P9.1 advisory → P5 lifecycle bridge

export type ProposalTarget =
  | { kind: "agent_card"; id: string }
  | { kind: "skill"; id: string }
  | { kind: "capability"; capability: string; agentId?: string }
  | { kind: "issue"; title: string }
  | { kind: "routing_weight"; capability: string }
  | { kind: "revert"; sourceProposalId: string }
  | { kind: "learning"; area: LearningArea }
  | { kind: "governance"; recommendationId: string }; // P9.2: governance_change target

/**
 * Which learning subsystem a learning_adjustment proposal targets.
 * Used only by the P8 learning → proposal bridge.
 */
export type LearningArea =
  | "recommendation"
  | "risk"
  | "governance"
  | "routing";

export type ProposalStatus = "pending" | "approved" | "rejected" | "applied" | "failed";

export interface AdaptationProposal {
  /** Unique ID like "prop-YYYY-MM-DD-NNN" */
  id: string;
  /** ISO 8601 timestamp of creation */
  createdAt: string;
  /** Current state in the approval lifecycle */
  status: ProposalStatus;
  /** What action to take when applied */
  action: ProposalAction;
  /** What entity the action targets */
  target: ProposalTarget;
  /** The change payload (shape depends on action) */
  payload: Record<string, unknown>;
  /** What P5.0 Recommendation generated this proposal */
  sourceRecommendationType: string;
  /** Confidence from the source recommendation */
  sourceConfidence: number;
  /** Evidence fingerprints that justify the change */
  evidenceFingerprints: string[];
  /** Human-readable reason */
  reason: string;
  /** Approval metadata (set by approval gate) */
  approvedBy?: string;
  approvedAt?: string;
  /** Application metadata (set by applier) */
  appliedAt?: string;
  error?: string;
  /**
   * How this proposal was generated: "auto" by AutomaticProposalGenerator
   * (P5.2c), or "manual" by RecommendationToProposal.convert (P5.1c).
   * Undefined is treated as "manual" for backwards compatibility with proposals
   * created before this field was introduced.
   */
  provenance?: "auto" | "manual";
  /**
   * P9.2 system-state metadata. Used for infrastructure-recovery
   * flags (currently only `orphaned`). Distinct from ProposalStatus:
   * the lifecycle status (pending/approved/rejected/applied/failed)
   * is preserved unchanged. systemState is invisible to lifecycle
   * code; it's a recovery flag in metadata.
   */
  systemState?: { orphaned: true; reason: string };
}
