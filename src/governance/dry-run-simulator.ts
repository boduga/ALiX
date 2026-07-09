/**
 * P19.2 — Semantic Dry-Run Simulator.
 *
 * Produces a semantic projection of expected effects for approved actions.
 * A P19 dry run is analysis, not sandbox execution — no tools, shell,
 * network, MCP, browser, fetch, or subprocess calls.
 */

import { createHash } from "node:crypto";
import type {
  ExecutionActionKind,
  GovernanceExecutionAction,
  GovernanceExecutionPlan,
} from "./execution-plans.js";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import {
  approvedActionsFor,
  type ExecutionReadinessAssessment,
} from "./execution-readiness.js";

export type DryRunActionStatus =
  | "simulated"
  | "manual_required"
  | "blocked"
  | "unsupported";

export interface DryRunActionProjection {
  actionId: string;
  kind: ExecutionActionKind;
  status: DryRunActionStatus;
  target: { type: string; id: string | null };
  expectedEffect: string;
  preconditions: string[];
  risks: string[];
  rollbackNotes: string[];
}

export interface DryRunSimulation {
  simulationId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  status: "complete" | "partial" | "blocked";
  actionProjections: DryRunActionProjection[];
  expectedEffects: string[];
  riskNotes: string[];
  rollbackNotes: string[];
  simulatedAt: string;
  explicitlyNonExecuting: true;
}

export class DryRunSimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DryRunSimulationError";
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function projectAction(
  action: GovernanceExecutionAction,
  blocked: boolean,
): DryRunActionProjection {
  if (blocked) {
    return {
      actionId: action.actionId,
      kind: action.kind,
      status: "blocked",
      target: { ...action.target },
      expectedEffect: action.expectedEffect,
      preconditions: ["Approved P17 plan and matching P18 visibility required"],
      risks: ["Readiness level blocks semantic simulation"],
      rollbackNotes: [],
    };
  }

  const common = {
    actionId: action.actionId,
    kind: action.kind,
    target: { ...action.target },
    expectedEffect: action.expectedEffect,
  };
  switch (action.kind) {
    case "investigate_anomaly":
      return {
        ...common,
        status: "simulated",
        preconditions: ["Evidence source remains readable"],
        risks: [],
        rollbackNotes: [],
      };
    case "review_policy":
      return {
        ...common,
        status: "simulated",
        preconditions: ["Policy is inspected read-only"],
        risks: ["Any policy change requires a separate proposal"],
        rollbackNotes: [],
      };
    case "update_config":
      return {
        ...common,
        status: "simulated",
        preconditions: ["Operator performs any future config change manually"],
        risks: ["Config mutation is not performed by this simulation"],
        rollbackNotes: action.rollbackHint ? [action.rollbackHint] : [],
      };
    case "manual_action":
      return {
        ...common,
        status: "manual_required",
        preconditions: ["Operator review required"],
        risks: ["No machine simulation available"],
        rollbackNotes: action.rollbackHint ? [action.rollbackHint] : [],
      };
    default:
      throw new DryRunSimulationError(
        `unsupported execution action kind "${String(action.kind)}"`,
      );
  }
}

export function simulateExecutionPlan(
  plan: GovernanceExecutionPlan,
  approval: GovernanceExecutionApproval,
  assessment: ExecutionReadinessAssessment,
  options: { now?: string } = {},
): DryRunSimulation {
  const actions = approvedActionsFor(plan, approval);
  if (
    assessment.planId !== plan.planId ||
    assessment.remediationId !== plan.remediationId ||
    assessment.approvalId !== approval.approvalId
  ) {
    throw new DryRunSimulationError(
      "assessment correlation does not match plan and approval",
    );
  }

  const blocked =
    assessment.readinessLevel === "external_side_effecting" ||
    assessment.readinessLevel === "irreversible";
  const actionProjections = actions
    .map((item) => projectAction(item, blocked))
    .sort((left, right) => left.actionId.localeCompare(right.actionId));
  const simulatedCount = actionProjections.filter(
    (item) => item.status === "simulated",
  ).length;
  const status = blocked
    ? "blocked"
    : simulatedCount === actionProjections.length
      ? "complete"
      : "partial";
  const simulatedAt = options.now ?? new Date().toISOString();
  const simulationId = createHash("sha256")
    .update(
      [
        "p19.2",
        plan.planId,
        approval.approvalId,
        assessment.assessmentId,
        status,
        simulatedAt,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    simulationId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    assessmentId: assessment.assessmentId,
    status,
    actionProjections,
    expectedEffects: sortedUnique(
      actionProjections.map((item) => item.expectedEffect),
    ),
    riskNotes: sortedUnique(
      actionProjections.flatMap((item) => item.risks),
    ),
    rollbackNotes: sortedUnique(
      actionProjections.flatMap((item) => item.rollbackNotes),
    ),
    simulatedAt,
    explicitlyNonExecuting: true,
  };
}
