/**
 * journaling.ts — Shared journal-record construction for decision shadow runs.
 *
 * One shape for "how an attempt becomes a journal record" so decisions cannot
 * drift in provenance, remote/redaction flags, or failure metadata (§9).
 */

import type { DecisionType } from "../../contracts.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type { ExecutorOutcome } from "../../executors.js";
import type { AttemptRecord } from "../../fallback.js";
import {
  recordDecision,
  type DecisionJournalRecord,
  type DecisionOutcome,
} from "../../journal.js";

/** Everything a journal record needs beyond the outcome itself. */
export type JournalContext = {
  decision: DecisionType;
  engineId: string;
  sealed: RemoteSealedProjection<Record<string, unknown>>;
  /** True when the engine crossed a remote trust boundary. */
  remote: boolean;
  executionId?: string;
  /** Profile the consumer applied for this engine. */
  thresholdProfile?: string;
  /** Candidate set for choice outcomes. */
  candidates?: readonly unknown[];
};

/** Single outcome-kind mapping shared by every decision. */
export function toDecisionOutcome(
  outcome: ExecutorOutcome,
  candidates?: readonly unknown[],
): DecisionOutcome {
  switch (outcome.kind) {
    case "choice":
      return {
        kind: "choice",
        choice: outcome.choice,
        ...(candidates !== undefined ? { candidates } : {}),
        ...(outcome.confidence !== undefined ? { confidence: outcome.confidence } : {}),
      };
    case "score":
      return {
        kind: "score",
        score: outcome.score,
        ...(outcome.confidence !== undefined ? { confidence: outcome.confidence } : {}),
      };
    case "noul":
      return { kind: "noul", probability: outcome.probability };
    case "failure":
      return { kind: "failure", error: outcome.error };
  }
}

function baseFields(ctx: JournalContext) {
  return {
    decision: ctx.decision,
    engineId: ctx.engineId,
    projectionHash: ctx.sealed.hash,
    projectorVersion: ctx.sealed.projectorVersion,
    ...(ctx.thresholdProfile !== undefined ? { thresholdProfile: ctx.thresholdProfile } : {}),
    remote: ctx.remote,
    redactionApplied: ctx.remote,
    ...(ctx.executionId !== undefined ? { executionId: ctx.executionId } : {}),
  };
}

export function journalizeOutcome(
  ctx: JournalContext,
  outcome: ExecutorOutcome,
  latencyMs: number,
): DecisionJournalRecord {
  const engineVersion =
    outcome.kind !== "failure" ? outcome.provenance.engineVersion : undefined;
  return recordDecision({
    ...baseFields(ctx),
    ...(engineVersion !== undefined ? { engineVersion } : {}),
    outcome: toDecisionOutcome(outcome, ctx.candidates),
    latencyMs,
  });
}

export function journalizeFailure(
  ctx: JournalContext,
  error: string,
  latencyMs: number,
): DecisionJournalRecord {
  return recordDecision({
    ...baseFields(ctx),
    outcome: { kind: "failure", error },
    latencyMs,
  });
}

/**
 * One record per attempt: successes carry the native outcome, failures carry
 * an explicit failure with their own latency (§9 error/fallback metadata).
 * `contextFor` is called per engine so each record is engine-specific.
 */
export function journalAttempts(
  attempts: readonly AttemptRecord[],
  outcome: ExecutorOutcome,
  contextFor: (engineId: string) => JournalContext,
  emptyEngineId: string,
): DecisionJournalRecord[] {
  if (attempts.length === 0) {
    return [journalizeOutcome(contextFor(emptyEngineId), outcome, 0)];
  }
  return attempts.map((attempt) =>
    attempt.ok
      ? journalizeOutcome(contextFor(attempt.engineId), outcome, attempt.latencyMs)
      : journalizeFailure(
          contextFor(attempt.engineId),
          attempt.error ?? "unknown failure",
          attempt.latencyMs,
        ),
  );
}
