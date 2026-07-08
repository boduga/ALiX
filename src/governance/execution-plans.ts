/**
 * P17.2 — Accepted Action Execution Plans.
 *
 * Pure module converting accepted remediation proposals into reviewable
 * execution plans. No execution, no approval gate, no mutation, no store.
 */

import { createHash } from "node:crypto";
import type { GovernanceRemediationProposal } from "./remediation-queue.js";
import type { ResponseRecommendationKind } from "./response-recommendations.js";

export type ExecutionPlanStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "reverted"
  | "superseded";

export type ExecutionActionKind =
  | "investigate_anomaly"
  | "review_policy"
  | "update_config"
  | "manual_action";

export interface GovernanceExecutionAction {
  actionId: string;
  kind: ExecutionActionKind;
  description: string;
  target: { type: string; id: string | null };
  expectedEffect: string;
  mutationRequired: boolean;
  externalSideEffect: boolean;
  approvalRequired: true;
  reversible: boolean;
  rollbackHint: string | null;
}

export interface GovernanceRollbackPlan {
  rollbackId: string;
  summary: string;
  reversibleActions: string[];
  nonReversibleActions: string[];
  operatorInstructions: string[];
  riskNotes: string[];
}

export interface GovernanceExecutionPlan {
  planId: string;
  remediationId: string;
  sourceProposalId: string;
  status: "draft";
  title: string;
  summary: string;
  proposedActions: GovernanceExecutionAction[];
  riskLevel: "low" | "medium" | "high";
  requiresRollbackPlan: boolean;
  rollbackPlan: GovernanceRollbackPlan | null;
  createdAt: string;
  createdBy: "system";
  approvedAt: null;
  approvedBy: null;
  executionAttemptIds: [];
  auditRefs: string[];
}

export class RemediationNotAcceptedException extends Error {
  constructor(status: string) {
    super(`Cannot create execution plan: remediation status is "${status}", expected "accepted"`);
    this.name = "RemediationNotAcceptedException";
  }
}

type AcceptedRemediation = GovernanceRemediationProposal & { status: "accepted" };

// ---------------------------------------------------------------------------
// responseKind → proposedActions mapping (pure lookup)
// ---------------------------------------------------------------------------

function actionsForKind(kind: ResponseRecommendationKind): GovernanceExecutionAction[] {
  switch (kind) {
    case "investigate_anomaly":
      return [
        {
          actionId: "act-investigate",
          kind: "investigate_anomaly",
          description: "Investigate the source anomaly and gather evidence",
          target: { type: "anomaly", id: null },
          expectedEffect: "Root cause identified and documented",
          mutationRequired: false,
          externalSideEffect: false,
          approvalRequired: true as const,
          reversible: true,
          rollbackHint: null,
        },
      ];
    case "inspect_policy_gap":
      return [
        {
          actionId: "act-review-policy",
          kind: "review_policy",
          description: "Review governance policy for gaps or drift",
          target: { type: "policy", id: null },
          expectedEffect: "Policy adjustment proposal prepared",
          mutationRequired: false,
          externalSideEffect: false,
          approvalRequired: true as const,
          reversible: true,
          rollbackHint: null,
        },
      ];
    case "verify_audit_integrity":
      return [
        {
          actionId: "act-verify-integrity",
          kind: "investigate_anomaly",
          description: "Verify audit chain integrity",
          target: { type: "audit_store", id: null },
          expectedEffect: "Integrity confirmed or corruption documented",
          mutationRequired: false,
          externalSideEffect: false,
          approvalRequired: true as const,
          reversible: true,
          rollbackHint: null,
        },
      ];
    default:
      return [
        {
          actionId: "act-manual",
          kind: "manual_action",
          description: "Manual operator review required",
          target: { type: "remediation", id: null },
          expectedEffect: "Operator determines and records outcome",
          mutationRequired: false,
          externalSideEffect: false,
          approvalRequired: true as const,
          reversible: true,
          rollbackHint: null,
        },
      ];
  }
}

function severityToRisk(severity: string): "low" | "medium" | "high" {
  switch (severity) {
    case "critical": return "high";
    case "warning": return "medium";
    default: return "low";
  }
}

function buildRollbackPlan(
  planId: string,
  actions: GovernanceExecutionAction[],
): GovernanceRollbackPlan {
  const reversible = actions.filter((a) => a.reversible).map((a) => a.actionId);
  const nonReversible = actions.filter((a) => !a.reversible).map((a) => a.actionId);
  return {
    rollbackId: `rb-${planId}`,
    summary: `Rollback plan for ${actions.length} action(s)`,
    reversibleActions: reversible,
    nonReversibleActions: nonReversible,
    operatorInstructions: ["Review each action result before marking resolved"],
    riskNotes: [],
  };
}

export function createExecutionPlanFromRemediation(
  remediation: GovernanceRemediationProposal,
  options?: { now?: string },
): GovernanceExecutionPlan {
  if (remediation.status !== "accepted") {
    throw new RemediationNotAcceptedException(remediation.status);
  }

  const accepted = remediation as AcceptedRemediation;
  const createdAt = options?.now ?? new Date().toISOString();
  const planId = createHash("sha256")
    .update(["p17.2", accepted.proposalId, accepted.responseKind, createdAt].join("|"))
    .digest("hex")
    .slice(0, 16);

  const actions = actionsForKind(accepted.responseKind).sort((a, b) =>
    a.actionId.localeCompare(b.actionId),
  );

  const riskLevel = severityToRisk(accepted.severity);
  const requiresRollbackPlan = riskLevel !== "low";
  const rollbackPlan = requiresRollbackPlan ? buildRollbackPlan(planId, actions) : null;

  return {
    planId,
    remediationId: accepted.proposalId,
    sourceProposalId: accepted.proposalId,
    status: "draft",
    title: `Execution plan: ${accepted.title}`,
    summary: `Derived from remediation ${accepted.proposalId} (${accepted.responseKind})`,
    proposedActions: actions,
    riskLevel,
    requiresRollbackPlan,
    rollbackPlan,
    createdAt,
    createdBy: "system",
    approvedAt: null,
    approvedBy: null,
    executionAttemptIds: [],
    auditRefs: [],
  };
}
