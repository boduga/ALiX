/**
 * local-baseline.ts — Deterministic claim-verification baseline (J1).
 *
 * Rule-based, conservative, no confidence: prefer "insufficient" when the
 * evidence does not clearly bear on the claim. This is the comparison arm
 * for shadow mode (J1) and the fallback when Jev is unavailable — never an
 * authority. Adversarial instruction text inside evidence is data, not
 * authority: it cannot move the verdict beyond the deterministic rules.
 */

import type { ClaimVerdict } from "./schema.js";
import type { ClaimVerificationProjection } from "./projection.js";
import { contentWords, numbers } from "../shared/text.js";

/** Whole-word negation/contradiction markers. */
const NEGATION_RE =
  /\b(?:not|never|no|cannot|can't|isn't|wasn't|aren't|doesn't|don't|didn't|false|incorrect|contrary|opposite|untrue|myth|refutes|refuted|denies|denied)\b/;

/** Claim-term overlap at or above this ratio counts as "evidence bears on it". */
export const SUPPORT_OVERLAP_THRESHOLD = 0.5;

export type LocalClaimVerdict = {
  verdict: ClaimVerdict;
  reason: string;
};

export type LocalClassifyOptions = {
  /** Claim-term overlap required for "evidence bears on it"
   *  (default `SUPPORT_OVERLAP_THRESHOLD`). Wired from the active
   *  local threshold profile — see `resolveLocalClaimThreshold`. */
  supportOverlapThreshold?: number;
};

/**
 * Deterministic classification. No I/O, no model, no network.
 * Same projection always yields the same verdict.
 */
export function classifyClaimLocally(
  projection: ClaimVerificationProjection,
  opts?: LocalClassifyOptions,
): LocalClaimVerdict {
  const supportOverlapThreshold = opts?.supportOverlapThreshold ?? SUPPORT_OVERLAP_THRESHOLD;
  const claimWords = new Set(contentWords(projection.claim));
  if (claimWords.size === 0) {
    return { verdict: "insufficient", reason: "claim has no content words" };
  }

  const evidenceText = projection.evidence.join("\n").trim();
  if (evidenceText.length === 0) {
    return { verdict: "insufficient", reason: "no evidence provided" };
  }

  const evidenceWords = new Set(contentWords(evidenceText));
  const overlap = [...claimWords].filter((word) => evidenceWords.has(word));
  const overlapRatio = overlap.length / claimWords.size;

  if (overlapRatio < supportOverlapThreshold) {
    return {
      verdict: "insufficient",
      reason: `claim-term overlap ${Math.round(overlapRatio * 100)}% below threshold`,
    };
  }

  const negation = NEGATION_RE.test(evidenceText.toLowerCase());
  const claimNumbers = numbers(projection.claim);
  const evidenceNumbers = numbers(evidenceText);
  const numericConflict =
    claimNumbers.length > 0 &&
    evidenceNumbers.length > 0 &&
    !claimNumbers.some((value) => evidenceNumbers.includes(value));

  if (negation || numericConflict) {
    const cause = negation ? "negation marker" : "numeric mismatch";
    return {
      verdict: "contradicted",
      reason: `${cause} with ${Math.round(overlapRatio * 100)}% claim-term overlap`,
    };
  }

  return {
    verdict: "supported",
    reason: `${Math.round(overlapRatio * 100)}% claim-term overlap, no contradiction marker`,
  };
}
