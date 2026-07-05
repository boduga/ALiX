/**
 * P13.3 — Governance policy refinement suggestions.
 *
 * Cross-references the P12.4 run ledger and P12.5 failure memory to produce
 * advisory policy refinement suggestions. Where P13.1 said "what happened"
 * and P13.2 said "what's failing," P13.3 says "what should a human consider
 * tightening or loosening."
 *
 * Invariant: Suggest governance refinements, don't apply them.
 *
 * This module is the most sensitive P13 output because its product reads as
 * directives ("tighten this policy"). It MUST remain purely advisory — every
 * suggestion is a recommendation a human reviews and decides on. No writes,
 * no policy mutation, no auto-apply, no auto-approve.
 *
 * Hard rule: every emitted suggestion MUST include evidence counts and a
 * confidence score >= MIN_CONFIDENCE. A suggestion without evidence is never
 * emitted.
 *
 * All functions pure (no I/O, no side effects, no Date.now / Math.random).
 * All ratio calculations are division-guarded via `safeRatio`. All sort
 * orders deterministic.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { LedgerEntry } from "./run-ledger.js";
import type { FailureRecord } from "./failure-memory.js";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type PolicySuggestionType = "tighten" | "loosen" | "add_rule" | "remove_rule";

export interface PolicySuggestionEvidence {
  /** Ledger entries whose policyResult.matchedPolicies includes this policyId. */
  matchedCount: number;
  /** Ledger entries with outcome "denied" attributable to this policy. */
  deniedCount: number;
  /**
   * Failure records tagged with policyId whose runId also appears in the
   * ledger with outcome "completed" (deterministic runId join; 0 when no
   * runId link).
   */
  bypassedCount: number;
  /** Total failure records tagged with this policyId (regardless of run outcome). */
  relatedFailureCount: number;
}

export interface PolicySuggestion {
  type: PolicySuggestionType;
  /** Present for tighten/loosen/remove_rule; absent for add_rule. */
  policyId?: string;
  /** Human-readable explanation. */
  reason: string;
  evidence: PolicySuggestionEvidence;
  /** 0.0–1.0, clamped and rounded to 2 decimals. */
  confidence: number;
  /** Concrete action for the human. */
  recommendation: string;
  /** Provenance for tests + P13.5 reporting. */
  sourceHeuristic: "H1" | "H2" | "H3" | "H4" | "H5";
}

// ---------------------------------------------------------------------------
// Exported constants
// ---------------------------------------------------------------------------

/** Minimum evidence sample size for any heuristic to fire. */
export const MIN_SAMPLE_SIZE = 3;

/** Minimum confidence for a suggestion to be emitted. */
export const MIN_CONFIDENCE = 0.5;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Clamp `value` into the inclusive range `[min, max]`.
 * Deterministic, side-effect free.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Round `value` to 2 decimal places. Deterministic.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Division-guarded ratio: returns 0 when `denominator === 0` rather than
 * `NaN` / `Infinity`. All ratio calculations in this module MUST go through
 * this helper.
 */
export function safeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

// ---------------------------------------------------------------------------
// Evidence computation (deterministic joins)
// ---------------------------------------------------------------------------

/**
 * Compute evidence counts for a single `policyId` by deterministically
 * joining the ledger and failure-memory records.
 *
 * - `matchedCount`     — ledger entries whose `policyResult.matchedPolicies`
 *                        includes `policyId`.
 * - `deniedCount`      — ledger entries where `matchedPolicies` includes
 *                        `policyId` AND `outcome === "denied"`.
 * - `bypassedCount`    — failure records tagged with `policyId` whose `runId`
 *                        also appears in the ledger with `outcome === "completed"`
 *                        (runId join; 0 if no runId link).
 * - `relatedFailureCount` — failure records tagged with `policyId` (total,
 *                        regardless of run outcome).
 */
export function computeEvidenceForPolicy(
  policyId: string,
  ledger: LedgerEntry[],
  failures: FailureRecord[],
): PolicySuggestionEvidence {
  const completedRunIds = new Set(
    ledger.filter((entry) => entry.outcome === "completed").map((entry) => entry.runId),
  );

  let matchedCount = 0;
  let deniedCount = 0;
  for (const entry of ledger) {
    const matched = entry.policyResult.matchedPolicies.includes(policyId);
    if (!matched) continue;
    matchedCount += 1;
    if (entry.outcome === "denied") {
      deniedCount += 1;
    }
  }

  let bypassedCount = 0;
  let relatedFailureCount = 0;
  for (const failure of failures) {
    const tagged = failure.policyIds?.includes(policyId) ?? false;
    if (!tagged) continue;
    relatedFailureCount += 1;
    if (failure.runId && completedRunIds.has(failure.runId)) {
      bypassedCount += 1;
    }
  }

  return { matchedCount, deniedCount, bypassedCount, relatedFailureCount };
}

// ---------------------------------------------------------------------------
// Internal: candidate policyId collection
// ---------------------------------------------------------------------------

/**
 * Collect the union of all policyIds mentioned in either store.
 * Deduped, deterministic iteration order (insertion order).
 */
function collectCandidatePolicyIds(
  ledger: LedgerEntry[],
  failures: FailureRecord[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (id: string): void => {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const entry of ledger) {
    for (const id of entry.policyResult.matchedPolicies) push(id);
  }
  for (const failure of failures) {
    for (const id of failure.policyIds ?? []) push(id);
  }
  return out;
}

/**
 * Count `policy_denied` failure records tagged with a given `policyId`.
 */
function countPolicyDeniedFailures(policyId: string, failures: FailureRecord[]): number {
  let count = 0;
  for (const failure of failures) {
    if (failure.failureType !== "policy_denied") continue;
    if (failure.policyIds?.includes(policyId) ?? false) count += 1;
  }
  return count;
}

/**
 * Compute the set of ledger runIds that matched a given `policyId` AND
 * whose `filesChanged` overlap with a target file path. Used by H2 to
 * detect that a matched policy still allowed failing paths through.
 */
function matchedRunIdsForPolicy(policyId: string, ledger: LedgerEntry[]): Set<string> {
  const out = new Set<string>();
  for (const entry of ledger) {
    if (!entry.policyResult.matchedPolicies.includes(policyId)) continue;
    out.add(entry.runId);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Heuristics (private, all gated on MIN_SAMPLE_SIZE, all ratios via safeRatio)
// ---------------------------------------------------------------------------

/**
 * H1 — `loosen` / `remove_rule`.
 *
 * A policy with high `matchedCount` and high `deniedCount` but low or absent
 * related failures (the deny rarely corresponds to a real safety event).
 *
 * - Trigger: `matchedCount >= MIN_SAMPLE_SIZE` AND `denyRate >= 0.6`
 *   AND `bypassRate < 0.2`.
 * - Type: `remove_rule` when `deniedCount === matchedCount` AND
 *   `bypassedCount === 0`; otherwise `loosen`.
 * - Confidence: `denyRate` clamped to `[0, 0.9]`.
 */
function suggestLoosenOrRemove(
  evidence: PolicySuggestionEvidence,
  policyId: string,
): PolicySuggestion | null {
  const { matchedCount, deniedCount, bypassedCount } = evidence;
  if (matchedCount < MIN_SAMPLE_SIZE) return null;

  const denyRate = safeRatio(deniedCount, matchedCount);
  const bypassRate = safeRatio(bypassedCount, deniedCount);
  if (denyRate < 0.6) return null;
  if (bypassRate >= 0.2) return null;

  const isRemoveRule = deniedCount === matchedCount && bypassedCount === 0;
  const type: PolicySuggestionType = isRemoveRule ? "remove_rule" : "loosen";
  const confidence = round2(clamp(denyRate, 0, 0.9));
  if (confidence < MIN_CONFIDENCE) return null;

  const reason = isRemoveRule
    ? `Policy "${policyId}" denies every matched run with zero bypassed failures — candidate for removal`
    : `Policy "${policyId}" has high deny rate (${denyRate.toFixed(2)}) with low bypass rate (${bypassRate.toFixed(2)})`;
  const recommendation = isRemoveRule
    ? `Consider removing policy "${policyId}" — deny decisions appear not to gate real safety events`
    : `Consider loosening match criteria or raising thresholds for policy "${policyId}"`;

  return {
    type,
    policyId,
    reason,
    evidence,
    confidence,
    recommendation,
    sourceHeuristic: "H1",
  };
}

/**
 * H2 — `tighten`.
 *
 * A policy frequently matches but related runs still produce `test_failure`
 * or `verification_timeout` records on overlapping file paths — the policy
 * is not catching the dangerous case.
 *
 * - Trigger: `matchedCount >= MIN_SAMPLE_SIZE` AND count of
 *   `test_failure`/`verification_timeout` failures whose file paths appear in
 *   a matched run's `filesChanged` is `>= MIN_SAMPLE_SIZE`.
 * - Confidence: scaled by failure ratio, capped at 0.85.
 */
function suggestTighten(
  evidence: PolicySuggestionEvidence,
  policyId: string,
  ledger: LedgerEntry[],
  failures: FailureRecord[],
): PolicySuggestion | null {
  const { matchedCount } = evidence;
  if (matchedCount < MIN_SAMPLE_SIZE) return null;

  const matchedRunIds = matchedRunIdsForPolicy(policyId, ledger);
  if (matchedRunIds.size === 0) return null;

  const matchedPaths = new Set<string>();
  for (const entry of ledger) {
    if (!matchedRunIds.has(entry.runId)) continue;
    for (const path of entry.filesChanged) matchedPaths.add(path);
  }

  let overlappingFailures = 0;
  let totalQualifyingFailures = 0;
  for (const failure of failures) {
    if (
      failure.failureType !== "test_failure" &&
      failure.failureType !== "verification_timeout"
    ) {
      continue;
    }
    totalQualifyingFailures += 1;
    const paths = failure.filePaths ?? [];
    if (paths.some((p) => matchedPaths.has(p))) {
      overlappingFailures += 1;
    }
  }

  if (overlappingFailures < MIN_SAMPLE_SIZE) return null;

  const ratio = safeRatio(overlappingFailures, totalQualifyingFailures);
  const confidence = round2(clamp(ratio, 0, 0.85));
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    type: "tighten",
    policyId,
    reason: `Policy "${policyId}" matches ${matchedCount} run(s) but ${overlappingFailures} test/verification failure(s) still occur on matched paths`,
    evidence,
    confidence,
    recommendation: `Tighten match criteria for "${policyId}" or add a verification requirement on matched paths`,
    sourceHeuristic: "H2",
  };
}

/**
 * H3 — `add_rule` (ungoverned recurring failures).
 *
 * Recurring failure patterns exist without associated `policyIds` — the
 * failing path is unregulated.
 *
 * - Trigger: failure records with empty/absent `policyIds` on the same
 *   `filePaths` recurring `>= MIN_SAMPLE_SIZE` times.
 * - One suggestion per recurring path. Cap 0.8.
 */
function suggestAddRuleUngoverned(failures: FailureRecord[]): PolicySuggestion[] {
  const pathCounts = new Map<string, number>();
  let totalUngoverned = 0;

  for (const failure of failures) {
    const hasPolicies =
      Array.isArray(failure.policyIds) && failure.policyIds.length > 0;
    if (hasPolicies) continue;
    totalUngoverned += 1;
    const paths = failure.filePaths ?? [];
    for (const path of paths) {
      pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    }
  }

  const out: PolicySuggestion[] = [];
  for (const [path, recurrence] of pathCounts.entries()) {
    if (recurrence < MIN_SAMPLE_SIZE) continue;
    const ratio = safeRatio(recurrence, totalUngoverned);
    const confidence = round2(clamp(ratio, 0, 0.8));
    if (confidence < MIN_CONFIDENCE) continue;

    const evidence: PolicySuggestionEvidence = {
      matchedCount: 0,
      deniedCount: 0,
      bypassedCount: recurrence,
      relatedFailureCount: recurrence,
    };

    out.push({
      type: "add_rule",
      reason: `Recurring ungoverned failures (${recurrence}) on ${path} with no associated policy`,
      evidence,
      confidence,
      recommendation: `Add a policy governing ${path}`,
      sourceHeuristic: "H3",
    });
  }

  return out;
}

/**
 * H4 — `add_rule` (verification + test cluster).
 *
 * `verification_timeout` and `test_failure` records recur on the same file
 * paths — suggests a verification policy gap.
 *
 * - Trigger: `>= MIN_SAMPLE_SIZE` co-occurring `verification_timeout` and
 *   `test_failure` records sharing file paths.
 * - Cap 0.8.
 */
function suggestAddRuleVerificationCluster(
  failures: FailureRecord[],
): PolicySuggestion | null {
  const verifyPaths = new Map<string, number>();
  const testFailPaths = new Map<string, number>();
  let totalQualifying = 0;

  for (const failure of failures) {
    if (failure.failureType === "verification_timeout") {
      totalQualifying += 1;
      for (const path of failure.filePaths ?? []) {
        verifyPaths.set(path, (verifyPaths.get(path) ?? 0) + 1);
      }
    } else if (failure.failureType === "test_failure") {
      totalQualifying += 1;
      for (const path of failure.filePaths ?? []) {
        testFailPaths.set(path, (testFailPaths.get(path) ?? 0) + 1);
      }
    }
  }

  let coOccurrence = 0;
  for (const [path, vCount] of verifyPaths.entries()) {
    const tCount = testFailPaths.get(path) ?? 0;
    if (tCount > 0) {
      coOccurrence += Math.min(vCount, tCount);
    }
  }

  if (coOccurrence < MIN_SAMPLE_SIZE) return null;
  const ratio = safeRatio(coOccurrence, totalQualifying);
  const confidence = round2(clamp(ratio, 0, 0.8));
  if (confidence < MIN_CONFIDENCE) return null;

  const evidence: PolicySuggestionEvidence = {
    matchedCount: 0,
    deniedCount: 0,
    bypassedCount: coOccurrence,
    relatedFailureCount: coOccurrence,
  };

  return {
    type: "add_rule",
    reason: `Co-occurring verification_timeout + test_failure (${coOccurrence}) on shared paths — verification policy gap`,
    evidence,
    confidence,
    recommendation: "Add a verification policy covering the clustered test/timeout paths",
    sourceHeuristic: "H4",
  };
}

/**
 * H5 — `loosen` (repeated `policy_denied` with no downstream safety failure).
 *
 * `policy_denied` failures appear repeatedly for the same `policyId` with no
 * later safety failures tied to that policy.
 *
 * - Trigger: `policy_denied` failure count for `policyId`
 *   `>= MIN_SAMPLE_SIZE` AND `bypassedCount === 0`.
 * - Confidence: deterministic, scales with repetition, capped at 0.8.
 */
function suggestLoosenPolicyDenied(
  evidence: PolicySuggestionEvidence,
  policyId: string,
  failures: FailureRecord[],
): PolicySuggestion | null {
  const { bypassedCount } = evidence;
  if (bypassedCount !== 0) return null;

  const policyDeniedCount = countPolicyDeniedFailures(policyId, failures);
  if (policyDeniedCount < MIN_SAMPLE_SIZE) return null;

  const confidence = round2(
    clamp(safeRatio(policyDeniedCount, policyDeniedCount + 2), 0, 0.8),
  );
  if (confidence < MIN_CONFIDENCE) return null;

  return {
    type: "loosen",
    policyId,
    reason: `Policy "${policyId}" produced ${policyDeniedCount} policy_denied failure(s) with zero downstream safety failures`,
    evidence,
    confidence,
    recommendation: `Consider loosening "${policyId}" — repeated denies do not correspond to safety events`,
    sourceHeuristic: "H5",
  };
}

// ---------------------------------------------------------------------------
// Conflict resolution + sort
// ---------------------------------------------------------------------------

/**
 * Type preference order for conflict-resolution ties.
 * `tighten` wins over `loosen`/`remove_rule`; further tie broken
 * alphabetically by `type`.
 */
function conflictTieBreak(a: PolicySuggestion, b: PolicySuggestion): number {
  // tighten wins over everything.
  const aTighten = a.type === "tighten" ? 0 : 1;
  const bTighten = b.type === "tighten" ? 0 : 1;
  if (aTighten !== bTighten) return aTighten - bTighten;
  // alphabetical by type as final tie-break.
  return a.type.localeCompare(b.type);
}

/**
 * Resolve same-`policyId` conflicts so a single policyId never receives both
 * a `tighten` and a `loosen`/`remove_rule` in one output.
 *
 * - `add_rule` (no policyId) always kept.
 * - For each policyId with >1 suggestion: highest `confidence` wins;
 *   tie → `tighten` over `loosen`/`remove_rule`; further tie → alphabetical
 *   by `type`.
 */
function resolveConflicts(suggestions: PolicySuggestion[]): PolicySuggestion[] {
  const byPolicy = new Map<string, PolicySuggestion[]>();
  const withoutPolicy: PolicySuggestion[] = [];

  for (const suggestion of suggestions) {
    if (suggestion.policyId === undefined) {
      withoutPolicy.push(suggestion);
      continue;
    }
    const bucket = byPolicy.get(suggestion.policyId);
    if (bucket) {
      bucket.push(suggestion);
    } else {
      byPolicy.set(suggestion.policyId, [suggestion]);
    }
  }

  const resolved: PolicySuggestion[] = [...withoutPolicy];
  for (const bucket of byPolicy.values()) {
    if (bucket.length === 1) {
      resolved.push(bucket[0]);
      continue;
    }
    bucket.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return conflictTieBreak(a, b);
    });
    resolved.push(bucket[0]);
  }

  return resolved;
}

/**
 * Deterministic sort: confidence desc → type asc → policyId asc
 * (undefined sorts last).
 */
function sortDeterministic(suggestions: PolicySuggestion[]): PolicySuggestion[] {
  suggestions.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    const ap = a.policyId ?? "￿"; // undefined sorts last
    const bp = b.policyId ?? "￿";
    return ap.localeCompare(bp);
  });
  return suggestions;
}

// ---------------------------------------------------------------------------
// Internal: validation gate (every emitted suggestion must be well-formed)
// ---------------------------------------------------------------------------

/**
 * Validate a single suggestion has all required evidence fields:
 * non-empty reason, non-empty recommendation, sourceHeuristic set,
 * evidence with at least one non-zero count, and confidence >= MIN_CONFIDENCE.
 */
function isValidSuggestion(suggestion: PolicySuggestion): boolean {
  if (!suggestion.reason || suggestion.reason.trim().length === 0) return false;
  if (
    !suggestion.recommendation ||
    suggestion.recommendation.trim().length === 0
  ) {
    return false;
  }
  if (!suggestion.sourceHeuristic) return false;
  if (typeof suggestion.confidence !== "number") return false;
  if (suggestion.confidence < MIN_CONFIDENCE) return false;
  const { matchedCount, deniedCount, bypassedCount, relatedFailureCount } =
    suggestion.evidence;
  if (
    matchedCount === 0 &&
    deniedCount === 0 &&
    bypassedCount === 0 &&
    relatedFailureCount === 0
  ) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Compute governance policy refinement suggestions by cross-referencing the
 * run ledger and failure memory.
 *
 * Pipeline:
 * 1. Collect candidate policyIds (union of matched + tagged).
 * 2. For each policyId, compute evidence via `computeEvidenceForPolicy`.
 * 3. Run H1, H2, H5 against named-policy evidence; collect emitted suggestions.
 * 4. Run H3, H4 against failures directly (emit `add_rule` with no policyId).
 * 5. Apply conflict resolution (same-policyId).
 * 6. Filter out suggestions with `confidence < MIN_CONFIDENCE` or invalid shape.
 * 7. Sort deterministically (confidence desc → type asc → policyId asc,
 *    undefined last).
 * 8. Return the array.
 *
 * Pure: identical inputs yield identical outputs.
 */
export function computePolicySuggestions(
  ledger: LedgerEntry[],
  failures: FailureRecord[],
): PolicySuggestion[] {
  const emitted: PolicySuggestion[] = [];

  // Steps 1–3: H1, H2, H5 against named-policy evidence.
  const candidatePolicyIds = collectCandidatePolicyIds(ledger, failures);
  for (const policyId of candidatePolicyIds) {
    const evidence = computeEvidenceForPolicy(policyId, ledger, failures);

    const h1 = suggestLoosenOrRemove(evidence, policyId);
    if (h1) emitted.push(h1);

    const h2 = suggestTighten(evidence, policyId, ledger, failures);
    if (h2) emitted.push(h2);

    const h5 = suggestLoosenPolicyDenied(evidence, policyId, failures);
    if (h5) emitted.push(h5);
  }

  // Step 4: H3, H4 against failures directly.
  emitted.push(...suggestAddRuleUngoverned(failures));
  const h4 = suggestAddRuleVerificationCluster(failures);
  if (h4) emitted.push(h4);

  // Step 5: conflict resolution.
  const resolved = resolveConflicts(emitted);

  // Step 6: filter invalid + below-threshold suggestions.
  const filtered = resolved.filter(isValidSuggestion);

  // Step 7: deterministic sort.
  return sortDeterministic(filtered);
}
