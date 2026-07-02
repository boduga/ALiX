// src/planning/build-strategic-plan.ts
//
// P11.3 — Pure function that transforms a RootCauseAnalysis into a StrategicPlan.
//
// Consumes RootCauseAnalysis (P11.2) and produces a StrategicPlan with ranked
// objectives, causal ordering, estimated effort, and advisory-only recommendations.
//
// Pure function — no I/O, no side effects, no Date.now(), no Math.random().
// Fully deterministic.

import type { CorrelationSubsystemId } from "../correlation/correlation-types.js";
import type {
  RootCauseAnalysis,
  CausalFinding,
  LikelyCause,
  CausalMechanism,
} from "../reasoning/reasoning-types.js";
import type {
  StrategicPlan,
  PlanningObjective,
  PlanningEngineConfig,
  EffortEstimate,
  StrategicImpact,
  PlanStatus,
} from "./planning-types.js";
import { DEFAULT_PLANNING_CONFIG } from "./planning-config.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_OBJECTIVES = 8;
const DEFAULT_MIN_URGENCY_SCORE = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip non-alphanumeric characters to produce a safe timestamp for IDs.
 */
function sanitizeTimestamp(iso: string): string {
  return iso.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Compute composite urgency score (0–100) for a single CausalFinding.
 *
 * For findings with causes:
 *   severityComponent   = (100 - currentScore) / 100           // 0.0–1.0
 *   confidenceComponent = topCause.confidence                   // 0.0–1.0
 *   impactComponent     = min(downstreamCount / 3, 1)           // capped at 1.0
 *   urgencyScore = floor(
 *     severityComponent * 40 + confidenceComponent * 35 + impactComponent * 25
 *   )
 *
 * For no-cause findings:
 *   urgencyScore = floor((100 - currentScore) / 100 * 25)      // max 25
 */
function computeUrgencyScore(
  finding: CausalFinding,
  downstreamCount: number,
): number {
  const topCause = finding.likelyCauses[0];

  if (topCause) {
    const severityComponent = (100 - finding.currentScore) / 100;
    const confidenceComponent = topCause.confidence;
    const impactComponent = Math.min(downstreamCount / 3, 1);

    return Math.floor(
      severityComponent * 40 + confidenceComponent * 35 + impactComponent * 25,
    );
  }

  // No identified cause — severity-only component, max 25
  return Math.floor(((100 - finding.currentScore) / 100) * 25);
}

/**
 * Map a causal mechanism (or absence) to an effort estimate with rationale.
 *
 * Default mapping:
 *   temporal_cascade       → medium — Single causal chain
 *   concurrent_degradation → high   — Shared root cause
 *   inverse_correlation    → high   — Potential conflict
 *   degradation_chain      → high   — Spans multiple subsystems
 *   no cause               → low    — Isolated investigation
 *
 * Effort overrides in config take precedence over the default mapping.
 */
function estimateEffort(
  topCause: LikelyCause | undefined,
  config: PlanningEngineConfig,
): { estimatedEffort: EffortEstimate; effortRationale: string } {
  if (!topCause) {
    return {
      estimatedEffort: "low",
      effortRationale: "Isolated investigation of the subsystem itself",
    };
  }

  const mechanism = topCause.mechanism;

  // Check for config-level override first
  if (config.effortOverrides?.[mechanism] !== undefined) {
    const overridden = config.effortOverrides[mechanism]!;
    const rationaleMap: Record<EffortEstimate, string> = {
      low: "Isolated investigation of the subsystem itself",
      medium: "Single causal chain — inspect changes in cause subsystem",
      high: "Complex root cause requiring coordinated changes across subsystems",
    };
    return {
      estimatedEffort: overridden,
      effortRationale: rationaleMap[overridden],
    };
  }

  // Default effort mapping per mechanism
  switch (mechanism) {
    case "temporal_cascade":
      return {
        estimatedEffort: "medium",
        effortRationale:
          "Single causal chain — inspect changes in cause subsystem",
      };
    case "concurrent_degradation":
      return {
        estimatedEffort: "high",
        effortRationale:
          "Shared root cause requires system-level investigation",
      };
    case "inverse_correlation":
      return {
        estimatedEffort: "high",
        effortRationale:
          "Potential conflict between subsystems — needs careful tradeoff",
      };
    case "degradation_chain":
      return {
        estimatedEffort: "high",
        effortRationale:
          "Spans multiple subsystems — coordinated fix required",
      };
  }
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Transform a RootCauseAnalysis into a StrategicPlan.
 *
 * **11-step algorithm:**
 *   1. Input validation — map analysis status to plan status
 *   2. Build findings index (primarySubsystem → CausalFinding)
 *   3. Build downstream dependency map (cause → dependents)
 *   4. Compute composite urgency score per finding
 *   5. Sort by urgency, filter by threshold, cap by max
 *   6. Determine expected impact breadth (direct/indirect/compound)
 *   7. Estimate effort per finding (with config overrides)
 *   8. Populate topCauseSubsystem
 *   9. Assign prerequisites based on causal ordering
 *  10. Generate human-readable rationale
 *  11. Assemble final StrategicPlan
 *
 * Pure function — no I/O, no side effects.
 */
export function buildStrategicPlan(
  analysis: RootCauseAnalysis,
  config: PlanningEngineConfig = DEFAULT_PLANNING_CONFIG,
): StrategicPlan {
  const generatedAt = analysis.generatedAt;
  const planId = "strat-" + sanitizeTimestamp(generatedAt);

  // -----------------------------------------------------------------------
  // Step 1 — Input validation
  // -----------------------------------------------------------------------

  if (analysis.status === "insufficient_history" || analysis.status === "stale") {
    return buildEarlyReturnPlan(
      planId,
      generatedAt,
      analysis,
      "insufficient_analysis",
    );
  }

  if (analysis.status === "no_degradation") {
    return buildEarlyReturnPlan(
      planId,
      generatedAt,
      analysis,
      "no_degradation",
    );
  }

  // Only "insufficient_edges" and "ok" proceed past here.
  // We validated that findings is a non-nullish array (type carries this).

  // -----------------------------------------------------------------------
  // Step 2 — Build findings index: primarySubsystem → CausalFinding
  // -----------------------------------------------------------------------

  const findingsIndex = new Map<CorrelationSubsystemId, CausalFinding>();
  for (const finding of analysis.findings) {
    findingsIndex.set(finding.primarySubsystem, finding);
  }

  // -----------------------------------------------------------------------
  // Step 3 — Build downstream dependency map
  //
  // For each finding, for each likelyCause, add the finding's primarySubsystem
  // to downstreamMap.get(causeSubsystem) or create entry.
  // -----------------------------------------------------------------------

  const downstreamMap = new Map<CorrelationSubsystemId, CorrelationSubsystemId[]>();
  for (const finding of analysis.findings) {
    for (const cause of finding.likelyCauses) {
      const causeSubsystem = cause.causeSubsystem;
      let dependents = downstreamMap.get(causeSubsystem);
      if (!dependents) {
        dependents = [];
        downstreamMap.set(causeSubsystem, dependents);
      }
      dependents.push(finding.primarySubsystem);
    }
  }

  // -----------------------------------------------------------------------
  // Step 4 — Compute urgency score per finding
  // -----------------------------------------------------------------------

  interface ScoredFinding {
    finding: CausalFinding;
    urgencyScore: number;
    downstreamCount: number;
  }

  const scoredFindings: ScoredFinding[] = [];
  for (const finding of analysis.findings) {
    const downstreamCount =
      downstreamMap.get(finding.primarySubsystem)?.length ?? 0;
    const urgencyScore = computeUrgencyScore(finding, downstreamCount);
    scoredFindings.push({ finding, urgencyScore, downstreamCount });
  }

  // -----------------------------------------------------------------------
  // Step 5 — Sort by urgencyScore descending, filter by min, cap by max
  // -----------------------------------------------------------------------

  const maxObjectives = config.maxObjectives ?? DEFAULT_MAX_OBJECTIVES;
  const minUrgencyScore = config.minUrgencyScore ?? DEFAULT_MIN_URGENCY_SCORE;

  const candidates = scoredFindings
    .slice() // avoid mutating the original array (extra safety)
    .sort((a, b) => b.urgencyScore - a.urgencyScore)
    .filter((sf) => sf.urgencyScore >= minUrgencyScore)
    .slice(0, maxObjectives);

  // If no candidates pass the threshold, return no_objectives
  if (candidates.length === 0) {
    return buildEarlyReturnPlan(
      planId,
      generatedAt,
      analysis,
      "no_objectives",
    );
  }

  // -----------------------------------------------------------------------
  // Step 6–10 — Build planning objectives for each candidate
  // -----------------------------------------------------------------------

  const objectives: PlanningObjective[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const { finding, urgencyScore, downstreamCount } = candidates[i];
    const topCause: LikelyCause | undefined = finding.likelyCauses[0];

    // Step 6 — Determine expected impact breadth
    const expectedImpact: StrategicImpact =
      downstreamCount === 0
        ? "direct"
        : downstreamCount === 1
          ? "indirect"
          : "compound";

    // improvesSubsystems = subsystems whose cause is this finding's primarySubsystem
    const improvesSubsystems: CorrelationSubsystemId[] =
      downstreamMap.get(finding.primarySubsystem) ?? [];

    // Step 7 — Estimate effort (with config overrides)
    const { estimatedEffort, effortRationale } = estimateEffort(topCause, config);

    // Step 8 — Populate topCauseSubsystem
    const topCauseSubsystem: CorrelationSubsystemId | null =
      topCause?.causeSubsystem ?? null;

    // Confidence is null for no-cause findings, never 0
    const confidence: number | null = topCause?.confidence ?? null;

    // Causal mechanism (null for no-cause)
    const mechanism: CausalMechanism | null = topCause?.mechanism ?? null;

    // Objective ID uses the candidate's sorted position
    const objectiveId =
      "strat-obj-" + sanitizeTimestamp(generatedAt) + "-" + i;

    // Step 10 — Generate human-readable rationale
    const rationale = topCause
      ? `${finding.primarySubsystem} degraded (score: ${finding.currentScore}). Priority: ${urgencyScore}/100.`
      : `${finding.primarySubsystem} degraded (score: ${finding.currentScore}) with no identified cause. Independent investigation needed. Priority: ${urgencyScore}/100.`;

    const objective: PlanningObjective = {
      id: objectiveId,
      targetSubsystem: finding.primarySubsystem,
      targetMetric: finding.drivingMetric,
      topCauseSubsystem,
      currentScore: finding.currentScore,
      urgencyScore,
      expectedImpact,
      improvesSubsystems,
      estimatedEffort,
      effortRationale,
      prerequisites: [],
      confidence,
      mechanism,
      sourceFindingSubsystem: finding.primarySubsystem,
      rationale,
    };

    objectives.push(objective);
  }

  // -----------------------------------------------------------------------
  // Step 9 — Assign prerequisites
  //
  // For each objective A whose targetSubsystem equals another objective B's
  // topCauseSubsystem, if A.urgencyScore >= B.urgencyScore, push A.id to
  // B.prerequisites.
  // -----------------------------------------------------------------------

  for (const objectiveB of objectives) {
    for (const objectiveA of objectives) {
      if (objectiveA === objectiveB) continue;
      if (
        objectiveA.targetSubsystem === objectiveB.topCauseSubsystem &&
        objectiveA.urgencyScore >= objectiveB.urgencyScore
      ) {
        objectiveB.prerequisites.push(objectiveA.id);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Step 11 — Assemble and return final StrategicPlan
  // -----------------------------------------------------------------------

  const planStatus: PlanStatus =
    analysis.status === "insufficient_edges" && objectives.length > 0
      ? "ok"
      : analysis.status === "insufficient_edges" && objectives.length === 0
        ? "no_objectives"
        : objectives.length > 0
          ? "ok"
          : "no_objectives";

  // Count effort categories for meta
  let objectivesLow = 0;
  let objectivesMedium = 0;
  let objectivesHigh = 0;
  for (const obj of objectives) {
    if (obj.estimatedEffort === "low") objectivesLow++;
    else if (obj.estimatedEffort === "medium") objectivesMedium++;
    else if (obj.estimatedEffort === "high") objectivesHigh++;
  }

  return {
    schemaVersion: "p11.3.0",
    planId,
    generatedAt,
    rootCauseAnalysisId: analysis.analysisId,
    correlationGraphId: analysis.correlationGraphId,
    status: planStatus,
    objectives,
    meta: {
      totalSubsystemsEvaluated: analysis.meta.totalSubsystemsExamined,
      prioritizedObjectives: objectives.length,
      objectivesLow,
      objectivesMedium,
      objectivesHigh,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a StrategicPlan for early-exit statuses that don't produce objectives.
 *
 * Shared by the insufficient_history, stale, no_degradation, and no_objectives
 * paths so the plan shape is always consistent.
 */
function buildEarlyReturnPlan(
  planId: string,
  generatedAt: string,
  analysis: RootCauseAnalysis,
  status: PlanStatus,
): StrategicPlan {
  return {
    schemaVersion: "p11.3.0",
    planId,
    generatedAt,
    rootCauseAnalysisId: analysis.analysisId,
    correlationGraphId: analysis.correlationGraphId,
    status,
    objectives: [],
    meta: {
      totalSubsystemsEvaluated: analysis.meta.totalSubsystemsExamined,
      prioritizedObjectives: 0,
      objectivesLow: 0,
      objectivesMedium: 0,
      objectivesHigh: 0,
    },
  };
}
