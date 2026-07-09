/**
 * P19.2 — Semantic Dry-Run Simulator.
 *
 * Produces a semantic projection of expected effects for approved actions.
 * A P19 dry run is analysis, not sandbox execution — no tools, shell,
 * network, MCP, browser, fetch, or subprocess calls.
 */

import { createHash } from "node:crypto";

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
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
  | "blocked";

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
  return [...new Set(values)].sort();
}

function projectAction(
  action: GovernanceExecutionAction,
  blocked: boolean,
): DryRunActionProjection {
  const common = {
    actionId: action.actionId,
    kind: action.kind,
    target: { ...action.target },
    expectedEffect: action.expectedEffect,
  };

  if (blocked) {
    return {
      ...common,
      status: "blocked",
      preconditions: ["Approved P17 plan and matching P18 visibility required"],
      risks: ["Readiness level blocks semantic simulation"],
      rollbackNotes: [],
    };
  }
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
        preconditions: ["Config change effect is described, not executed"],
        risks: ["Effect projection does not mutate configuration"],
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
  if (assessment.planId !== plan.planId) {
    throw new DryRunSimulationError(
      `assessment planId "${assessment.planId}" does not match plan "${plan.planId}"`,
    );
  }
  if (assessment.remediationId !== plan.remediationId) {
    throw new DryRunSimulationError(
      `assessment remediationId "${assessment.remediationId}" does not match remediation "${plan.remediationId}"`,
    );
  }
  if (assessment.approvalId !== approval.approvalId) {
    throw new DryRunSimulationError(
      `assessment approvalId "${assessment.approvalId}" does not match approval "${approval.approvalId}"`,
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
  if (
    !ISO_TIMESTAMP_PATTERN.test(simulatedAt) ||
    Number.isNaN(Date.parse(simulatedAt))
  ) {
    throw new DryRunSimulationError(
      "simulatedAt must be a valid ISO 8601 timestamp",
    );
  }
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
