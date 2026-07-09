/**
 * P23.3 — Replay Diff Model.
 *
 * Compares original vs counterfactual outcomes and produces a structured diff
 * across all 8 replay diff categories.
 *
 * Pure function: no stores, no CLI, no execution, no audit emitters.
 * Deterministic: same inputs → same diff every time.
 * Immutable: inputs are never mutated.
 */

import type {
  ReplayOriginalOutcome,
  ReplayCounterfactualOutcome,
  ReplayDiff,
  ReplayDiffDetail,
} from "./types.js";

// ---------------------------------------------------------------------------
// Readiness level ordering
// ---------------------------------------------------------------------------

const READINESS_ORDER: Record<string, number> = {
  manual_only: 0,
  dry_run_capable: 1,
  reversible: 2,
  irreversible: 3,
  external_side_effecting: 4,
};

function compareReadinessValues(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return (READINESS_ORDER[a] ?? 0) - (READINESS_ORDER[b] ?? 0);
}

// ---------------------------------------------------------------------------
// Risk level ordering
// ---------------------------------------------------------------------------

const RISK_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function compareRiskValues(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return (RISK_ORDER[a] ?? 0) - (RISK_ORDER[b] ?? 0);
}

// ---------------------------------------------------------------------------
// Sort comparator for diff details
// ---------------------------------------------------------------------------

function detailSorter(a: ReplayDiffDetail, b: ReplayDiffDetail): number {
  if (a.category < b.category) return -1;
  if (a.category > b.category) return 1;
  if (a.sourceId < b.sourceId) return -1;
  if (a.sourceId > b.sourceId) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Diff detection helpers
// ---------------------------------------------------------------------------

function detectReadinessChanged(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiffDetail | null {
  if (original.readinessLevel === counterfactual.readinessLevel) return null;
  return {
    category: "readiness_changed",
    sourceId: "replay",
    field: "readinessLevel",
    originalValue: original.readinessLevel,
    counterfactualValue: counterfactual.readinessLevel,
  };
}

function detectEvidenceGapChanged(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiffDetail | null {
  if (original.evidenceCompleteness === counterfactual.evidenceCompleteness) return null;
  return {
    category: "evidence_gap_changed",
    sourceId: "replay",
    field: "evidenceCompleteness",
    originalValue: original.evidenceCompleteness,
    counterfactualValue: counterfactual.evidenceCompleteness,
  };
}

function detectHandoffQualityChanged(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiffDetail | null {
  if (original.handoffReadiness === counterfactual.handoffReadiness) return null;
  return {
    category: "handoff_quality_changed",
    sourceId: "replay",
    field: "handoffReadiness",
    originalValue: original.handoffReadiness,
    counterfactualValue: counterfactual.handoffReadiness,
  };
}

function detectClosureRiskChanged(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiffDetail | null {
  if (original.closureRiskLevel === counterfactual.closureRiskLevel) return null;
  return {
    category: "closure_risk_changed",
    sourceId: "replay",
    field: "closureRiskLevel",
    originalValue: original.closureRiskLevel,
    counterfactualValue: counterfactual.closureRiskLevel,
  };
}

function detectReviewPathChanged(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiffDetail | null {
  if (original.closureDecision === counterfactual.closureDecision) return null;
  return {
    category: "review_path_changed",
    sourceId: "replay",
    field: "closureDecision",
    originalValue: original.closureDecision,
    counterfactualValue: counterfactual.closureDecision,
  };
}

function detectBlockedInCounterfactual(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiffDetail | null {
  // Only report blocked_in_counterfactual if the original was not already
  // requiring attention — otherwise both are equally stuck and this is
  // not a new regression.
  if (!counterfactual.blocked || original.requiresAttention) return null;
  return {
    category: "blocked_in_counterfactual",
    sourceId: "replay",
    field: "blocked",
    originalValue: false,
    counterfactualValue: true,
  };
}

function detectAdvancedInCounterfactual(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiffDetail | null {
  // Advancement means: the counterfactual assumptions would have allowed
  // progression earlier or with fewer concerns than the original.

  // 1. Readiness improved (counterfactual readiness is HIGHER than original)
  const readinessDelta = compareReadinessValues(
    counterfactual.readinessLevel,
    original.readinessLevel,
  );
  if (readinessDelta > 0) {
    return {
      category: "advanced_in_counterfactual",
      sourceId: "replay",
      field: "readinessLevel",
      originalValue: original.readinessLevel,
      counterfactualValue: counterfactual.readinessLevel,
    };
  }

  // 2. Risk decreased (counterfactual risk is LOWER than original)
  const riskDelta = compareRiskValues(
    counterfactual.closureRiskLevel,
    original.closureRiskLevel,
  );
  if (riskDelta < 0) {
    return {
      category: "advanced_in_counterfactual",
      sourceId: "replay",
      field: "closureRiskLevel",
      originalValue: original.closureRiskLevel,
      counterfactualValue: counterfactual.closureRiskLevel,
    };
  }

  // 3. Handoff readiness improved
  const handoffOrder: Record<string, number> = {
    not_ready: 0,
    partial: 1,
    ready: 2,
  };
  const origHandoff = handoffOrder[original.handoffReadiness] ?? 0;
  const cfHandoff = handoffOrder[counterfactual.handoffReadiness] ?? 0;
  if (cfHandoff > origHandoff) {
    return {
      category: "advanced_in_counterfactual",
      sourceId: "replay",
      field: "handoffReadiness",
      originalValue: original.handoffReadiness,
      counterfactualValue: counterfactual.handoffReadiness,
    };
  }

  // 4. Evidence completeness improved
  const evidenceOrder: Record<string, number> = {
    none: 0,
    partial: 1,
    full: 2,
  };
  const origEvidence = evidenceOrder[original.evidenceCompleteness] ?? 0;
  const cfEvidence = evidenceOrder[counterfactual.evidenceCompleteness] ?? 0;
  if (cfEvidence > origEvidence) {
    return {
      category: "advanced_in_counterfactual",
      sourceId: "replay",
      field: "evidenceCompleteness",
      originalValue: original.evidenceCompleteness,
      counterfactualValue: counterfactual.evidenceCompleteness,
    };
  }

  // 5. No longer requires attention
  if (original.requiresAttention && !counterfactual.requiresAttention) {
    return {
      category: "advanced_in_counterfactual",
      sourceId: "replay",
      field: "requiresAttention",
      originalValue: true,
      counterfactualValue: false,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Primary diff category computation
// ---------------------------------------------------------------------------

function computePrimaryCategory(details: readonly ReplayDiffDetail[]): string {
  if (details.length === 0) return "unchanged";

  // Collect unique categories
  const cats = new Set(details.map((d) => d.category));

  // Priority order: specific changes before "unchanged" or "advanced"
  const priorityOrder = [
    "blocked_in_counterfactual",
    "readiness_changed",
    "review_path_changed",
    "closure_risk_changed",
    "handoff_quality_changed",
    "evidence_gap_changed",
    "advanced_in_counterfactual",
  ];

  for (const cat of priorityOrder) {
    if (cats.has(cat)) return cat;
  }

  return "unchanged";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare original and counterfactual outcomes and produce a structured diff.
 *
 * Detects all 8 diff categories:
 * - unchanged:           No material change
 * - readiness_changed:   Readiness label or explanation changed
 * - handoff_quality_changed:  Handoff quality assessment changed
 * - closure_risk_changed:     Closure risk level changed
 * - evidence_gap_changed:     Evidence completeness interpretation changed
 * - review_path_changed:      Closure decision interpretation changed
 * - blocked_in_counterfactual:  Counterfactual prevented progression
 * - advanced_in_counterfactual:  Counterfactual allowed progression earlier
 *
 * @param original - Original outcome (never mutated).
 * @param counterfactual - Counterfactual outcome (never mutated).
 * @returns Read-only diff with sorted details.
 */
export function computeReplayDiff(
  original: ReplayOriginalOutcome,
  counterfactual: ReplayCounterfactualOutcome,
): ReplayDiff {
  const details: ReplayDiffDetail[] = [];

  // Run detectors for each category
  const detectors = [
    detectReadinessChanged,
    detectEvidenceGapChanged,
    detectHandoffQualityChanged,
    detectClosureRiskChanged,
    detectReviewPathChanged,
    detectBlockedInCounterfactual,
    detectAdvancedInCounterfactual,
  ] as const;

  for (const detect of detectors) {
    const detail = detect(original, counterfactual);
    if (detail !== null) {
      details.push(detail);
    }
  }

  // Deterministic sort: by category, then sourceId, both ascending
  const sorted: ReplayDiffDetail[] = [...details].sort(detailSorter);

  const category = computePrimaryCategory(sorted);

  return {
    category,
    details: Object.freeze(sorted),
  };
}
