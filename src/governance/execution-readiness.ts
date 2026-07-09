/**
 * P19.1 — Execution Readiness Classifier.
 *
 * Pure projection over an approved P17 execution plan. No execution,
 * persistence, policy mutation, or external side effects.
 */

import { createHash } from "node:crypto";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import type {
  GovernanceExecutionAction,
  GovernanceExecutionPlan,
} from "./execution-plans.js";

export type ExecutionReadinessLevel =
  | "external_side_effecting"
  | "irreversible"
  | "reversible"
  | "dry_run_capable"
  | "manual_only";

export interface ExecutionReadinessFacts {
  approvedActionCount: number;
  mutationRequired: boolean;
  reversible: boolean;
  externalSideEffect: boolean;
  rollbackPlanPresent: boolean;
  rollbackCoverageComplete: boolean;
  simulatorCoverageComplete: boolean;
}

export type ExecutionReadinessReasonCode =
  | "external_side_effect"
  | "irreversible_action"
  | "reversible_mutation"
  | "semantic_simulation_supported"
  | "manual_action_required"
  | "rollback_plan_missing"
  | "rollback_coverage_incomplete";

export interface ExecutionReadinessReason {
  code: ExecutionReadinessReasonCode;
  actionIds: string[];
  summary: string;
}

export interface ExecutionReadinessAssessment {
  assessmentId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  readinessLevel: ExecutionReadinessLevel;
  facts: ExecutionReadinessFacts;
  reasons: ExecutionReadinessReason[];
  assessedAt: string;
}

export class ReadinessClassificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessClassificationError";
  }
}

const SIMULATOR_SUPPORTED_KINDS = new Set([
  "investigate_anomaly",
  "review_policy",
  "update_config",
]);

export function approvedActionsFor(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
): GovernanceExecutionAction[] {
  if (approval.decision !== "approved") {
    throw new ReadinessClassificationError("Execution approval decision must be approved");
  }
  if (approval.planId !== plan.planId) {
    throw new ReadinessClassificationError("Execution approval planId does not match plan");
  }
  if (approval.remediationId !== plan.remediationId) {
    throw new ReadinessClassificationError(
      "Execution approval remediationId does not match plan",
    );
  }
  if (approval.approvedActionIds.length === 0) {
    throw new ReadinessClassificationError(
      "Execution approval approvedActionIds must be non-empty",
    );
  }

  const actionsById = new Map(
    plan.proposedActions.map((action) => [action.actionId, action]),
  );
  for (const actionId of approval.approvedActionIds) {
    if (!actionsById.has(actionId)) {
      throw new ReadinessClassificationError(
        `Approved action "${actionId}" does not exist in plan proposedActions`,
      );
    }
  }

  return [...new Set(approval.approvedActionIds)]
    .map((actionId) => actionsById.get(actionId)!)
    .sort((left, right) => left.actionId.localeCompare(right.actionId));
}

function reason(
  code: ExecutionReadinessReasonCode,
  actions: GovernanceExecutionAction[],
  summary: string,
): ExecutionReadinessReason {
  return {
    code,
    actionIds: actions.map((action) => action.actionId).sort(),
    summary,
  };
}

export function classifyExecutionReadiness(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  options?: { now?: string },
): ExecutionReadinessAssessment {
  const actions = approvedActionsFor(plan, approval);
  const externalActions = actions.filter((action) => action.externalSideEffect);
  const irreversibleActions = actions.filter((action) => !action.reversible);
  const mutatingActions = actions.filter((action) => action.mutationRequired);
  const unsupportedActions = actions.filter(
    (action) => !SIMULATOR_SUPPORTED_KINDS.has(action.kind),
  );
  const reversibleMutatingActions = mutatingActions.filter(
    (action) => action.reversible,
  );
  const rollbackActionIds = new Set(
    plan.rollbackPlan?.reversibleActions ?? [],
  );
  const uncoveredRollbackActions = reversibleMutatingActions.filter(
    (action) => !rollbackActionIds.has(action.actionId),
  );
  const simulatorCoverageComplete = unsupportedActions.length === 0;
  const rollbackCoverageComplete = uncoveredRollbackActions.length === 0;

  let readinessLevel: ExecutionReadinessLevel;
  let primaryReason: ExecutionReadinessReason;
  if (externalActions.length > 0) {
    readinessLevel = "external_side_effecting";
    primaryReason = reason(
      "external_side_effect",
      externalActions,
      "Approved actions include external side effects",
    );
  } else if (irreversibleActions.length > 0) {
    readinessLevel = "irreversible";
    primaryReason = reason(
      "irreversible_action",
      irreversibleActions,
      "Approved actions include irreversible operations",
    );
  } else if (mutatingActions.length > 0) {
    readinessLevel = "reversible";
    primaryReason = reason(
      "reversible_mutation",
      mutatingActions,
      "Approved actions require reversible mutation",
    );
  } else if (simulatorCoverageComplete) {
    readinessLevel = "dry_run_capable";
    primaryReason = reason(
      "semantic_simulation_supported",
      actions,
      "All approved actions support semantic simulation",
    );
  } else {
    readinessLevel = "manual_only";
    primaryReason = reason(
      "manual_action_required",
      unsupportedActions,
      "Approved actions require manual operator handling",
    );
  }

  const reasons = [primaryReason];
  if (reversibleMutatingActions.length > 0 && plan.rollbackPlan === null) {
    reasons.push(
      reason(
        "rollback_plan_missing",
        reversibleMutatingActions,
        "Reversible mutating actions require a rollback plan",
      ),
    );
  } else if (!rollbackCoverageComplete) {
    reasons.push(
      reason(
        "rollback_coverage_incomplete",
        uncoveredRollbackActions,
        "Rollback plan does not cover every reversible mutating action",
      ),
    );
  }
  reasons.sort((left, right) => left.code.localeCompare(right.code));

  const assessedAt = options?.now ?? new Date().toISOString();
  const assessmentId = createHash("sha256")
    .update(
      [
        "p19.1",
        plan.planId,
        approval.approvalId,
        readinessLevel,
        assessedAt,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    assessmentId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    readinessLevel,
    facts: {
      approvedActionCount: actions.length,
      mutationRequired: mutatingActions.length > 0,
      reversible: irreversibleActions.length === 0,
      externalSideEffect: externalActions.length > 0,
      rollbackPlanPresent: plan.rollbackPlan !== null,
      rollbackCoverageComplete,
      simulatorCoverageComplete,
    },
    reasons,
    assessedAt,
  };
}
