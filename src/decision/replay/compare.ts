/**
 * compare.ts — Engine/version comparison over the same fixtures (J5 task 32).
 *
 * Compares agreement ("do the two engines answer the same way?"), accuracy
 * (against labels supplied by the caller), latency (mean + p95), and cost.
 * Native confidence/probability values are NOT compared — two versions may
 * legitimately recalibrate the same answer.
 */

import type { ExecutorOutcome } from "../executors.js";
import type { ReplayFixture } from "./fixtures.js";
import type { ReplayRun } from "./harness.js";
import { estimateFixtureCostUsd } from "./cost.js";

export type NormalizedOutcome =
  | { kind: "choice"; choice: unknown }
  | { kind: "score"; score: number }
  | { kind: "noul"; probability: number }
  | { kind: "failure" };

/** Compare the answer, not the confidence, provenance, or latency. */
export function normalizeOutcome(outcome: ExecutorOutcome): NormalizedOutcome {
  switch (outcome.kind) {
    case "choice":
      return { kind: "choice", choice: outcome.choice };
    case "score":
      return { kind: "score", score: outcome.score };
    case "noul":
      return { kind: "noul", probability: outcome.probability };
    case "failure":
      return { kind: "failure" };
  }
}

function sameAnswer(a: NormalizedOutcome, b: NormalizedOutcome): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

export type EngineSideReport = {
  engineId: string;
  runs: number;
  malformed: number;
  accuracy?: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
};

export type EngineComparison = {
  paired: number;
  /** Fraction of paired fixtures both engines answered identically. */
  agreement: number;
  baseline: EngineSideReport;
  candidate: EngineSideReport;
  /** Candidate minus baseline (negative is an improvement). */
  latencyDeltaMs: number;
  /** Candidate minus baseline (negative is an improvement). */
  costDeltaUsd: number;
};

export type CompareOptions = {
  /** Correctness predicate; without it, accuracy is omitted for both sides. */
  isCorrect?: (fixtureId: string, outcome: ExecutorOutcome) => boolean;
  /** Cost model; defaults to the documented vendor estimate. */
  costOf?: (fixture: ReplayFixture, engineId: string) => number;
};

function sideReport(
  engineId: string,
  runs: readonly ReplayRun[],
  isCorrect: CompareOptions["isCorrect"],
  cost: number,
): EngineSideReport {
  const malformed = runs.filter((run) => run.outcome.kind === "failure").length;
  const accuracies = isCorrect
    ? runs.map((run) => (isCorrect(run.fixtureId, run.outcome) ? 1 : 0))
    : undefined;
  return {
    engineId,
    runs: runs.length,
    malformed,
    ...(accuracies !== undefined ? { accuracy: mean(accuracies) } : {}),
    meanLatencyMs: mean(runs.map((run) => run.latencyMs)),
    p95LatencyMs: percentile(
      runs.map((run) => run.latencyMs),
      95,
    ),
    totalCostUsd: cost,
  };
}

/**
 * Compare two engines' runs over the same fixtures (matched by fixture id).
 * Fixtures present on only one side are excluded from `paired` but each
 * side still reports its own run count.
 */
export function compareEngineRuns(input: {
  fixtures: readonly ReplayFixture[];
  baseline: readonly ReplayRun[];
  candidate: readonly ReplayRun[];
  baselineEngineId: string;
  candidateEngineId: string;
  isCorrect?: CompareOptions["isCorrect"];
  costOf?: CompareOptions["costOf"];
}): EngineComparison {
  const costOf = input.costOf ?? estimateFixtureCostUsd;
  const baselineById = new Map(input.baseline.map((run) => [run.fixtureId, run]));
  const candidateById = new Map(input.candidate.map((run) => [run.fixtureId, run]));

  const paired = input.fixtures.filter(
    (fixture) => baselineById.has(fixture.id) && candidateById.has(fixture.id),
  );
  let agreed = 0;
  for (const fixture of paired) {
    const a = normalizeOutcome(baselineById.get(fixture.id)?.outcome as ExecutorOutcome);
    const b = normalizeOutcome(candidateById.get(fixture.id)?.outcome as ExecutorOutcome);
    if (sameAnswer(a, b)) agreed += 1;
  }

  const baseline = sideReport(
    input.baselineEngineId,
    input.baseline,
    input.isCorrect,
    input.fixtures.reduce((sum, fixture) => sum + costOf(fixture, input.baselineEngineId), 0),
  );
  const candidate = sideReport(
    input.candidateEngineId,
    input.candidate,
    input.isCorrect,
    input.fixtures.reduce((sum, fixture) => sum + costOf(fixture, input.candidateEngineId), 0),
  );

  return {
    paired: paired.length,
    agreement: paired.length === 0 ? 0 : agreed / paired.length,
    baseline,
    candidate,
    latencyDeltaMs: candidate.meanLatencyMs - baseline.meanLatencyMs,
    costDeltaUsd: candidate.totalCostUsd - baseline.totalCostUsd,
  };
}
