/**
 * gates.ts — Regression gates for engine/model/threshold changes (J5 task 33).
 *
 * A candidate (new engine version, new model, new threshold) must prove
 * itself on the same fixtures before it may be promoted. The gate is
 * fail-closed: disagreement below the floor, accuracy regression beyond the
 * allowance, any malformed candidate outcome, or an empty fixture set all
 * fail. Latency and cost are REPORTED (task 32), not gated — a slower but
 * more accurate engine is a governance decision, not an automatic rejection.
 */

import type { ExecutorOutcome } from "../executors.js";
import type { ReplayFixture } from "./fixtures.js";
import type { ReplayRun } from "./harness.js";
import { compareEngineRuns, type EngineComparison } from "./compare.js";

export type PromotionGatePolicy = {
  /** Minimum answer agreement between baseline and candidate. */
  minAgreement: number;
  /** Maximum allowed accuracy drop vs the baseline (0 = no regression). */
  maxAccuracyDrop: number;
  /** Default false: any malformed candidate outcome fails the gate. */
  allowMalformed?: boolean;
};

export type PromotionGateResult = {
  pass: boolean;
  reasons: string[];
  comparison: EngineComparison;
};

const DEFAULT_AGREEMENT_FLOOR = 0.8;
const DEFAULT_ACCURACY_DROP = 0;

export function evaluatePromotionGate(input: {
  fixtures: readonly ReplayFixture[];
  baseline: readonly ReplayRun[];
  candidate: readonly ReplayRun[];
  baselineEngineId: string;
  candidateEngineId: string;
  isCorrect?: (fixtureId: string, outcome: ExecutorOutcome) => boolean;
  costOf?: (fixture: ReplayFixture, engineId: string) => number;
  policy?: Partial<PromotionGatePolicy>;
}): PromotionGateResult {
  const policy: PromotionGatePolicy = {
    minAgreement: DEFAULT_AGREEMENT_FLOOR,
    maxAccuracyDrop: DEFAULT_ACCURACY_DROP,
    ...input.policy,
  };
  const reasons: string[] = [];

  if (input.fixtures.length === 0) {
    return {
      pass: false,
      reasons: ["no fixtures: a promotion gate over an empty corpus proves nothing"],
      comparison: compareEngineRuns(input),
    };
  }

  const comparison = compareEngineRuns(input);

  if (comparison.agreement < policy.minAgreement) {
    reasons.push(
      `agreement ${comparison.agreement.toFixed(3)} below floor ${policy.minAgreement}`,
    );
  }

  if (comparison.baseline.accuracy !== undefined && comparison.candidate.accuracy !== undefined) {
    const drop = comparison.baseline.accuracy - comparison.candidate.accuracy;
    if (drop > policy.maxAccuracyDrop) {
      reasons.push(
        `accuracy dropped ${drop.toFixed(3)} (baseline ${comparison.baseline.accuracy.toFixed(3)} -> candidate ${comparison.candidate.accuracy.toFixed(3)}, allowance ${policy.maxAccuracyDrop})`,
      );
    }
  }

  if (policy.allowMalformed !== true && comparison.candidate.malformed > 0) {
    reasons.push(`${comparison.candidate.malformed} malformed candidate outcome(s)`);
  }

  return { pass: reasons.length === 0, reasons, comparison };
}
