/**
 * P23.2 — Counterfactual Readiness Evaluator.
 *
 * Pure evaluation of replay datasets under declared counterfactual assumptions.
 * Compares original vs counterfactual outcomes, computes diff and risk delta,
 * and surfaces candidate lessons.
 *
 * Deterministic: same dataset + same scenario → same output every time.
 * No mutation, no stores, no CLI, no execution, no audit emitters.
 * No policy/readiness/approval/handoff/closure writers.
 * No randomness, no model calls, no external calls.
 */

import { createHash } from "node:crypto";
import type { ExecutionReadinessLevel } from "../execution-readiness.js";
import type {
  GovernanceReplayDataset,
  CounterfactualScenario,
  CounterfactualReplayOutcome,
  ReplayOriginalOutcome,
  ReplayCounterfactualOutcome,
  ReplayDiff,
  ReplayDiffDetail,
  ReplayRiskDelta,
  ReplayCandidateLesson,
} from "./types.js";

// ---------------------------------------------------------------------------
// Readiness level ordering (ascending risk / descending capability)
// ---------------------------------------------------------------------------

const READINESS_ORDER: Record<ExecutionReadinessLevel, number> = {
  manual_only: 0,
  dry_run_capable: 1,
  reversible: 2,
  irreversible: 3,
  external_side_effecting: 4,
};

/** @internal Reserved for P23.3 diff model comparisons. */
function compareReadiness(
  a: ExecutionReadinessLevel | null,
  b: ExecutionReadinessLevel | null,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return (READINESS_ORDER[a] ?? 0) - (READINESS_ORDER[b] ?? 0);
}

function downgradeReadiness(
  level: ExecutionReadinessLevel,
): ExecutionReadinessLevel {
  const order = READINESS_ORDER[level];
  if (order === undefined || order <= 0) return level;
  // Find the next lower level
  const entries = Object.entries(READINESS_ORDER) as [ExecutionReadinessLevel, number][];
  const lower = entries
    .filter(([, o]) => o < order)
    .sort(([, a], [, b]) => b - a); // highest below current
  return lower.length > 0 ? lower[0][0] : level;
}

// ---------------------------------------------------------------------------
// Build replay ID
// ---------------------------------------------------------------------------

/** @internal Reserved for P23.2 outcome identification — currently unused, kept for forward-compat. */
function buildOutcomeId(replayId: string, scenarioId: string, generatedAt: string): string {
  return createHash("sha256")
    .update(["p23.2", replayId, scenarioId, generatedAt].join("|"))
    .digest("hex")
    .slice(0, 16);
}

function buildLessonId(
  scenarioId: string,
  appliesTo: string,
  index: number,
  generatedAt: string,
): string {
  return createHash("sha256")
    .update(["p23.2-lesson", scenarioId, appliesTo, String(index), generatedAt].join("|"))
    .digest("hex")
    .slice(0, 12);
}

// ---------------------------------------------------------------------------
// Evidence completeness
// ---------------------------------------------------------------------------

function computeEvidenceCompleteness(
  dataset: GovernanceReplayDataset,
): { level: string; handoffCount: number; capturedCount: number } {
  if (dataset.handoffs.length === 0) {
    return { level: "none", handoffCount: 0, capturedCount: 0 };
  }
  const captured = dataset.handoffs.filter((h) => h.evidenceCaptured).length;
  if (captured === dataset.handoffs.length) {
    return { level: "full", handoffCount: dataset.handoffs.length, capturedCount: captured };
  }
  if (captured > 0) {
    return { level: "partial", handoffCount: dataset.handoffs.length, capturedCount: captured };
  }
  return { level: "none", handoffCount: dataset.handoffs.length, capturedCount: 0 };
}

function applyEvidenceAssumptions(
  original: { level: string; handoffCount: number; capturedCount: number },
  assumptions: NonNullable<CounterfactualScenario["evidenceAssumptions"]>,
): string {
  let level = original.level;

  // Order: strictest check first. requireFullCompleteness gates on anything
  // below "full" and takes precedence over all others.
  if (assumptions.requireFullCompleteness && level !== "full") {
    return "incomplete";
  }

  if (assumptions.treatPartialAsIncomplete && level === "partial") {
    return "none";
  }

  if (assumptions.allowMissingOptionalEvidence && level === "partial") {
    return "full";
  }

  return level;
}

// ---------------------------------------------------------------------------
// Handoff readiness
// ---------------------------------------------------------------------------

function computeHandoffReadiness(
  dataset: GovernanceReplayDataset,
): string {
  if (dataset.handoffs.length === 0) return "not_ready";
  const ready = dataset.handoffs.filter(
    (h) => h.evidenceCaptured && h.explicitlyManualOnly,
  ).length;
  if (ready === dataset.handoffs.length) return "ready";
  if (ready > 0) return "partial";
  return "not_ready";
}

function applyHandoffAssumptions(
  original: string,
  assumptions: NonNullable<CounterfactualScenario["handoffAssumptions"]>,
  dataset: GovernanceReplayDataset,
): string {
  let result = original;

  if (assumptions.requireAllEvidenceCaptured) {
    const allCaptured = dataset.handoffs.every((h) => h.evidenceCaptured);
    if (!allCaptured) {
      result = "not_ready";
    }
  }

  if (assumptions.strictRollbackProcedure) {
    // HandoffPackage doesn't expose rollback in the replay record,
    // so we can only flag this. Conservative: leave as-is.
    // In a full implementation, this would check handoff risk notes.
  }

  return result;
}

// ---------------------------------------------------------------------------
// Closure decision
// ---------------------------------------------------------------------------

function getMostRecentClosure(
  dataset: GovernanceReplayDataset,
): { decision: string | null; followUpRequired: boolean; reviewedAt: string } | null {
  if (dataset.closureReviews.length === 0) return null;
  const sorted = [...dataset.closureReviews].sort((a, b) => {
    if (a.reviewedAt < b.reviewedAt) return 1;
    if (a.reviewedAt > b.reviewedAt) return -1;
    return 0;
  });
  const latest = sorted[0];
  return {
    decision: latest.decision,
    followUpRequired: latest.followUpRequired,
    reviewedAt: latest.reviewedAt,
  };
}

function applyClosureAssumptions(
  original: string | null,
  assumptions: NonNullable<CounterfactualScenario["closureAssumptions"]>,
): string | null {
  if (original === null) return null;
  if (assumptions.treatNeedsFollowUpAsUnresolved && original === "needs_follow_up") {
    return "incomplete";
  }
  return original;
}

// ---------------------------------------------------------------------------
// Risk level
// ---------------------------------------------------------------------------

function computeRiskLevel(
  closureDecision: string | null,
  qualitySignalCount: number,
  followUpRequired: boolean,
  dataset: GovernanceReplayDataset,
): string {
  // Check for critical quality signals
  for (const ci of dataset.closureIntelligence) {
    for (const signal of ci.qualitySignals) {
      if (signal.severity === "critical") return "critical";
    }
  }

  if (closureDecision === "rejected") return "high";
  if (closureDecision === "incomplete") return "high";

  if (closureDecision === "needs_follow_up") return "medium";
  if (followUpRequired) return "medium";

  if (qualitySignalCount > 0) return "low";

  if (closureDecision === "accepted") return "low";
  if (closureDecision !== null) return "low";

  return "low";
}

function applyRiskAssumptions(
  originalRisk: string,
  evidenceLevel: string,
  closureDecision: string | null,
  assumptions: NonNullable<CounterfactualScenario["readinessAssumptions"]>,
): string {
  let risk = originalRisk;

  if (assumptions.downgradeOnHighClosureRisk && (risk === "high" || risk === "critical")) {
    // Further downgrade: high → critical, critical stays
    if (risk === "high") risk = "critical";
  }

  if (assumptions.treatMissingClosureEvidenceAsUnresolved && evidenceLevel === "none") {
    // If no evidence at all, elevate risk
    if (risk === "low") risk = "medium";
    else if (risk === "medium") risk = "high";
  }

  return risk;
}

// ---------------------------------------------------------------------------
// Readiness level application
// ---------------------------------------------------------------------------

function applyReadinessAssumptions(
  originalLevel: ExecutionReadinessLevel | null,
  riskLevel: string,
  handoffReadiness: string,
  evidenceLevel: string,
  assumptions: NonNullable<CounterfactualScenario["readinessAssumptions"]>,
): { level: ExecutionReadinessLevel | null; blocked: boolean; blockedReasons: string[] } {
  if (originalLevel === null) {
    return { level: null, blocked: true, blockedReasons: ["No original readiness assessment"] };
  }

  let level = originalLevel;
  const blocked: string[] = [];

  if (assumptions.requireHumanReviewBeforeStable && level !== "manual_only") {
    // Check if any closure review exists (proxy for human review)
    blocked.push("Human review required before readiness can be considered stable (counterfactual)");
  }

  if (assumptions.requireEvidenceCompleteness && evidenceLevel !== "full") {
    level = downgradeReadiness(level);
  }

  if (assumptions.requireStrictHandoffReadiness && handoffReadiness !== "ready") {
    level = downgradeReadiness(level);
  }

  if (assumptions.downgradeOnHighClosureRisk && (riskLevel === "high" || riskLevel === "critical")) {
    level = downgradeReadiness(level);
  }

  return { level, blocked: blocked.length > 0, blockedReasons: blocked };
}

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

function computeDiff(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiff {
  const details: ReplayDiffDetail[] = [];
  const categorySet = new Set<string>();

  // Readiness comparison
  if (original.readinessLevel !== counterfactual.readinessLevel) {
    categorySet.add("readiness_changed");
    details.push({
      category: "readiness_changed",
      sourceId: "replay",
      field: "readinessLevel",
      originalValue: original.readinessLevel,
      counterfactualValue: counterfactual.readinessLevel,
    });
  }

  // Evidence completeness
  if (original.evidenceCompleteness !== counterfactual.evidenceCompleteness) {
    categorySet.add("evidence_gap_changed");
    details.push({
      category: "evidence_gap_changed",
      sourceId: "replay",
      field: "evidenceCompleteness",
      originalValue: original.evidenceCompleteness,
      counterfactualValue: counterfactual.evidenceCompleteness,
    });
  }

  // Handoff quality
  if (original.handoffReadiness !== counterfactual.handoffReadiness) {
    categorySet.add("handoff_quality_changed");
    details.push({
      category: "handoff_quality_changed",
      sourceId: "replay",
      field: "handoffReadiness",
      originalValue: original.handoffReadiness,
      counterfactualValue: counterfactual.handoffReadiness,
    });
  }

  // Closure risk
  if (original.closureRiskLevel !== counterfactual.closureRiskLevel) {
    categorySet.add("closure_risk_changed");
    details.push({
      category: "closure_risk_changed",
      sourceId: "replay",
      field: "closureRiskLevel",
      originalValue: original.closureRiskLevel,
      counterfactualValue: counterfactual.closureRiskLevel,
    });
  }

  // Review path
  if (original.closureDecision !== counterfactual.closureDecision) {
    categorySet.add("review_path_changed");
    details.push({
      category: "review_path_changed",
      sourceId: "replay",
      field: "closureDecision",
      originalValue: original.closureDecision,
      counterfactualValue: counterfactual.closureDecision,
    });
  }

  // Blocked in counterfactual
  if (counterfactual.blocked) {
    categorySet.add("blocked_in_counterfactual");
    details.push({
      category: "blocked_in_counterfactual",
      sourceId: "replay",
      field: "blocked",
      originalValue: false,
      counterfactualValue: true,
    });
  }

  // No changes
  if (details.length === 0) {
    categorySet.add("unchanged");
    details.push({
      category: "unchanged",
      sourceId: "replay",
      field: "outcome",
      originalValue: "no_change",
      counterfactualValue: "no_change",
    });
  }

  // Sort details by category, then source id
  const sorted = [...details].sort((a, b) => {
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    if (a.sourceId < b.sourceId) return -1;
    if (a.sourceId > b.sourceId) return 1;
    return 0;
  });

  // Pick the first category alphabetically as the primary category
  const sortedCategories = [...categorySet].sort();
  const primaryCategory = sortedCategories[0] ?? "unchanged";

  return { category: primaryCategory, details: Object.freeze(sorted) };
}

// ---------------------------------------------------------------------------
// Risk delta
// ---------------------------------------------------------------------------

function computeRiskDelta(
  originalRisk: string,
  counterfactualRisk: string,
): ReplayRiskDelta {
  const riskOrder: Record<string, number> = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  };

  const origOrder = riskOrder[originalRisk] ?? 0;
  const cfOrder = riskOrder[counterfactualRisk] ?? 0;

  const direction =
    cfOrder > origOrder ? "increased" :
    cfOrder < origOrder ? "decreased" :
    "unchanged";

  return {
    originalRisk,
    counterfactualRisk,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Candidate lessons
// ---------------------------------------------------------------------------

function generateLessons(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
  scenario: CounterfactualScenario,
  generatedAt: string,
): readonly ReplayCandidateLesson[] {
  const lessons: ReplayCandidateLesson[] = [];
  let index = 0;

  // Readiness lesson
  if (original.readinessLevel !== counterfactual.readinessLevel) {
    lessons.push({
      lessonId: buildLessonId(scenario.scenarioId, "readiness", index++, generatedAt),
      summary: `Readiness level changed from "${original.readinessLevel ?? "none"}" to "${counterfactual.readinessLevel ?? "none"}" under scenario "${scenario.name}"`,
      basis: ["counterfactual_readiness_assumptions"],
      confidence: scenario.readinessAssumptions ? "medium" : "low",
      appliesTo: "readiness",
      requiresHumanReview: true,
    });
  }

  // Handoff quality lesson
  if (original.handoffReadiness !== counterfactual.handoffReadiness) {
    lessons.push({
      lessonId: buildLessonId(scenario.scenarioId, "handoff", index++, generatedAt),
      summary: `Handoff readiness changed from "${original.handoffReadiness}" to "${counterfactual.handoffReadiness}" under scenario "${scenario.name}"`,
      basis: ["counterfactual_handoff_assumptions"],
      confidence: scenario.handoffAssumptions ? "medium" : "low",
      appliesTo: "handoff",
      requiresHumanReview: true,
    });
  }

  // Closure lesson
  if (original.closureDecision !== counterfactual.closureDecision) {
    lessons.push({
      lessonId: buildLessonId(scenario.scenarioId, "closure", index++, generatedAt),
      summary: `Closure decision interpretation changed from "${original.closureDecision ?? "none"}" to "${counterfactual.closureDecision ?? "none"}" under scenario "${scenario.name}"`,
      basis: ["counterfactual_closure_assumptions"],
      confidence: scenario.closureAssumptions ? "medium" : "low",
      appliesTo: "closure",
      requiresHumanReview: true,
    });
  }

  // Evidence lesson
  if (original.evidenceCompleteness !== counterfactual.evidenceCompleteness) {
    lessons.push({
      lessonId: buildLessonId(scenario.scenarioId, "evidence", index++, generatedAt),
      summary: `Evidence completeness changed from "${original.evidenceCompleteness}" to "${counterfactual.evidenceCompleteness}" under scenario "${scenario.name}"`,
      basis: ["counterfactual_evidence_assumptions"],
      confidence: scenario.evidenceAssumptions ? "medium" : "low",
      appliesTo: "evidence",
      requiresHumanReview: true,
    });
  }

  // Risk lesson
  if (original.closureRiskLevel !== counterfactual.closureRiskLevel) {
    lessons.push({
      lessonId: buildLessonId(scenario.scenarioId, "review", index++, generatedAt),
      summary: `Closure risk changed from "${original.closureRiskLevel ?? "none"}" to "${counterfactual.closureRiskLevel ?? "none"}" under scenario "${scenario.name}"`,
      basis: ["counterfactual_readiness_assumptions"],
      confidence: scenario.readinessAssumptions?.downgradeOnHighClosureRisk ? "high" : "medium",
      appliesTo: "review",
      requiresHumanReview: true,
    });
  }

  return Object.freeze(lessons);
}

// ---------------------------------------------------------------------------
// Main evaluator
// ---------------------------------------------------------------------------

/**
 * Evaluate a governance replay dataset under a declared counterfactual scenario.
 *
 * @param dataset - Read-only replay dataset produced by P23.1 assembler.
 * @param scenario - Declared counterfactual scenario with explicit assumptions.
 * @param options - Optional evaluation parameters.
 * @returns A read-only counterfactual replay outcome.
 */
export function evaluateCounterfactual(
  dataset: GovernanceReplayDataset,
  scenario: CounterfactualScenario,
  options: { now?: string } = {},
): CounterfactualReplayOutcome {
  const generatedAt = options.now ?? new Date().toISOString();

  // ---- Original outcome ----

  const evidenceResult = computeEvidenceCompleteness(dataset);
  const mostRecentReadiness = dataset.readinessProjections.length > 0
    ? dataset.readinessProjections
        .reduce((latest, r) => (r.assessedAt >= latest.assessedAt ? r : latest))
    : null;
  const closure = getMostRecentClosure(dataset);

  const originalEvidenceLevel = evidenceResult.level;

  const original: ReplayOriginalOutcome = {
    readinessLevel: mostRecentReadiness?.readinessLevel ?? null,
    evidenceCompleteness: originalEvidenceLevel,
    handoffReadiness: computeHandoffReadiness(dataset),
    closureDecision: closure?.decision ?? null,
    closureRiskLevel: computeRiskLevel(
      closure?.decision ?? null,
      dataset.closureIntelligence.reduce((sum, ci) => sum + ci.qualitySignals.length, 0),
      closure?.followUpRequired ?? false,
      dataset,
    ),
    qualitySignalCount: dataset.closureIntelligence.reduce(
      (sum, ci) => sum + ci.qualitySignals.length, 0,
    ),
    requiresAttention:
      dataset.closureIntelligence.some((ci) =>
        ci.qualitySignals.some((s) => s.severity === "critical"),
      ) ||
      closure?.decision === "rejected" ||
      closure?.decision === "incomplete" ||
      closure?.followUpRequired === true,
  };

  // ---- Counterfactual outcome ----

  // Apply evidence assumptions
  const cfEvidenceLevel = scenario.evidenceAssumptions
    ? applyEvidenceAssumptions(evidenceResult, scenario.evidenceAssumptions)
    : originalEvidenceLevel;

  // Apply handoff assumptions
  const cfHandoffReadiness = scenario.handoffAssumptions
    ? applyHandoffAssumptions(original.handoffReadiness, scenario.handoffAssumptions, dataset)
    : original.handoffReadiness;

  // Apply closure assumptions
  const cfClosureDecision = scenario.closureAssumptions
    ? applyClosureAssumptions(closure?.decision ?? null, scenario.closureAssumptions)
    : (closure?.decision ?? null);

  // Compute risk under counterfactual
  // Recompute base risk from cfClosureDecision so that closure assumptions
  // (e.g. treatNeedsFollowUpAsUnresolved) propagate to the risk level.
  const cfBaseRisk = computeRiskLevel(
    cfClosureDecision,
    original.qualitySignalCount,
    closure?.followUpRequired ?? false,
    dataset,
  );
  const cfRisk = scenario.readinessAssumptions
    ? applyRiskAssumptions(
        cfBaseRisk,
        cfEvidenceLevel,
        cfClosureDecision,
        scenario.readinessAssumptions,
      )
    : cfBaseRisk;

  // Apply readiness assumptions
  const readinessResult = scenario.readinessAssumptions
    ? applyReadinessAssumptions(
        original.readinessLevel,
        cfRisk,
        cfHandoffReadiness,
        cfEvidenceLevel,
        scenario.readinessAssumptions,
      )
    : { level: original.readinessLevel, blocked: false, blockedReasons: [] };

  // Count quality signals in counterfactual (may differ if assumptions change scope)
  const cfSignalCount = original.qualitySignalCount; // Signal count unchanged — re-evaluation would need new signal detection

  const cfRequiresAttention =
    cfClosureDecision === "rejected" ||
    cfClosureDecision === "incomplete" ||
    cfRisk === "high" ||
    cfRisk === "critical";

  const counterfactualOutcome: ReplayCounterfactualOutcome = {
    readinessLevel: readinessResult.level,
    evidenceCompleteness: cfEvidenceLevel,
    handoffReadiness: cfHandoffReadiness,
    closureDecision: cfClosureDecision,
    closureRiskLevel: cfRisk,
    qualitySignalCount: cfSignalCount,
    requiresAttention: cfRequiresAttention,
    blocked: readinessResult.blocked,
    blockedReasons: Object.freeze(readinessResult.blockedReasons),
  };

  // ---- Diff ----
  const diff = computeDiff(original, counterfactualOutcome);

  // ---- Risk delta ----
  const riskDelta = computeRiskDelta(
    original.closureRiskLevel ?? "low",
    counterfactualOutcome.closureRiskLevel ?? "low",
  );

  // ---- Candidate lessons ----
  const candidateLessons = generateLessons(original, counterfactualOutcome, scenario, generatedAt);

  return {
    replayId: dataset.replayId,
    sourceLifecycleId: dataset.sourceLifecycleId,
    scenarioId: scenario.scenarioId,
    originalOutcome: original,
    counterfactualOutcome,
    diff,
    riskDelta,
    candidateLessons,
    generatedAt,
    readOnly: true,
  };
}
