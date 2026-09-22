/**
 * reliability.ts — Reliability of a decision's native score (J4 task 28).
 *
 * Computes binned calibration (accuracy vs. mean score) plus ECE and Brier,
 * but ONLY where the semantics are valid:
 *
 *  - The metric follows the native result primitive: Noul → probability,
 *    Score → the rubric score, Choice → confidence. Those are different
 *    scales, so a report refuses to mix kinds.
 *  - A report is scoped to one decision AND one engine: JEV-9 forbids
 *    transferring calibration across engines.
 *  - Samples with no native score cannot be binned; they are counted, not
 *    silently treated as 0.
 *
 * SIMPLEX ASSUMPTION: probabilities are treated as a proper simplex over a
 * single question. The vendor does not guarantee structural invariants across
 * complementary questions (its own example has P and 1-P summing to 1.19), so
 * this is only meaningful because every ALiX decision asks exactly ONE
 * question per call. Do not reuse this for a multi-question payload.
 */

import type { DecisionType } from "../contracts.js";
import type { CalibrationSample, CalibrationSampleKind } from "./dataset.js";

export type ReliabilityBin = {
  from: number;
  to: number;
  count: number;
  meanScore: number;
  accuracy: number;
};

export type ReliabilityMetric = "confidence" | "probability" | "score";

export type ReliabilityReport = {
  decision: DecisionType;
  engineId: string;
  metric: ReliabilityMetric;
  /** Scorable samples used in the report. */
  sampleCount: number;
  /** Samples carrying no native score for their kind. */
  excludedUnscored: number;
  bins: ReliabilityBin[];
  expectedCalibrationError: number;
  brierScore: number;
};

export class CalibrationValidationError extends Error {
  readonly code = "CALIBRATION_VALIDATION";
  constructor(message: string) {
    super(message);
    this.name = "CalibrationValidationError";
  }
}

export const DEFAULT_BIN_COUNT = 10;

/** Metric is a function of the native primitive, never of which field is set. */
const METRIC_BY_KIND: Record<CalibrationSampleKind, ReliabilityMetric> = {
  choice: "confidence",
  score: "score",
  noul: "probability",
};

function nativeScoreOf(
  sample: CalibrationSample,
  metric: ReliabilityMetric,
): number | undefined {
  switch (metric) {
    case "probability":
      return sample.probability;
    case "score":
      return sample.score;
    case "confidence":
      return sample.confidence;
  }
}

type Scorable = { score: number; correct: boolean };

function scorableSamples(samples: readonly CalibrationSample[]): {
  scorable: Scorable[];
  excludedUnscored: number;
  metric: ReliabilityMetric;
} {
  const kinds = new Set(samples.map((sample) => sample.kind));
  if (kinds.size !== 1) {
    throw new CalibrationValidationError(
      `cannot mix native result kinds in one report: ${[...kinds].join(", ")}`,
    );
  }
  const metric = METRIC_BY_KIND[samples[0].kind];

  const scorable: Scorable[] = [];
  let excludedUnscored = 0;
  for (const sample of samples) {
    const score = nativeScoreOf(sample, metric);
    if (score === undefined) {
      excludedUnscored += 1;
      continue;
    }
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new CalibrationValidationError(`native score outside 0..1: ${String(score)}`);
    }
    scorable.push({ score, correct: sample.correct });
  }
  return { scorable, excludedUnscored, metric };
}

/**
 * Binned reliability for one decision + engine. Throws (rather than guessing)
 * when the samples are empty, heterogeneous, or carry no native score.
 */
export function computeReliability(
  samples: readonly CalibrationSample[],
  opts?: { bins?: number },
): ReliabilityReport {
  if (samples.length === 0) {
    throw new CalibrationValidationError("no samples to calibrate");
  }
  const decisions = new Set(samples.map((sample) => sample.decision));
  const engines = new Set(samples.map((sample) => sample.engineId));
  if (decisions.size !== 1) {
    throw new CalibrationValidationError(
      `samples span multiple decisions: ${[...decisions].join(", ")}`,
    );
  }
  if (engines.size !== 1) {
    throw new CalibrationValidationError(
      `samples span multiple engines: ${[...engines].join(", ")} (calibration is not transferable)`,
    );
  }

  const binCount = opts?.bins ?? DEFAULT_BIN_COUNT;
  if (!Number.isInteger(binCount) || binCount <= 0) {
    throw new CalibrationValidationError(`bins must be a positive integer, got ${String(binCount)}`);
  }

  const { scorable, excludedUnscored, metric } = scorableSamples(samples);
  const total = scorable.length;
  if (total === 0) {
    throw new CalibrationValidationError("no samples carry a native score to calibrate");
  }

  const buckets: Scorable[][] = Array.from({ length: binCount }, () => []);
  for (const sample of scorable) {
    // Top bin is inclusive of 1.
    const index = Math.min(binCount - 1, Math.floor(sample.score * binCount));
    buckets[index].push(sample);
  }

  const bins: ReliabilityBin[] = buckets.map((bucket, index) => {
    const from = index / binCount;
    const to = (index + 1) / binCount;
    if (bucket.length === 0) {
      return { from, to, count: 0, meanScore: 0, accuracy: 0 };
    }
    const meanScore = bucket.reduce((sum, item) => sum + item.score, 0) / bucket.length;
    const accuracy = bucket.filter((item) => item.correct).length / bucket.length;
    return { from, to, count: bucket.length, meanScore, accuracy };
  });

  const expectedCalibrationError =
    bins.reduce(
      (sum, bin) => sum + (bin.count / total) * Math.abs(bin.accuracy - bin.meanScore),
      0,
    );
  const brierScore =
    scorable.reduce(
      (sum, item) => sum + (item.score - (item.correct ? 1 : 0)) ** 2,
      0,
    ) / total;

  return {
    decision: samples[0].decision,
    engineId: samples[0].engineId,
    metric,
    sampleCount: total,
    excludedUnscored,
    bins,
    expectedCalibrationError,
    brierScore,
  };
}
