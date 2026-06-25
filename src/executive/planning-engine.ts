/**
 * P10.3 — Executive Planning Engine.
 *
 * Pure function layer that consumes P10.2 Executive Objectives and produces
 * ordered execution plans without dependency resolution.
 *
 * Core invariants:
 *  - No store access — plans computed fresh each dashboard run.
 *  - No mutation/apply path.
 *  - generatedAt inherited from objective report (not fresh Date).
 *  - Step IDs stable; dependsOn references IDs, not step numbers.
 *
 * @module
 */

import type { ExecutiveSubsystemName } from "./executive-health.js";
import type { ExecutiveObjectiveReport, ExecutiveObjective } from "./objective-engine.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLANNER_VERSION = "1.0";
export const PLANNING_ALGORITHM = "template-v1";

/** Per-action default durations (minutes). Exported for P10.4 reuse. */
export const ESTIMATED_DURATION_MINUTES: Partial<Record<ExecutionStepAction, number>> = {
  diagnose_root_cause: 30,
  create_remediation_proposal: 45,
  apply_remediation: 60,
  triage_investigations: 20,
  assign_investigation_ownership: 10,
  resolve_investigations: 45,
  audit_metrics: 15,
  identify_optimization_targets: 30,
  implement_improvements: 45,
  schedule_health_check: 10,
  review_baseline_metrics: 20,
  update_documentation: 15,
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExecutionStepAction =
  | "diagnose_root_cause"
  | "create_remediation_proposal"
  | "apply_remediation"
  | "triage_investigations"
  | "assign_investigation_ownership"
  | "resolve_investigations"
  | "audit_metrics"
  | "identify_optimization_targets"
  | "implement_improvements"
  | "schedule_health_check"
  | "review_baseline_metrics"
  | "update_documentation";

export type ExecutionStepStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface ExecutionStep {
  /** Stable identity — survives replanning, used for dependsOn. */
  id: string;
  /** Machine action kind — P10.4 dispatches on this, never on title. */
  action: ExecutionStepAction;
  /** Human-readable title for display (terminal / JSON). */
  title: string;
  /** 1-based step number in the overall plan sequence (display / ordering). */
  stepNumber: number;
  /** Subsystem this step operates on (typed — compile-time guarantee). */
  targetSubsystem: ExecutiveSubsystemName;
  /** Step IDs this step depends on (subsystem-local only). Stable references. */
  dependsOn: string[];
  status: ExecutionStepStatus;
  /** The objective that generated this step. */
  objectiveId: string;
  /** Copied from the originating objective's priorityScore. */
  priorityScore: number;
  /** Copied from the originating objective's objectiveScore. */
  objectiveScore: number;
  /** Risk derived from the originating objective — not hardcoded per type. */
  riskLevel: "low" | "medium" | "high";
  /** Rough execution estimate for P10.4 scheduling. */
  estimatedDurationMinutes?: number;
}

export type PlanStatus = "draft" | "ready" | "blocked";

export interface ExecutionPlan {
  id: string;
  /** Objective IDs this plan covers. */
  objectives: string[];
  /** Ordered step sequence. */
  steps: ExecutionStep[];
  generatedAt: string;
  windowDays: number;
  planStatus: PlanStatus;
  sourceReportId?: string;
  rationale?: string;
  plannerVersion: string;
  planningAlgorithm: string;
}

// ---------------------------------------------------------------------------
// Action name constants (refactoring-safe — use these, not raw strings)
// ---------------------------------------------------------------------------

/** @see ExecutionStepAction for the full union type. */
export const STEP_ACTION = {
  DIAGNOSE_ROOT_CAUSE: "diagnose_root_cause",
  CREATE_REMEDIATION_PROPOSAL: "create_remediation_proposal",
  APPLY_REMEDIATION: "apply_remediation",
  TRIAGE_INVESTIGATIONS: "triage_investigations",
  ASSIGN_INVESTIGATION_OWNERSHIP: "assign_investigation_ownership",
  RESOLVE_INVESTIGATIONS: "resolve_investigations",
  AUDIT_METRICS: "audit_metrics",
  IDENTIFY_OPTIMIZATION_TARGETS: "identify_optimization_targets",
  IMPLEMENT_IMPROVEMENTS: "implement_improvements",
  SCHEDULE_HEALTH_CHECK: "schedule_health_check",
  REVIEW_BASELINE_METRICS: "review_baseline_metrics",
  UPDATE_DOCUMENTATION: "update_documentation",
} as const satisfies Record<string, ExecutionStepAction>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic step ID — enables cross-run comparison. */
function makeStepId(objectiveId: string, subsystem: string, action: string): string {
  return `step-${objectiveId}-${subsystem}-${action}`;
}

/** Plan ID (timestamp-based for uniqueness — plans are not compared across runs). */
function planId(generatedAt: string, windowDays: number): string {
  // Deterministic: derived from timestamp + window, same inputs → same ID
  const ts = generatedAt.replace(/[^0-9]/g, "").slice(-6);
  return `plan-${ts}-${windowDays}`;
}

/** Exhaustiveness guard — compile-time + runtime protection for discriminated unions. */
function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`);
}

export function riskLevelFromScore(priorityScore: number, objectiveScore: number): "low" | "medium" | "high" {
  const max = Math.max(priorityScore, objectiveScore);
  if (max >= 70) return "high";
  if (max >= 40) return "medium";
  return "low";
}

function makeStep(
  obj: { id: string; priorityScore: number; objectiveScore: number },
  action: ExecutionStepAction,
  title: string,
  subsystem: ExecutiveSubsystemName,
  stepNumber: number,
  dependsOn: string[],
): ExecutionStep {
  return {
    id: makeStepId(obj.id, subsystem, action),
    action,
    title,
    stepNumber,
    targetSubsystem: subsystem,
    dependsOn,
    status: "pending",
    objectiveId: obj.id,
    priorityScore: obj.priorityScore,
    objectiveScore: obj.objectiveScore,
    riskLevel: riskLevelFromScore(obj.priorityScore, obj.objectiveScore),
    estimatedDurationMinutes: ESTIMATED_DURATION_MINUTES[action],
  };
}

// ---------------------------------------------------------------------------
// Step templates
// ---------------------------------------------------------------------------

/**
 * Decompose an objective into its sequence of ExecutionSteps.
 * Uses hardcoded templates per objective type with assertNever for
 * compile-time exhaustiveness checking.
 */
export function buildStepsForObjective(
  obj: { id: string; objectiveType: ExecutiveObjective["objectiveType"]; targetSubsystems: string[]; priorityScore: number; objectiveScore: number },
  targetSubsystem: ExecutiveSubsystemName,
  startAt: number,
): ExecutionStep[] {
  let i = 0;

  switch (obj.objectiveType) {
    case "stabilize":
      return [
        makeStep(obj, "diagnose_root_cause", "Diagnose root causes", targetSubsystem, startAt + i++, []),
        makeStep(obj, "create_remediation_proposal", "Create remediation proposal", targetSubsystem, startAt + i++, []),
        makeStep(obj, "apply_remediation", "Apply remediation", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        // Set intra-objective dependencies
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });

    case "investigate":
      return [
        makeStep(obj, "triage_investigations", "Triage open investigations", targetSubsystem, startAt + i++, []),
        makeStep(obj, "assign_investigation_ownership", "Assign investigation ownership", targetSubsystem, startAt + i++, []),
        makeStep(obj, "resolve_investigations", "Resolve investigations", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });

    case "improve":
      return [
        makeStep(obj, "audit_metrics", "Audit subsystem metrics", targetSubsystem, startAt + i++, []),
        makeStep(obj, "identify_optimization_targets", "Identify optimization targets", targetSubsystem, startAt + i++, []),
        makeStep(obj, "implement_improvements", "Implement improvements", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });

    case "maintain":
      return [
        makeStep(obj, "schedule_health_check", "Schedule health check", targetSubsystem, startAt + i++, []),
        makeStep(obj, "review_baseline_metrics", "Review baseline metrics", targetSubsystem, startAt + i++, []),
        makeStep(obj, "update_documentation", "Update documentation", targetSubsystem, startAt + i++, []),
      ].map((step, idx, arr) => {
        if (idx === 0) return step;
        return { ...step, dependsOn: [arr[idx - 1].id] };
      });

    default:
      return assertNever(obj.objectiveType, `Unknown objective type: ${obj.objectiveType}`);
  }
}
