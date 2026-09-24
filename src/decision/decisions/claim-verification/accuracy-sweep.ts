/**
 * accuracy-sweep.ts — Local claim threshold accuracy sweep (J1/J4 bridge).
 *
 * The local claim baseline's tunable IS `supportOverlapThreshold`, but the
 * baseline emits no confidence, so `computeReliability` cannot calibrate it
 * (JEV-9). This sweep re-runs `classifyClaimLocally` across the threshold
 * grid over the labeled corpus — corpus `expected` labels are the ground
 * truth (journal labels only keep a `correct` boolean, so an incorrect
 * ternary verdict is not reconstructable from them). Selection and refusal
 * rules live in the decision-neutral `sweepAccuracy` primitive.
 */

import { CLAIM_VERIFICATION_CORPUS } from "./corpus.js";
import { classifyClaimLocally } from "./local-baseline.js";
import {
  sweepAccuracy,
  type AccuracySweepResult,
} from "../../calibration/accuracy-sweep.js";

export function sweepLocalClaimThreshold(opts: {
  targetAccuracy: number;
  bins?: number;
}): AccuracySweepResult {
  const cases = CLAIM_VERIFICATION_CORPUS.map((fixture) => ({
    id: fixture.id,
    expected: fixture.expected,
    verdictAt: (threshold: number) =>
      classifyClaimLocally(
        {
          claim: fixture.claim,
          evidence: (fixture.evidence ?? []).map((item) => item.excerpt),
        },
        { supportOverlapThreshold: threshold },
      ).verdict,
  }));
  return sweepAccuracy(cases, opts);
}
