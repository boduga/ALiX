/**
 * P10.5a — Executive Outcome Evaluation.
 *
 * Pure function that compares subsystem health before and after a plan
 * executed and classifies per-objective outcomes.
 *
 * @module
 */

import type { PersistedExecutionPlan } from "./executive-plan-types.js";
import type { PlanExecutionState, PlanStatus } from "./executive-plan-types.js";
import type { ExecutiveTrendSnapshot } from "./trend-store.js";
import type { ExecutiveSubsystemName } from "./executive-health.js";
import type { ExecutiveObjectiveType } from "./objective-engine.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EvaluationStatus =
  | "completed"
  | "insufficient_data"
  | "plan_not_executed";
// NOTE: plan_not_found lives only in the CLI handler — the pure
// evaluator receives a plan object, so it cannot return this status.

export type OutcomeClassification =
  | "improved"
  | "degraded"
  | "unchanged"
  | "mixed";

export interface SubsystemDelta {
  subsystem: ExecutiveSubsystemName;
  baselineScore: number;
  currentScore: number;
  delta: number;
}

export interface ObjectiveOutcome {
  objectiveId: string;
  objectiveType: ExecutiveObjectiveType;
  targetSubsystems: string[];
  subsystemDeltas: SubsystemDelta[];
  aggregateDelta: number;
  outcome: OutcomeClassification;
}

export interface ExecutiveOutcomeEvaluationReport {
  schemaVersion: "p10.5.0";
  generatedAt: string;
  planId: string;
  planStatus: PlanStatus;
  evaluationStatus: EvaluationStatus;
  baselineSnapshotId?: string;
  baselineGeneratedAt?: string;
  currentSnapshotId?: string;
  currentGeneratedAt?: string;
  evaluatedSubsystems: ExecutiveSubsystemName[];
  objectives: ObjectiveOutcome[];
  overallDelta: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IMPROVE_THRESHOLD = 5;
const DEGRADE_THRESHOLD = -5;

// ---------------------------------------------------------------------------
// Type inference from step actions
// ---------------------------------------------------------------------------
// PersistedExecutionPlan only stores objective IDs (strings), not full
// ExecutiveObjective objects. Infer objective type from step actions:
//   stabilize: diagnose_root_cause -> create_remediation_proposal -> apply_remediation
//   investigate: triage_investigations, assign_investigation_ownership, resolve_investigations
//   improve: audit_metrics, identify_optimization_targets, implement_improvements
//   maintain: schedule_health_check, review_baseline_metrics, update_documentation

const STABILIZE_ACTIONS = new Set([
  "diagnose_root_cause", "create_remediation_proposal", "apply_remediation",
]);
const INVESTIGATE_ACTIONS = new Set([
  "triage_investigations", "assign_investigation_ownership", "resolve_investigations",
]);
const IMPROVE_ACTIONS = new Set([
  "audit_metrics", "identify_optimization_targets", "implement_improvements",
]);
const MAINTAIN_ACTIONS = new Set([
  "schedule_health_check", "review_baseline_metrics", "update_documentation",
]);

function inferObjectiveType(
  steps: PersistedExecutionPlan["steps"],
  objectiveId: string,
): ExecutiveObjectiveType {
  const objectiveSteps = steps.filter(s => s.objectiveId === objectiveId);
  const actions = new Set(objectiveSteps.map(s => s.action));
  if (actions.size === 0) return "maintain";
  for (const a of actions) if (STABILIZE_ACTIONS.has(a)) return "stabilize";
  for (const a of actions) if (INVESTIGATE_ACTIONS.has(a)) return "investigate";
  for (const a of actions) if (IMPROVE_ACTIONS.has(a)) return "improve";
  return "maintain";
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function classifyOutcome(deltas: SubsystemDelta[]): OutcomeClassification {
  const hasImproved = deltas.some(d => d.delta >= IMPROVE_THRESHOLD);
  const hasDegraded = deltas.some(d => d.delta <= DEGRADE_THRESHOLD);

  if (hasImproved && hasDegraded) return "mixed";
  if (hasImproved) return "improved";
  if (hasDegraded) return "degraded";
  return "unchanged";
}

function computeDelta(
  subsystem: ExecutiveSubsystemName,
  baseline: ExecutiveTrendSnapshot,
  current: ExecutiveTrendSnapshot,
): SubsystemDelta | null {
  const baselineScore = baseline.subsystemScores[subsystem];
  const currentScore = current.subsystemScores[subsystem];
  if (baselineScore === undefined || currentScore === undefined) return null;
  return {
    subsystem,
    baselineScore,
    currentScore,
    delta: currentScore - baselineScore,
  };
}

// ---------------------------------------------------------------------------
// Not-executed statuses (plans that never reached a terminal outcome)
// ---------------------------------------------------------------------------

const NOT_EXECUTED_STATUSES: PlanStatus[] = [
  "draft", "running", "blocked", "cancelled", "rejected",
];

// ---------------------------------------------------------------------------
// Pure evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate the outcome of an executed plan by comparing subsystem health
 * before and after execution.
 *
 * Pure function — no side effects, no store access, no writes.
 *
 * Returns plan_not_executed if the plan never reached 'completed' or 'failed'.
 * Returns insufficient_data if baseline or current snapshots are missing.
 */
export function evaluatePlanOutcome(
  plan: PersistedExecutionPlan,
  state: PlanExecutionState,
  baseline: ExecutiveTrendSnapshot | null,
  current: ExecutiveTrendSnapshot | null,
): ExecutiveOutcomeEvaluationReport {
  const generatedAt = new Date().toISOString();

  // ── Guard: plan not in a terminal/executed state ─────────────
  if (NOT_EXECUTED_STATUSES.includes(state.status)) {
    return {
      schemaVersion: "p10.5.0",
      generatedAt,
      planId: plan.id,
      planStatus: state.status,
      evaluationStatus: "plan_not_executed",
      evaluatedSubsystems: [],
      objectives: [],
      overallDelta: 0,
      warnings: [`Plan has status "${state.status}" — not yet executed`],
    };
  }

  // ── Guard: insufficient data ─────────────────────────────────
  if (!baseline || !current) {
    return {
      schemaVersion: "p10.5.0",
      generatedAt,
      planId: plan.id,
      planStatus: state.status,
      evaluationStatus: "insufficient_data",
      evaluatedSubsystems: [],
      objectives: [],
      overallDelta: 0,
      warnings: [!baseline ? "No baseline snapshot found" : "No current snapshot found"].filter(Boolean),
    };
  }

  // ── Derive target subsystems from plan steps ──────────────────
  const subsystemSet = new Set<ExecutiveSubsystemName>();
  const objectiveSubsystems = new Map<string, ExecutiveSubsystemName[]>();

  for (const step of plan.steps) {
    subsystemSet.add(step.targetSubsystem as ExecutiveSubsystemName);
    const subs = objectiveSubsystems.get(step.objectiveId) ?? [];
    if (!subs.includes(step.targetSubsystem as ExecutiveSubsystemName)) {
      subs.push(step.targetSubsystem as ExecutiveSubsystemName);
    }
    objectiveSubsystems.set(step.objectiveId, subs);
  }

  // ── Compute per-objective outcomes ────────────────────────────
  const objectives: ObjectiveOutcome[] = [];

  for (const [objectiveId, subsystems] of objectiveSubsystems) {
    const deltas = subsystems
      .map(s => computeDelta(s, baseline, current))
      .filter((d): d is SubsystemDelta => d !== null);

    if (deltas.length === 0) continue;

    const aggregateDelta = Math.round(
      deltas.reduce((sum, d) => sum + d.delta, 0) / deltas.length,
    );

    objectives.push({
      objectiveId,
      objectiveType: inferObjectiveType(plan.steps, objectiveId),
      targetSubsystems: subsystems,
      subsystemDeltas: deltas,
      aggregateDelta,
      outcome: classifyOutcome(deltas),
    });
  }

  // ── Compute overall metrics ───────────────────────────────────
  const allDeltas = objectives.flatMap(o => o.subsystemDeltas);
  const overallDelta = allDeltas.length > 0
    ? Math.round(allDeltas.reduce((sum, d) => sum + d.delta, 0) / allDeltas.length)
    : 0;

  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId: plan.id,
    planStatus: state.status,
    evaluationStatus: "completed",
    baselineSnapshotId: baseline.id,
    baselineGeneratedAt: baseline.generatedAt,
    currentSnapshotId: current.id,
    currentGeneratedAt: current.generatedAt,
    evaluatedSubsystems: Array.from(subsystemSet),
    objectives,
    overallDelta,
    warnings: [],
  };
}
