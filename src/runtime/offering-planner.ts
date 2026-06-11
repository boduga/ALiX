import { randomUUID } from "node:crypto";
import type { SignalFrame } from "./signal-frame.js";
import { decodeSignalCode } from "./signal-frame.js";

/**
 * Actions the offering planner can prescribe — what ALiX should PREPARE
 * to do in response to a signal.  The offering is advisory only.
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

type Rule = {
  action: OfferingAction;
  requiredEvidence: string[];
  successCriteria: string[];
};

/**
 * Map a `SignalFrame` to an `OfferingPlan`.
 *
 * Rules are evaluated in priority order (first match wins).  Deterministic
 * ordering ensures the same signal always produces the same plan.
 *
 * @param signal - The signal frame to evaluate.
 * @returns An offering plan with action, evidence requirements, and
 *          derived constraints / taboos.
 */
export function prescribeOffering(signal: SignalFrame): OfferingPlan {
  const bits = decodeSignalCode(signal.code);

  /* ------------------------------------------------------------------ */
  /*  Rule evaluation — first match wins                                 */
  /*                                                                     */
  /*  1. approvalRequired || (toolRequired && policyRisk)  → ask_approval */
  /*  2. replayRollbackContext && mutationPossible          → rollback_preview */
  /*  3. replayRollbackContext                              → replay_preview  */
  /*  4. freshnessRequired && memoryRequired                 → fetch_memory   */
  /*  5. freshnessRequired                                  → run_policy_check */
  /*  6. memoryRequired                                     → fetch_memory    */
  /*  7. policyRisk                                         → run_policy_check */
  /*  8. toolRequired                                       → proceed         */
  /*  9. otherwise                                          → proceed         */
  /* ------------------------------------------------------------------ */

  let rule: Rule;

  if (bits.approvalRequired || (bits.toolRequired && bits.policyRisk)) {
    rule = {
      action: "ask_approval",
      requiredEvidence: ["policy_decision", "approval_status"],
      successCriteria: ["approval_granted"],
    };
  } else if (bits.replayRollbackContext && bits.mutationPossible) {
    rule = {
      action: "rollback_preview",
      requiredEvidence: ["replay_diff", "rollback_plan"],
      successCriteria: ["diff_generated", "plan_reviewed"],
    };
  } else if (bits.replayRollbackContext) {
    rule = {
      action: "replay_preview",
      requiredEvidence: ["trace_events", "replay_plan"],
      successCriteria: ["preview_generated"],
    };
  } else if (bits.freshnessRequired && bits.memoryRequired) {
    rule = {
      action: "fetch_memory",
      requiredEvidence: ["memory_index", "session_context"],
      successCriteria: ["memory_loaded"],
    };
  } else if (bits.freshnessRequired) {
    rule = {
      action: "run_policy_check",
      requiredEvidence: ["current_state", "policy_rules"],
      successCriteria: ["policy_verified"],
    };
  } else if (bits.memoryRequired) {
    rule = {
      action: "fetch_memory",
      requiredEvidence: ["memory_index", "session_context"],
      successCriteria: ["memory_loaded"],
    };
  } else if (bits.policyRisk) {
    rule = {
      action: "run_policy_check",
      requiredEvidence: ["current_state", "policy_rules"],
      successCriteria: ["policy_verified"],
    };
  } else if (bits.toolRequired) {
    rule = {
      action: "proceed",
      requiredEvidence: ["tool_listing"],
      successCriteria: ["execution_completed"],
    };
  } else {
    rule = {
      action: "proceed",
      requiredEvidence: [],
      successCriteria: ["execution_completed"],
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Constraints — carry forward recognised values from the signal,    */
  /*  then add action-specific entries.                                  */
  /* ------------------------------------------------------------------ */

  const constraints: string[] = [];
  for (const c of signal.constraints) {
    if (c === "require_approval" || c === "require_policy_check") {
      constraints.push(c);
    }
  }
  if (rule.action === "proceed") {
    constraints.push("proceed_with_confidence");
  }
  if (rule.action === "pause") {
    constraints.push("require_human_review");
  }

  /* ------------------------------------------------------------------ */
  /*  Taboos — carry forward recognised values from the signal.          */
  /* ------------------------------------------------------------------ */

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
    action: rule.action,
    requiredEvidence: rule.requiredEvidence,
    constraints,
    taboos,
    successCriteria: rule.successCriteria,
    createdAt: new Date().toISOString(),
  };
}
