export type ProposalAction =
  | "create_agent_card"
  | "update_agent_card"
  | "add_capability"
  | "adjust_skill_definition"
  | "create_improvement_issue"
  | "suggest_routing_weight"
  | "revert_proposal";

export type ProposalTarget =
  | { kind: "agent_card"; id: string }
  | { kind: "skill"; id: string }
  | { kind: "capability"; capability: string; agentId?: string }
  | { kind: "issue"; title: string }
  | { kind: "routing_weight"; capability: string }
  | { kind: "revert"; sourceProposalId: string };

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
}
