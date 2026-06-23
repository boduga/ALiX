/**
 * P9.2 sentinel baselines for 6 protected type files.
 *
 * Per ADR-0004, every additive extension to a protected file must be
 * enumerated in the SDS, restated in the implementation plan, and verified by
 * a snapshot-equal sentinel assertion. This file snapshots the BASELINE
 * values before P9.2's additive extension of `adaptation-types.ts`.
 * Future P-phases that extend protected files update this file at the start
 * of their protected-file changes.
 *
 * Allowed mutations per ADR-0004:
 * - P9.2: +"governance_change" to ProposalAction
 * - P9.2: +{ kind: "governance"; recommendationId: string } to ProposalTarget
 */
export const BASELINE_PROPOSAL_ACTIONS: readonly string[] = [
  "create_agent_card",
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
  "create_improvement_issue",
  "suggest_routing_weight",
  "revert_proposal",
  "learning_adjustment",
] as const;

export const BASELINE_PROPOSAL_TARGET_KINDS: readonly string[] = [
  "agent_card",
  "skill",
  "capability",
  "issue",
  "routing_weight",
  "revert",
  "learning",
] as const;

export const BASELINE_PROPOSAL_STATUSES: readonly string[] = [
  "pending",
  "approved",
  "rejected",
  "applied",
  "failed",
] as const;
