/**
 * selection.ts — Deterministic rank/filter for scored items (J2).
 *
 * The model never ranks a set; it scores one item at a time. Ranking, the
 * threshold comparison, and the cap happen here, deterministically. Each item
 * is thresholded against ITS OWN engine's profile so a fallback engine cannot
 * inherit another engine's calibration (JEV-9).
 */

import type { RelevanceThresholdProfile } from "./thresholds.js";

export type ScoredItem = {
  id: string;
  probability: number;
  engineId: string;
};

export type SelectionResult = {
  selectedIds: string[];
  rejectedIds: string[];
  /** Distinct profile ids applied, in first-use order. */
  thresholdProfileIds: string[];
  /** engineId -> threshold applied. */
  thresholds: Record<string, number>;
};

export type EngineThresholdResolver = (engineId: string) => RelevanceThresholdProfile;

/**
 * Filter by per-engine threshold, rank by probability desc (stable on ties),
 * then cap. `maxItems` undefined means no cap.
 */
export function selectWithEngineThresholds(
  scores: readonly ScoredItem[],
  opts: { resolveProfile: EngineThresholdResolver; maxItems?: number },
): SelectionResult {
  const thresholds: Record<string, number> = {};
  const profileIds: string[] = [];
  const profileFor = (engineId: string): number => {
    const cached = thresholds[engineId];
    if (cached !== undefined) return cached;
    const profile = opts.resolveProfile(engineId);
    thresholds[engineId] = profile.threshold;
    if (!profileIds.includes(profile.id)) profileIds.push(profile.id);
    return profile.threshold;
  };

  const ranked = scores
    .map((score, index) => ({ ...score, index }))
    .sort((a, b) => b.probability - a.probability || a.index - b.index);

  const passing = ranked.filter((score) => score.probability >= profileFor(score.engineId));
  const capped = opts.maxItems !== undefined ? passing.slice(0, opts.maxItems) : passing;

  const selectedIds = capped.map((score) => score.id);
  const selected = new Set(selectedIds);
  const rejectedIds = scores.map((score) => score.id).filter((id) => !selected.has(id));

  return { selectedIds, rejectedIds, thresholdProfileIds: profileIds, thresholds };
}
