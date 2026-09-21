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
export function isValidConfidence(c: number | undefined): boolean {
  if (c === undefined) return true;
  return isFiniteNumber(c) && c >= 0 && c <= 1;
}

export function isValidScore(s: unknown): s is number {
  return isFiniteNumber(s) && (s as number) >= 0 && (s as number) <= 1;
}

export function isValidProbability(p: unknown): p is number {
  return isFiniteNumber(p) && (p as number) >= 0 && (p as number) <= 1;
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
