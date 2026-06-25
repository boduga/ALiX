/**
 * P10.4c — Executive Apply Reconciliation.
 *
 * Pure function that determines whether an `apply_remediation` step is
 * completed, based on the lifecycle of its sibling `create_remediation_proposal`
 * step's linked `AdaptationProposal`.
 *
 * @module
 */

import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { ExecutionStep } from "./planning-engine.js";
import type { AdaptationProposal } from "../adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApplyReconciliationResult {
  /** true when the apply step's proposal has reached "applied" status. */
  stepCompleted: boolean;
  /** The proposal ID that matched (set when a match is found, regardless of status). */
  matchedProposalId?: string;
  /** The sibling create step ID that was linked (set when a sibling is found, regardless of proposal match). */
  matchedCreateStepId?: string;
}

// ---------------------------------------------------------------------------
// Pure reconciler
// ---------------------------------------------------------------------------

/**
 * PURE: Determine whether an `apply_remediation` step is
 * completed based on the proposal lifecycle.
 *
 * Finds the sibling `create_remediation_proposal` step on the same objective,
 * then checks whether the linked proposal has reached "applied" status.
 *
 * @returns stepCompleted=false when no sibling, no match, or not yet applied.
 */
export function reconcileApplyStep(
  plan: PersistedExecutionPlan,
  step: ExecutionStep,
  proposals: AdaptationProposal[],
): ApplyReconciliationResult {
  // 1. Find sibling create_remediation_proposal step on same objective
  const createStep = plan.steps.find(
    s =>
      s.action === "create_remediation_proposal" &&
      s.objectiveId === step.objectiveId,
  );
  if (!createStep) return { stepCompleted: false };

  // 2. Find proposal targeting create step
  const match = proposals.find(p => {
    if (p.target?.kind !== "executive_remediation") return false;
    const t = p.target;
    return t.planId === plan.id && t.stepId === createStep.id;
  });
  if (!match) return { stepCompleted: false };

  // 3. Check if proposal has been fully applied
  return {
    stepCompleted: match.status === "applied",
    matchedProposalId: match.id,
    matchedCreateStepId: createStep.id,
  };
}
