import { randomUUID } from "node:crypto";
import type { SignalFrame } from "./signal-frame.js";
import { decodeSignalCode } from "./signal-frame.js";

/**
 * Actions the offering planner can prescribe — what ALiX should PREPARE
 * to do in response to a signal.
 */
export type OfferingAction =
  | "ask_approval"
  | "run_policy_check"
  | "fetch_memory"
  | "run_test"
  | "replay_preview"
  | "rollback_preview"
  | "pause"
  | "proceed";

/**
 * A plan describing what corrective action ALiX should PREPARE to take.
 * The offering is advisory only — it does NOT execute anything.
 */
export type OfferingPlan = {
  offeringId: string;
  signalId: string;
  action: OfferingAction;
  requiredEvidence: string[];
  constraints: string[];
  taboos: string[];
  successCriteria: string[];
  createdAt: string;
};

/**
 * Map a `SignalFrame` to an `OfferingPlan`.
 *
 * Rules are evaluated in priority order (first match wins).  The returned
 * plan describes what ALiX should PREPARE to do — it is advisory only.
 *
 * @param signal - The signal frame to evaluate.
 * @returns An offering plan with action, evidence requirements, and
 *          derived constraints / taboos.
 */
export function prescribeOffering(signal: SignalFrame): OfferingPlan {
  const bits = decodeSignalCode(signal.code);

  /* ------------------------------------------------------------------ */
  /*  Rule evaluation (first match wins)                                 */
  /* ------------------------------------------------------------------ */

  let action: OfferingAction;
  let requiredEvidence: string[];
  let successCriteria: string[];

  if (bits.policyRisk && bits.approvalRequired) {
    action = "ask_approval";
    requiredEvidence = ["policy_decision", "approval_status"];
    successCriteria = ["approval_granted"];
  } else if (bits.mutationPossible && bits.replayRollbackContext) {
    action = "rollback_preview";
    requiredEvidence = ["replay_diff", "rollback_plan"];
    successCriteria = ["diff_generated", "plan_reviewed"];
  } else if (bits.memoryRequired) {
    action = "fetch_memory";
    requiredEvidence = ["memory_index", "session_context"];
    successCriteria = ["memory_loaded"];
  } else if (bits.freshnessRequired) {
    action = "run_policy_check";
    requiredEvidence = ["current_state", "policy_rules"];
    successCriteria = ["policy_verified"];
  } else if (bits.toolRequired && bits.policyRisk) {
    action = "pause";
    requiredEvidence = ["tool_listing", "policy_decision"];
    successCriteria = ["tool_reviewed", "risk_assessed"];
  } else if (signal.domain === "rollback") {
    action = "rollback_preview";
    requiredEvidence = ["replay_diff", "rollback_plan"];
    successCriteria = ["diff_generated"];
  } else if (signal.domain === "replay") {
    action = "replay_preview";
    requiredEvidence = ["trace_events", "replay_plan"];
    successCriteria = ["preview_generated"];
  } else if (signal.domain === "research") {
    action = "proceed";
    requiredEvidence = [];
    successCriteria = ["research_completed"];
  } else {
    action = "proceed";
    requiredEvidence = [];
    successCriteria = ["execution_completed"];
  }

  /* ------------------------------------------------------------------ */
  /*  Constraints                                                        */
  /* ------------------------------------------------------------------ */

  // Carry forward recognised constraint values from the signal.
  const constraints: string[] = [];
  for (const c of signal.constraints) {
    if (c === "require_approval" || c === "require_policy_check") {
      constraints.push(c);
    }
  }
  // Action-specific additions
  if (action === "proceed") {
    constraints.push("proceed_with_confidence");
  }
  if (action === "pause") {
    constraints.push("require_human_review");
  }

  /* ------------------------------------------------------------------ */
  /*  Taboos                                                             */
  /* ------------------------------------------------------------------ */

  // Carry forward recognised taboo values from the signal.
  const taboos: string[] = [];
  for (const t of signal.taboos) {
    if (t === "no_side_effects_without_approval" || t === "no_mutation") {
      taboos.push(t);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Build plan                                                         */
  /* ------------------------------------------------------------------ */

  return {
    offeringId: randomUUID(),
    signalId: signal.signalId,
    action,
    requiredEvidence,
    constraints,
    taboos,
    successCriteria,
    createdAt: new Date().toISOString(),
  };
}
