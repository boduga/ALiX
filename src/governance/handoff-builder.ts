/**
 * P20.1 — Handoff Package Builder.
 *
 * Converts an eligible P19 readiness-approved plan into an explicit,
 * immutable operator handoff package. No execution, no persistence.
 * The package is always created with status: "pending".
 */

import { createHash } from "node:crypto";
import type { GovernanceExecutionPlan } from "./execution-plans.js";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import type { ExecutionReadinessAssessment } from "./execution-readiness.js";
import type { DryRunSimulation } from "./dry-run-simulator.js";
import type { ReadinessGateDecision } from "./readiness-policy-gate.js";
import type { WorkbenchLifecycleTrace } from "./governance-workbench.js";
import type { ExecutionActionKind } from "./execution-plans.js";

export type HandoffStatus = "pending";

export interface HandoffPackageAction {
  actionId: string;
  kind: ExecutionActionKind;
  description: string;
  target: { type: string; id: string | null };
  expectedEffect: string;
  operatorInstructions: string[];
  rollbackProcedure: string | null;
  evidenceRequired: boolean;
}

export interface HandoffPackageEvidence {
  ref: string;
  label: string;
  required: boolean;
}

export interface HandoffPackage {
  handoffId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string;
  decisionId: string;
  disposition: string;
  title: string;
  summary: string;
  actions: HandoffPackageAction[];
  evidence: HandoffPackageEvidence[];
  operatorInstructions: string[];
  riskNotes: string[];
  rollbackSummary: string[];
  status: HandoffStatus;
  generatedAt: string;
  evidenceCaptured: boolean;
  explicitlyManualOnly: true;
}

export interface HandoffInput {
  plan: GovernanceExecutionPlan;
  approval: GovernanceExecutionApproval;
  assessment: ExecutionReadinessAssessment;
  simulation: DryRunSimulation;
  decision: ReadinessGateDecision;
  lifecycleTrace: WorkbenchLifecycleTrace;
  operatorInstructions?: string[];
}

export class HandoffBuilderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandoffBuilderError";
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function buildHandoffPackage(
  input: HandoffInput,
  options: { now?: string } = {},
): HandoffPackage {
  const { plan, approval, assessment, simulation, decision, lifecycleTrace } =
    input;

  // Eligibility: blocked decisions cannot produce handoff packages
  if (decision.disposition === "blocked") {
    throw new HandoffBuilderError(
      `cannot build handoff for blocked readiness decision "${decision.decisionId}"`,
    );
  }
  if (decision.disposition === "dry_run_allowed" || decision.disposition === "manual_only") {
    // Eligible — proceed
  } else {
    throw new HandoffBuilderError(
      `cannot build handoff for disposition "${decision.disposition}"`,
    );
  }
  if (decision.controlledExecutionAuthorization !== "not_available_in_p19") {
    throw new HandoffBuilderError(
      `handoff requires controlledExecutionAuthorization "not_available_in_p19"`,
    );
  }

  // Build actions
  const actions: HandoffPackageAction[] = [];
  const evidence: HandoffPackageEvidence[] = [];

  for (const actionProj of simulation.actionProjections) {
    const planAction = plan.proposedActions.find(
      (a) => a.actionId === actionProj.actionId,
    );
    const action: HandoffPackageAction = {
      actionId: actionProj.actionId,
      kind: actionProj.kind,
      description: actionProj.expectedEffect,
      target: { ...actionProj.target },
      expectedEffect: actionProj.expectedEffect,
      operatorInstructions: [
        ...actionProj.preconditions,
        ...actionProj.risks,
      ],
      rollbackProcedure: actionProj.rollbackNotes.join("; ") || null,
      evidenceRequired:
        actionProj.kind === "update_config" ||
        actionProj.kind === "manual_action" ||
        actionProj.status === "manual_required",
    };
    actions.push(action);

    if (action.evidenceRequired) {
      evidence.push({
        ref: `handoff/${action.actionId}/evidence`,
        label: `Evidence for action "${action.actionId}": ${action.expectedEffect}`,
        required: true,
      });
    }
  }

  // Build rollback summary from plan
  const rollbackSummary: string[] = [];
  if (plan.rollbackPlan) {
    rollbackSummary.push(
      ...plan.rollbackPlan.operatorInstructions,
      ...plan.rollbackPlan.nonReversibleActions.map(
        (id) => `Non-reversible action: ${id}`,
      ),
    );
  }
  rollbackSummary.push(
    ...simulation.rollbackNotes.map((n) => `Simulation note: ${n}`),
  );

  // Build operator instructions
  const operatorInstructions = sortedUnique([
    ...(input.operatorInstructions ?? []),
    ...plan.rollbackPlan?.operatorInstructions ?? [],
    "All actions are manual — ALiX does not execute.",
  ]);

  const generatedAt = options.now ?? new Date().toISOString();
  const handoffId = createHash("sha256")
    .update(
      [
        "p20.1",
        plan.planId,
        approval.approvalId,
        assessment.assessmentId,
        generatedAt,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    handoffId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    assessmentId: assessment.assessmentId,
    simulationId: simulation.simulationId,
    decisionId: decision.decisionId,
    disposition: decision.disposition,
    title: plan.title,
    summary: plan.summary,
    actions: actions.sort((a, b) => a.actionId.localeCompare(b.actionId)),
    evidence: evidence.sort((a, b) => a.ref.localeCompare(b.ref)),
    operatorInstructions,
    riskNotes: sortedUnique(simulation.riskNotes),
    rollbackSummary: sortedUnique(rollbackSummary),
    status: "pending",
    generatedAt,
    evidenceCaptured: false,
    explicitlyManualOnly: true,
  };
}
