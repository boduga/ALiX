/**
 * executors.ts — DecisionExecutor interface + outcome validation (J0).
 *
 * Registry holds engine metadata; executors do the work. Local baselines
 * answer deterministically and abstain honestly (no fake confidence).
 * Remote executors fail with EngineUnavailableError so fallback engages.
 */

import type { DecisionType, DecisionResult } from "./contracts.js";
import { outcomeIssue } from "./contracts.js";
import type { RemoteSealedProjection } from "./boundary.js";

/** Terminal outcome: native result or explicit failure signal. */
export type ExecutorOutcome =
  | DecisionResult<unknown>
  | { kind: "failure"; error: string; fallbackEngine?: string };

export type ExecuteInput = {
  decision: DecisionType;
  sealed: RemoteSealedProjection<Record<string, unknown>>;
  candidates?: readonly unknown[];
};

export type DecisionExecutor = {
  engineId: string;
  execute(input: ExecuteInput): Promise<ExecutorOutcome>;
};

export class EngineUnavailableError extends Error {
  readonly code = "ENGINE_UNAVAILABLE";
  constructor(engineId: string, detail: string) {
    super(`Decision engine unavailable (${engineId}): ${detail}`);
    this.name = "EngineUnavailableError";
  }
}

export class ExecutorMissingError extends Error {
  readonly code = "EXECUTOR_MISSING";
  constructor(engineId: string) {
    super(`No executor bound to registered engine: ${engineId}`);
    this.name = "ExecutorMissingError";
  }
}

export class MalformedResultError extends Error {
  readonly code = "MALFORMED_RESULT";
  constructor(reason: string) {
    super(`Malformed decision result: ${reason}`);
    this.name = "MalformedResultError";
  }
}

/**
 * Failure-model gate (JEV-1): unknown/malformed results rejected, never
 * coerced. Failure-kind outcomes pass through — they are terminal signals.
 */
export function assertValidOutcome(
  outcome: ExecutorOutcome,
  candidates?: readonly unknown[],
): void {
  const issue = outcomeIssue(outcome, candidates);
  if (issue !== null) throw new MalformedResultError(issue);
}
