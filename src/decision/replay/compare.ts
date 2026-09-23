/**
 * compare.ts — Engine/version comparison over the same fixtures (J5 task 32).
 *
 * Compares agreement ("do the two engines answer the same way?"), accuracy
 * (against labels supplied by the caller), latency (mean + p95), and cost.
 * Native confidence/probability values are NOT compared — two versions may
 * legitimately recalibrate the same answer.
 */

import type { DecisionUsage } from "../contracts.js";
import type { ExecutorOutcome } from "../executors.js";
import type { ReplayFixture } from "./fixtures.js";
import type { ReplayRun } from "./harness.js";
import { costForRun } from "./cost.js";

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

/**
 * Default tolerance for continuous outcomes. A Noul probability or a Score
 * rating is a float: two engines will essentially never produce the same bits,
 * so exact equality would report 0% agreement for every probabilistic
 * decision. Discrete outcomes (Choice) still compare exactly.
 */
export const DEFAULT_CONTINUOUS_TOLERANCE = 0.1;

/** The continuous value of an outcome, when it has one. */
function continuousValue(outcome: NormalizedOutcome): number | undefined {
  if (outcome.kind === "noul") return outcome.probability;
  if (outcome.kind === "score") return outcome.score;
  return undefined;
}

function sameAnswer(a: NormalizedOutcome, b: NormalizedOutcome, tolerance: number): boolean {
  if (a.kind === b.kind) {
    const av = continuousValue(a);
    const bv = continuousValue(b);
    if (av !== undefined && bv !== undefined) return Math.abs(av - bv) <= tolerance;
  }
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
  /** Provider-reported input tokens, when every counted run reported usage. */
  reportedInputTokens?: number;
  reportedOutputTokens?: number;
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
  /** Agreement tolerance applied to continuous outcomes. */
  continuousTolerance: number;
  /**
   * Mean |candidate - baseline| over paired continuous outcomes. The real
   * signal when agreement is tolerance-based.
   */
  meanAbsoluteDelta?: number;
};

export type CompareOptions = {
  /** Correctness predicate; without it, accuracy is omitted for both sides. */
  isCorrect?: (fixtureId: string, outcome: ExecutorOutcome) => boolean;
  /** Cost model; defaults to reported usage, falling back to the estimate. */
  costOf?: (fixture: ReplayFixture, engineId: string, usage?: DecisionUsage) => number;
  /** Agreement tolerance for continuous outcomes. Default 0.1. */
  continuousTolerance?: number;
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
  const reported = runs.filter((run) => run.usage !== undefined);
  const reportedTokens = reported.length > 0
    ? {
        reportedInputTokens: reported.reduce((sum, run) => sum + (run.usage?.inputTokens ?? 0), 0),
        reportedOutputTokens: reported.reduce((sum, run) => sum + (run.usage?.outputTokens ?? 0), 0),
      }
    : {};
  return {
    engineId,
    runs: runs.length,
    malformed,
    ...reportedTokens,
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
  continuousTolerance?: CompareOptions["continuousTolerance"];
}): EngineComparison {
  const costOf = input.costOf ?? costForRun;
  const baselineById = new Map(input.baseline.map((run) => [run.fixtureId, run]));
  const candidateById = new Map(input.candidate.map((run) => [run.fixtureId, run]));

  const paired = input.fixtures.filter(
    (fixture) => baselineById.has(fixture.id) && candidateById.has(fixture.id),
  );
  const tolerance = input.continuousTolerance ?? DEFAULT_CONTINUOUS_TOLERANCE;
  let agreed = 0;
  const deltas: number[] = [];
  for (const fixture of paired) {
    const a = normalizeOutcome(baselineById.get(fixture.id)?.outcome as ExecutorOutcome);
    const b = normalizeOutcome(candidateById.get(fixture.id)?.outcome as ExecutorOutcome);
    if (sameAnswer(a, b, tolerance)) agreed += 1;
    if (a.kind === b.kind) {
      const av = continuousValue(a);
      const bv = continuousValue(b);
      if (av !== undefined && bv !== undefined) deltas.push(Math.abs(av - bv));
    }
  }

  const usageById = (runs: readonly ReplayRun[]): Map<string, DecisionUsage> =>
    new Map(runs.filter((run) => run.usage !== undefined).map((run) => [run.fixtureId, run.usage!]));
  const baselineUsage = usageById(input.baseline);
  const candidateUsage = usageById(input.candidate);

  const baseline = sideReport(
    input.baselineEngineId,
    input.baseline,
    input.isCorrect,
    input.fixtures.reduce(
      (sum, fixture) => sum + costOf(fixture, input.baselineEngineId, baselineUsage.get(fixture.id)),
      0,
    ),
  );
  const candidate = sideReport(
    input.candidateEngineId,
    input.candidate,
    input.isCorrect,
    input.fixtures.reduce(
      (sum, fixture) => sum + costOf(fixture, input.candidateEngineId, candidateUsage.get(fixture.id)),
      0,
    ),
  );

  return {
    paired: paired.length,
    agreement: paired.length === 0 ? 0 : agreed / paired.length,
    baseline,
    candidate,
    latencyDeltaMs: candidate.meanLatencyMs - baseline.meanLatencyMs,
    costDeltaUsd: candidate.totalCostUsd - baseline.totalCostUsd,
    continuousTolerance: tolerance,
    ...(deltas.length > 0
      ? { meanAbsoluteDelta: deltas.reduce((sum, value) => sum + value, 0) / deltas.length }
      : {}),
  };
}
