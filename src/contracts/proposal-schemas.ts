// src/contracts/proposal-schemas.ts
//
// Effect Schema contracts for adaptation proposal boundaries.
// Mirrors src/adaptation/adaptation-types.ts exactly.

import { Schema } from "effect";

// ---------------------------------------------------------------------------
// LearningArea
// ---------------------------------------------------------------------------

export const LearningAreaSchema = Schema.Literal(
  "recommendation", "risk", "governance", "routing",
);

// ---------------------------------------------------------------------------
// ExecutiveSubsystemName
// ---------------------------------------------------------------------------

export const ExecutiveSubsystemNameSchema = Schema.Literal(
  "governance", "learning", "adaptation", "agents",
  "tools", "workflow", "memory", "security",
);

// ---------------------------------------------------------------------------
// ProposalAction
// ---------------------------------------------------------------------------

export const ProposalActionSchema = Schema.Literal(
  "create_agent_card",
  "update_agent_card",
  "add_capability",
  "adjust_skill_definition",
  "create_improvement_issue",
  "suggest_routing_weight",
  "revert_proposal",
  "learning_adjustment",
  "governance_change",
  "executive_remediation_request",
);

// ---------------------------------------------------------------------------
// ProposalStatus
// ---------------------------------------------------------------------------

export const ProposalStatusSchema = Schema.Literal(
  "pending", "approved", "rejected", "applied", "failed",
);

// ---------------------------------------------------------------------------
// ProposalTarget — discriminated union
// ---------------------------------------------------------------------------

export const AgentCardTargetSchema = Schema.Struct({
  kind: Schema.Literal("agent_card"),
  id: Schema.String,
});

export const SkillTargetSchema = Schema.Struct({
  kind: Schema.Literal("skill"),
  id: Schema.String,
});

export const CapabilityTargetSchema = Schema.Struct({
  kind: Schema.Literal("capability"),
  capability: Schema.String,
  agentId: Schema.optional(Schema.String),
});

export const IssueTargetSchema = Schema.Struct({
  kind: Schema.Literal("issue"),
  title: Schema.String,
});

export const RoutingWeightTargetSchema = Schema.Struct({
  kind: Schema.Literal("routing_weight"),
  capability: Schema.String,
});

export const RevertTargetSchema = Schema.Struct({
  kind: Schema.Literal("revert"),
  sourceProposalId: Schema.String,
});

export const LearningTargetSchema = Schema.Struct({
  kind: Schema.Literal("learning"),
  area: LearningAreaSchema,
});

export const GovernanceTargetSchema = Schema.Struct({
  kind: Schema.Literal("governance"),
  recommendationId: Schema.String,
});

export const ExecutiveRemediationTargetSchema = Schema.Struct({
  kind: Schema.Literal("executive_remediation"),
  planId: Schema.String,
  stepId: Schema.String,
  objectiveId: Schema.String,
  subsystem: ExecutiveSubsystemNameSchema,
});

export const ProposalTargetSchema = Schema.Union(
  AgentCardTargetSchema,
  SkillTargetSchema,
  CapabilityTargetSchema,
  IssueTargetSchema,
  RoutingWeightTargetSchema,
  RevertTargetSchema,
  LearningTargetSchema,
  GovernanceTargetSchema,
  ExecutiveRemediationTargetSchema,
);

// ---------------------------------------------------------------------------
// SystemState
// ---------------------------------------------------------------------------

export const SystemStateSchema = Schema.Struct({
  orphaned: Schema.Literal(true),
  reason: Schema.String,
  cleaned: Schema.optional(Schema.Boolean),
});

// ---------------------------------------------------------------------------
// AdaptationProposal
// ---------------------------------------------------------------------------

export const AdaptationProposalSchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  status: ProposalStatusSchema,
  action: ProposalActionSchema,
  target: ProposalTargetSchema,
  payload: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  sourceRecommendationType: Schema.String,
  sourceConfidence: Schema.Number,
  evidenceFingerprints: Schema.Array(Schema.String),
  reason: Schema.String,
  approvedBy: Schema.optional(Schema.String),
  approvedAt: Schema.optional(Schema.String),
  appliedAt: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  provenance: Schema.optional(Schema.Literal("auto", "manual")),
  systemState: Schema.optional(SystemStateSchema),
});
export type AdaptationProposalFromSchema = typeof AdaptationProposalSchema.Type;
