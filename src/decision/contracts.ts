/**
 * contracts.ts — Typed Choice/Score/Noul result contracts + provenance.
 *
 * J0a (hand-off §4, §8): native Jev result semantics preserved. Choice/Score
 * may carry confidence per provider contract; Noul carries probability, never
 * a flattened universal confidence. No executable-action invention here —
 * candidates come from ALiX (JEV-1).
 */

/** Bounded decision vocabulary for the first integration. */
export type DecisionType =
  | "claim-verification"
  | "context-relevance"
  | "model-tier";

/**
 * Risk context a decision was made under, captured AT DECISION TIME.
 *
 * It belongs on the journal record, not on a post-hoc label: threshold
 * profiles are per decision/engine/risk, and risk cannot be reconstructed
 * after the fact from a label that may never arrive or may be revised.
 */
export const RISK_CONTEXTS = ["low", "medium", "high"] as const;
export type RiskContext = (typeof RISK_CONTEXTS)[number];

export function isRiskContext(value: unknown): value is RiskContext {
  return (RISK_CONTEXTS as readonly unknown[]).includes(value);
}

/** Common provenance attached to every decision result. */
export type DecisionProvenance = {
  engineId: string;
  engineVersion?: string;
  latencyMs: number;
  remote: boolean;
  projectionHash: string;
};

/** Bounded choice over ALiX-supplied candidates. */
export type ChoiceResult<T> = {
  kind: "choice";
  choice: T;
  confidence?: number;
  provenance: DecisionProvenance;
};

/** Bounded score judgment. Range 0..1 inclusive. */
export type ScoreResult = {
  kind: "score";
  score: number;
  confidence?: number;
  provenance: DecisionProvenance;
};

/** Probabilistic judgment. Probability 0..1 inclusive, never confidence. */
export type NoulResult = {
  kind: "noul";
  probability: number;
  provenance: DecisionProvenance;
};

/** Native result union. Never flattened to {value, confidence}. */
export type DecisionResult<T> =
  | ChoiceResult<T>
  | ScoreResult
  | NoulResult;

export function isChoiceResult<T>(r: DecisionResult<T>): r is ChoiceResult<T> {
  return r.kind === "choice";
}

export function isScoreResult<T>(r: DecisionResult<T>): r is ScoreResult {
  return r.kind === "score";
}

export function isNoulResult<T>(r: DecisionResult<T>): r is NoulResult {
  return r.kind === "noul";
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Confidence, when present, must be 0..1. Absent is valid. */
export function isValidConfidence(c: unknown): boolean {
  if (c === undefined) return true;
  return isUnitInterval(c);
}

function isUnitInterval(n: unknown): n is number {
  return isFiniteNumber(n) && (n as number) >= 0 && (n as number) <= 1;
}

/** Bounded 0..1 score. Shares the probability range; the name keeps native semantics. */
export const isValidScore: (s: unknown) => s is number = isUnitInterval;

/** Bounded 0..1 probability. Shares the score range; the name keeps native semantics. */
export const isValidProbability: (p: unknown) => p is number = isUnitInterval;

/**
 * Structural outcome for the shared validation gate (journal + executors).
 * Deliberately provenance-free: gates judge shape, records carry provenance.
 */
export type OutcomeLike =
  | { kind: "choice"; choice: unknown; confidence?: unknown }
  | { kind: "score"; score: unknown; confidence?: unknown }
  | { kind: "noul"; probability: unknown }
  | { kind: "failure"; error: unknown };

/** Pure gate: reason string when malformed, null when valid. Never throws. */
export function outcomeIssue(
  outcome: OutcomeLike,
  candidates?: readonly unknown[],
): string | null {
  if (!outcome || typeof outcome !== "object") return "outcome must be an object";
  switch (outcome.kind) {
    case "choice":
      if (!isValidConfidence(outcome.confidence)) return "choice.confidence outside 0..1";
      if (candidates !== undefined && !candidates.includes(outcome.choice)) {
        return "choice not in candidate set";
      }
      return null;
    case "score":
      if (!isValidScore(outcome.score)) return "score outside 0..1";
      if (!isValidConfidence(outcome.confidence)) return "score.confidence outside 0..1";
      return null;
    case "noul":
      if (!isValidProbability(outcome.probability)) return "probability outside 0..1";
      return null;
    case "failure":
      if (typeof outcome.error !== "string" || outcome.error.length === 0) {
        return "failure.error must be non-empty";
      }
      return null;
    default:
      return `unknown outcome kind: ${String((outcome as { kind?: unknown }).kind)}`;
  }
}

/**
 * Strict candidate membership. Unknown/malformed choice rejected, never
 * coerced to an executable action (failure model).
 */
export function isValidChoice<T>(choice: unknown, candidates: readonly T[]): choice is T {
  return (candidates as readonly unknown[]).includes(choice);
}

export function validateProvenance(p: unknown): p is DecisionProvenance {
  if (!p || typeof p !== "object") return false;
  const v = p as Record<string, unknown>;
  return (
    typeof v.engineId === "string" &&
    v.engineId.length > 0 &&
    (v.engineVersion === undefined || typeof v.engineVersion === "string") &&
    isFiniteNumber(v.latencyMs) &&
    (v.latencyMs as number) >= 0 &&
    typeof v.remote === "boolean" &&
    typeof v.projectionHash === "string" &&
    (v.projectionHash as string).length > 0
  );
}
