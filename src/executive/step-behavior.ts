/**
 * P10.4a — StepBehavior classification for the 12 ExecutionStepAction kinds.
 *
 * Three stable classes: read-only (executes now), investigation (produces
 * investigation work — bridge future), mutation (produces system changes
 * — bridge future). Even though P10.4a treats investigation and mutation
 * identically (both → waiting_for_bridge), the type distinction prevents
 * rewrites when bridges arrive.
 *
 * @module
 */

import type { ExecutionStepAction } from "./planning-engine.js";

export type StepBehavior = "read-only" | "investigation" | "mutation";

/**
 * Stable classification of all 12 ExecutionStepAction kinds.
 * read-only (6): executes directly, records evidence.
 * investigation (3): triage/assign/resolve — workflow, not mutation.
 * mutation (3): propose/apply/implement — needs Proposal bridge.
 */
export const STEP_BEHAVIOR: Record<ExecutionStepAction, StepBehavior> = {
  // Read-only — pure orchestration, no side effects
  diagnose_root_cause: "read-only",
  audit_metrics: "read-only",
  identify_optimization_targets: "read-only",
  schedule_health_check: "read-only",
  review_baseline_metrics: "read-only",
  update_documentation: "read-only",
  // Investigation — workflow management, not system mutation
  triage_investigations: "investigation",
  assign_investigation_ownership: "investigation",
  resolve_investigations: "investigation",
  // Mutation — system state changes via Proposal pipeline
  create_remediation_proposal: "mutation",
  apply_remediation: "mutation",
  implement_improvements: "mutation",
};

/** Get the behavior class for a step action. Pure function. */
export function behaviorFor(action: ExecutionStepAction): StepBehavior {
  return STEP_BEHAVIOR[action];
}

/** All read-only action kinds. */
export const READ_ONLY_ACTIONS: ReadonlySet<ExecutionStepAction> = new Set(
  (Object.entries(STEP_BEHAVIOR) as [ExecutionStepAction, StepBehavior][])
    .filter(([, b]) => b === "read-only")
    .map(([a]) => a),
);

/** All investigation action kinds. */
export const INVESTIGATION_ACTIONS: ReadonlySet<ExecutionStepAction> = new Set(
  (Object.entries(STEP_BEHAVIOR) as [ExecutionStepAction, StepBehavior][])
    .filter(([, b]) => b === "investigation")
    .map(([a]) => a),
);

/** All mutation action kinds. */
export const MUTATION_ACTIONS: ReadonlySet<ExecutionStepAction> = new Set(
  (Object.entries(STEP_BEHAVIOR) as [ExecutionStepAction, StepBehavior][])
    .filter(([, b]) => b === "mutation")
    .map(([a]) => a),
);
