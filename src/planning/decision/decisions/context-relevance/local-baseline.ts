/**
 * local-baseline.ts — Deterministic context-relevance baseline (J2).
 *
 * Probability = fraction of the objective's content terms present in the
 * item. Deterministic, no I/O, no confidence. Conservative by construction:
 * an objective with no content words scores 0, so nothing is selected on a
 * meaningless objective.
 */

import { contentWords } from "../shared/text.js";
import type { ContextRelevanceProjection } from "./projection.js";

export type LocalRelevanceScore = {
  probability: number;
  reason: string;
};

export function scoreRelevanceLocally(
  projection: ContextRelevanceProjection,
): LocalRelevanceScore {
  const objectiveTerms = new Set(contentWords(projection.objective));
  if (objectiveTerms.size === 0) {
    return { probability: 0, reason: "objective has no content terms" };
  }
  const itemTerms = new Set(contentWords(projection.item));
  const present = [...objectiveTerms].filter((term) => itemTerms.has(term)).length;
  const probability = present / objectiveTerms.size;
  return {
    probability,
    reason: `${present}/${objectiveTerms.size} objective terms present`,
  };
}
