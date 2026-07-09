/**
 * P19.3 — Policy Gate Evaluator.
 *
 * Evaluates readiness against immutable operator-provided policy.
 * The gate decides which analysis or manual path is available;
 * it never grants machine execution.
 */

import { createHash } from "node:crypto";
import type { GovernanceExecutionPlan } from "./execution-plans.js";
import type { GovernanceExecutionApproval } from "./execution-approval.js";
import type { WorkbenchLifecycleTrace } from "./governance-workbench.js";
import type { ExecutionReadinessAssessment } from "./execution-readiness.js";
import type { DryRunSimulation } from "./dry-run-simulator.js";

export interface ExecutionReadinessPolicy {
  policyId: string;
  allowSemanticDryRunFor: Array<"dry_run_capable" | "reversible">;
  requireCompleteRollbackForReversible: boolean;
  blockExternalSideEffects: true;
  blockIrreversibleActions: true;
  requireP18Visibility: true;
}

export interface WorkbenchVisibilityEvidence {
  remediationId: string;
  planId: string;
  approvalId: string;
  lifecycleTrace: WorkbenchLifecycleTrace;
}

export type ReadinessDisposition =
  | "blocked"
  | "manual_only"
  | "dry_run_allowed";

export interface ReadinessGateInput {
  plan: GovernanceExecutionPlan;
  approval: GovernanceExecutionApproval;
  assessment: ExecutionReadinessAssessment;
  simulation: DryRunSimulation | null;
  policy: ExecutionReadinessPolicy;
  visibility: WorkbenchVisibilityEvidence;
  options?: { now?: string };
}

export interface ReadinessGateDecision {
  decisionId: string;
  planId: string;
  remediationId: string;
  approvalId: string;
  assessmentId: string;
  simulationId: string | null;
  policyId: string;
  disposition: ReadinessDisposition;
  reasonCodes: string[];
  futureControlledExecutionCandidate: boolean;
  controlledExecutionAuthorization: "not_available_in_p19";
  evaluatedAt: string;
}

export class ReadinessGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadinessGateError";
  }
}

function visibilityValid(
  evidence: WorkbenchVisibilityEvidence,
): boolean {
  const required = [
    ["proposal", evidence.remediationId],
    ["plan", evidence.planId],
    ["approval", evidence.approvalId],
  ] as const;
  return (
    evidence.lifecycleTrace.remediationId === evidence.remediationId &&
    required.every(([kind, id]) =>
      evidence.lifecycleTrace.hops.some(
        (hop) => hop.kind === kind && hop.id === id && !hop.gap,
      ),
    )
  );
}

export function evaluateReadinessGate(
  input: ReadinessGateInput,
): ReadinessGateDecision {
  const { plan, approval, assessment, simulation, policy, visibility } = input;

  // Phase 1: correlation validation
  if (approval.decision !== "approved") {
    throw new ReadinessGateError(
      `approval decision must be "approved", got "${approval.decision}"`,
    );
  }
  if (approval.planId !== plan.planId) {
    throw new ReadinessGateError(
      `approval planId "${approval.planId}" does not match plan "${plan.planId}"`,
    );
  }
  if (approval.remediationId !== plan.remediationId) {
    throw new ReadinessGateError(
      `approval remediationId "${approval.remediationId}" does not match remediation "${plan.remediationId}"`,
    );
  }
  if (assessment.planId !== plan.planId) {
    throw new ReadinessGateError(
      `assessment planId "${assessment.planId}" does not match plan "${plan.planId}"`,
    );
  }
  if (assessment.remediationId !== plan.remediationId) {
    throw new ReadinessGateError(
      `assessment remediationId "${assessment.remediationId}" does not match remediation "${plan.remediationId}"`,
    );
  }
  if (assessment.approvalId !== approval.approvalId) {
    throw new ReadinessGateError(
      `assessment approvalId "${assessment.approvalId}" does not match approval "${approval.approvalId}"`,
    );
  }
  if (
    simulation !== null &&
    (simulation.planId !== plan.planId ||
      simulation.approvalId !== approval.approvalId ||
      simulation.assessmentId !== assessment.assessmentId)
  ) {
    throw new ReadinessGateError(
      `simulation correlation mismatch: planId="${simulation.planId}" approvalId="${simulation.approvalId}" assessmentId="${simulation.assessmentId}"`,
    );
  }

  // Phase 2: decision rules
  const reasons: string[] = [];
  let disposition: ReadinessDisposition;
  const visible = visibilityValid(visibility);

  if (!visible) {
    reasons.push("p18_visibility_missing");
    disposition = "blocked";
  } else if (assessment.readinessLevel === "external_side_effecting") {
    reasons.push("external_side_effect_blocked");
    disposition = "blocked";
  } else if (assessment.readinessLevel === "irreversible") {
    reasons.push("irreversible_action_blocked");
    disposition = "blocked";
  } else if (
    assessment.readinessLevel === "reversible" &&
    policy.requireCompleteRollbackForReversible &&
    !assessment.facts.rollbackCoverageComplete
  ) {
    reasons.push("rollback_coverage_incomplete");
    disposition = "blocked";
  } else if (
    policy.allowSemanticDryRunFor.includes(
      assessment.readinessLevel as "dry_run_capable" | "reversible",
    ) &&
    simulation?.status === "complete"
  ) {
    reasons.push("semantic_dry_run_allowed");
    disposition = "dry_run_allowed";
  } else {
    reasons.push("manual_handling_required");
    disposition = "manual_only";
  }

  const futureControlledExecutionCandidate =
    visible &&
    assessment.readinessLevel === "reversible" &&
    assessment.facts.rollbackCoverageComplete &&
    simulation?.status === "complete" &&
    policy.allowSemanticDryRunFor.includes("reversible");

  const evaluatedAt = input.options?.now ?? new Date().toISOString();
  const simulationId = simulation?.simulationId ?? null;
  reasons.sort();

  const decisionId = createHash("sha256")
    .update(
      [
        "p19.3",
        plan.planId,
        approval.approvalId,
        assessment.assessmentId,
        simulationId ?? "",
        policy.policyId,
        disposition,
        evaluatedAt,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 16);

  return {
    decisionId,
    planId: plan.planId,
    remediationId: plan.remediationId,
    approvalId: approval.approvalId,
    assessmentId: assessment.assessmentId,
    simulationId,
    policyId: policy.policyId,
    disposition,
    reasonCodes: reasons,
    futureControlledExecutionCandidate,
    controlledExecutionAuthorization: "not_available_in_p19",
    evaluatedAt,
  };
}
