/**
 * P10.2 — Executive Objective Engine.
 *
 * Pure function layer that consumes P10.0 health, P10.1 priorities, and P9.6
 * investigations to produce 0–8 strategic ExecutiveObjective records.
 *
 * Core invariants:
 *  - At most one objective per subsystem.
 *  - No store access — objectives computed fresh each dashboard run.
 *  - No mutation/apply path.
 *  - generatedAt inherited from healthReport (not fresh Date).
 *
 * @module
 */

import type { ExecutiveHealthReport } from "./executive-health.js";
import type { ExecutivePriorityReport, ExecutivePriorityEntry } from "./priority-engine.js";
import type { InvestigationRecommendation } from "../governance/investigation-types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExecutiveObjectiveType =
  | "stabilize"
  | "investigate"
  | "improve"
  | "maintain";

export type ExecutiveObjectiveStatus =
  | "proposed"
  | "accepted"
  | "active"
  | "completed"
  | "superseded";

export interface ExecutiveObjective {
  id: string;
  title: string;
  description: string;
  objectiveType: ExecutiveObjectiveType;
  status: ExecutiveObjectiveStatus;

  /** Inherited from P10.1 — executive urgency. */
  priorityScore: number;
  /** Computed by P10.2 — strategic importance. */
  objectiveScore: number;

  rationale: string;
  evidenceRefs: string[];
  suggestedActions: string[];

  /** Subsystem(s) this objective targets. */
  targetSubsystems: string[];

  /** P9.6 investigation ids that support this objective. */
  supportingInvestigations: string[];

  /** Explicit provenance — for explainability. */
  derivedFrom: {
    priorityReportGeneratedAt: string;
    investigationIds: string[];
  };

  blockers: string[];
  generatedAt: string;
}

export interface ExecutiveObjectiveReport {
  schemaVersion: "p10.2.0";
  generatedAt: string;
  windowDays: number;
  /** Sorted by objectiveScore descending. 0–8 entries. */
  objectives: ExecutiveObjective[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STABILIZE_THRESHOLD = 80;

// ---------------------------------------------------------------------------
// Objective scoring
// ---------------------------------------------------------------------------

interface ObjectiveScoreInputs {
  priorityScore: number;
  healthScore: number;
  persistenceScore: number;
  investigationCount: number;
}

function computeObjectiveScore(inputs: ObjectiveScoreInputs): number {
  const healthImpact = 100 - inputs.healthScore;
  const investigationPressure = Math.min(inputs.investigationCount * 10, 100);

  return Math.round(
    inputs.priorityScore * 0.40
    + healthImpact * 0.30
    + inputs.persistenceScore * 0.20
    + investigationPressure * 0.10,
  );
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36).slice(-6);
  return `${prefix}-${ts}-${rand}`;
}

function classifyObjectiveType(
  healthScore: number,
  priorityScore: number,
  topPriorityScore: number,
  investigationCount: number,
): { type: ExecutiveObjectiveType; rationale: string } {
  // stabilize: health < threshold AND priority in meaningful range
  if (healthScore < STABILIZE_THRESHOLD && priorityScore >= topPriorityScore * 0.6) {
    return {
      type: "stabilize",
      rationale: `Subsystem health is ${healthScore} (below ${STABILIZE_THRESHOLD}) with elevated priority. Requires immediate stabilization.`,
    };
  }

  // investigate: has open investigations
  if (investigationCount > 0) {
    return {
      type: "investigate",
      rationale: `${investigationCount} open investigation(s) require operator diagnosis and remediation.`,
    };
  }

  // improve: healthy but room for growth
  if (healthScore >= STABILIZE_THRESHOLD && healthScore < 90) {
    return {
      type: "improve",
      rationale: `Subsystem health is ${healthScore} — stable with measurable opportunity for improvement.`,
    };
  }

  // maintain: everything healthy
  return {
    type: "maintain",
    rationale: `Subsystem health is ${healthScore} with no active issues. Maintain current trajectory.`,
  };
}

// ---------------------------------------------------------------------------
// Investigation-to-subsystem mapping
// ---------------------------------------------------------------------------

/**
 * Currently all P9.6 investigations are governance investigations
 * (chain_restoration, governance_integrity). When investigations span
 * other subsystems, add a targetSubsystems field to InvestigationRecommendation.
 */
function investigationSubsystem(_inv: InvestigationRecommendation): string {
  return "governance";
}

// ---------------------------------------------------------------------------
// Objective builder
// ---------------------------------------------------------------------------

function buildSuggestedActions(type: ExecutiveObjectiveType, subsystem: string, _score: number): string[] {
  void _score;
  switch (type) {
    case "stabilize":
      return [
        `Investigate root causes of ${subsystem} degradation`,
        `Review recent changes affecting ${subsystem}`,
        `Create remediation proposals for ${subsystem}`,
      ];
    case "investigate":
      return [
        `Triage open ${subsystem} investigations`,
        `Assign ownership to responsible team`,
        `Track investigation resolution progress`,
      ];
    case "improve":
      return [
        `Identify optimization opportunities in ${subsystem}`,
        `Review ${subsystem} metrics for improvement areas`,
        `Consider automation or configuration updates`,
      ];
    case "maintain":
      return [
        `Continue monitoring ${subsystem} health`,
        `Run regular ${subsystem} health checks`,
        `Document current ${subsystem} state as baseline`,
      ];
  }
}

function buildObjectiveForSubsystem(
  subsystem: string,
  healthScore: number,
  priorityEntry: ExecutivePriorityEntry,
  investigations: InvestigationRecommendation[],
  topPriorityScore: number,
  generatedAt: string,
): ExecutiveObjective {
  const subsystemInvestigations = investigations.filter(
    (inv) => inv.status === "open" && investigationSubsystem(inv) === subsystem,
  );

  const { type, rationale } = classifyObjectiveType(
    healthScore,
    priorityEntry.priorityScore,
    topPriorityScore,
    subsystemInvestigations.length,
  );

  const objectiveScore = computeObjectiveScore({
    priorityScore: priorityEntry.priorityScore,
    healthScore,
    persistenceScore: priorityEntry.trendScore,
    investigationCount: subsystemInvestigations.length,
  });

  return {
    id: shortId("obj"),
    title: `${capitalize(type)} ${capitalize(subsystem)}`,
    description: `${capitalize(type)} objective for ${subsystem} (score: ${healthScore}). ${rationale}`,
    objectiveType: type,
    status: "proposed" as ExecutiveObjectiveStatus,
    priorityScore: priorityEntry.priorityScore,
    objectiveScore,
    rationale,
    evidenceRefs: [priorityEntry.summary],
    suggestedActions: buildSuggestedActions(type, subsystem, healthScore),
    targetSubsystems: [subsystem],
    supportingInvestigations: subsystemInvestigations.map((i) => i.id),
    derivedFrom: {
      priorityReportGeneratedAt: generatedAt,
      investigationIds: subsystemInvestigations.map((i) => i.id),
    },
    blockers: [],
    generatedAt,
  };
}

// ---------------------------------------------------------------------------
// buildObjectiveReport — top-level generator
// ---------------------------------------------------------------------------

/**
 * Pure function: consume P10.0 health, P10.1 priorities, and P9.6 investigations
 * to produce an ExecutiveObjectiveReport with 0–8 objectives (at most one per subsystem).
 *
 * Objectives are classified as stabilize / investigate / improve / maintain,
 * scored by the 4-component weighted formula, and sorted by objectiveScore descending.
 */
export function buildObjectiveReport(
  healthReport: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  investigations: InvestigationRecommendation[],
): ExecutiveObjectiveReport {
  const generatedAt = healthReport.generatedAt;
  const topPriorityScore = priorityReport.priorities[0]?.priorityScore ?? 0;

  const objectives: ExecutiveObjective[] = [];

  for (const sub of healthReport.rankedSubsystems) {
    const priorityEntry = priorityReport.priorities.find(
      (p) => p.subsystem === sub.subsystem,
    );
    if (!priorityEntry) continue;

    const obj = buildObjectiveForSubsystem(
      sub.subsystem,
      sub.score,
      priorityEntry,
      investigations,
      topPriorityScore,
      generatedAt,
    );

    objectives.push(obj);
  }

  // Sort by objectiveScore descending
  objectives.sort((a, b) => b.objectiveScore - a.objectiveScore);

  return {
    schemaVersion: "p10.2.0",
    generatedAt,
    windowDays: healthReport.windowDays,
    objectives,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
