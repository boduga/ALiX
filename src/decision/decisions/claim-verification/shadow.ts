/**
 * shadow.ts — Claim verification shadow runner (J1).
 *
 * Runs the configured route and, when it differs, the deterministic local
 * baseline over the SAME sealed projection, journaling each engine's outcome
 * under one projectionHash. Every attempt is journaled — including a failed
 * remote attempt that fell back — so the ledger carries the failure/fallback
 * metadata §9 requires and J4 needs for calibration.
 *
 * Grants NO execution authority: the return value is observation data only
 * (hand-off §13.1 — the consumer decides what verification action follows).
 */

import type { DecisionJournalRecord } from "../../journal.js";
import { recordDecision, type DecisionJournalStore } from "../../journal.js";
import type { DecisionConfig } from "../../config.js";
import type { EngineRegistry } from "../../registry.js";
import { buildPlan, executeWithFallback, type AttemptRecord } from "../../fallback.js";
import type { ExecutorOutcome } from "../../executors.js";
import { LOCAL_ENGINE_ID } from "../../engines/local.js";
import { JEV_ENGINE_ID } from "../../engines/jev.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import { observedEngineId, totalLatency } from "../shared/attempts.js";
import { CLAIM_VERDICT_CANDIDATES, isClaimVerdict, type ClaimVerdict } from "./schema.js";
import {
  projectClaimVerification,
  type ClaimVerificationInput,
} from "./projection.js";

export type ShadowObservation = {
  engineId: string;
  outcome: ExecutorOutcome;
  verdict?: ClaimVerdict;
  latencyMs: number;
};

export type ClaimVerificationShadowResult = {
  decision: "claim-verification";
  projectionHash: string;
  observed: ShadowObservation;
  baseline?: ShadowObservation;
  /** Baseline/observed verdict agreement, when both produced a verdict. */
  agree?: boolean;
  records: DecisionJournalRecord[];
  /** Explicit: a shadow decision authorizes nothing. */
  authority: "none";
};

export type ClaimVerificationShadowDeps = {
  config: DecisionConfig;
  registry: EngineRegistry;
  journal?: DecisionJournalStore;
  timeoutMs?: number;
  /** Default true; skipped automatically when the observed engine is local. */
  compareBaseline?: boolean;
  /** Correlation id from the surrounding execution, when available (§9). */
  executionId?: string;
};

function verdictOf(outcome: ExecutorOutcome): ClaimVerdict | undefined {
  return outcome.kind === "choice" && isClaimVerdict(outcome.choice) ? outcome.choice : undefined;
}

/** Conditional spread so a missing verdict does not add an `undefined` key. */
function withVerdict(outcome: ExecutorOutcome): { verdict?: ClaimVerdict } {
  const verdict = verdictOf(outcome);
  return verdict !== undefined ? { verdict } : {};
}

function toDecisionOutcome(outcome: ExecutorOutcome) {
  switch (outcome.kind) {
    case "choice":
      return {
        kind: "choice" as const,
        choice: outcome.choice,
        candidates: CLAIM_VERDICT_CANDIDATES,
        ...(outcome.confidence !== undefined ? { confidence: outcome.confidence } : {}),
      };
    case "score":
      return {
        kind: "score" as const,
        score: outcome.score,
        ...(outcome.confidence !== undefined ? { confidence: outcome.confidence } : {}),
      };
    case "noul":
      return { kind: "noul" as const, probability: outcome.probability };
    case "failure":
      return { kind: "failure" as const, error: outcome.error };
  }
}

function baseRecordFields(
  engineId: string,
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  config: DecisionConfig,
  executionId: string | undefined,
) {
  const remote = engineId === JEV_ENGINE_ID;
  return {
    decision: "claim-verification" as const,
    engineId,
    projectionHash: sealed.hash,
    projectorVersion: sealed.projectorVersion,
    thresholdProfile: config.claimVerification.thresholdProfile,
    remote,
    redactionApplied: remote,
    ...(executionId !== undefined ? { executionId } : {}),
  };
}

function journalize(
  observation: ShadowObservation,
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  config: DecisionConfig,
  executionId: string | undefined,
): DecisionJournalRecord {
  const engineVersion =
    observation.outcome.kind !== "failure" ? observation.outcome.provenance.engineVersion : undefined;
  return recordDecision({
    ...baseRecordFields(observation.engineId, sealed, config, executionId),
    ...(engineVersion !== undefined ? { engineVersion } : {}),
    outcome: toDecisionOutcome(observation.outcome),
    latencyMs: observation.latencyMs,
  });
}

/** A failed attempt is journaled as an explicit failure with its latency. */
function journalizeFailure(
  attempt: AttemptRecord,
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  config: DecisionConfig,
  executionId: string | undefined,
): DecisionJournalRecord {
  return recordDecision({
    ...baseRecordFields(attempt.engineId, sealed, config, executionId),
    outcome: { kind: "failure", error: attempt.error ?? "unknown failure" },
    latencyMs: attempt.latencyMs,
  });
}

type ConfiguredRun = {
  observation: ShadowObservation;
  attempts: AttemptRecord[];
};

async function runConfigured(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: ClaimVerificationShadowDeps,
): Promise<ConfiguredRun> {
  const plan = buildPlan("claim-verification", deps.config, deps.registry);
  const result = await executeWithFallback(
    plan,
    { decision: "claim-verification", sealed, candidates: CLAIM_VERDICT_CANDIDATES },
    { timeoutMs: deps.timeoutMs },
  );
  return {
    observation: {
      engineId: observedEngineId(result.attempts, plan.primaryId),
      outcome: result.outcome,
      ...withVerdict(result.outcome),
      latencyMs: totalLatency(result.attempts),
    },
    attempts: result.attempts,
  };
}

async function runLocalBaseline(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: ClaimVerificationShadowDeps,
): Promise<ShadowObservation | undefined> {
  const executor = deps.registry.get(LOCAL_ENGINE_ID)?.executor;
  if (!executor) return undefined;
  const started = Date.now();
  const outcome = await executor.execute({
    decision: "claim-verification",
    sealed,
    candidates: CLAIM_VERDICT_CANDIDATES,
  });
  return {
    engineId: LOCAL_ENGINE_ID,
    outcome,
    ...withVerdict(outcome),
    latencyMs: Date.now() - started,
  };
}

/**
 * Project, execute, compare, journal. Never authorizes an action.
 * Projection failure throws before any engine runs (no remote call).
 */
export async function runClaimVerificationShadow(
  input: ClaimVerificationInput,
  deps: ClaimVerificationShadowDeps,
): Promise<ClaimVerificationShadowResult> {
  const sealed = projectClaimVerification(input);
  const { observation: observed, attempts } = await runConfigured(sealed, deps);

  const records: DecisionJournalRecord[] = attempts.map((attempt) =>
    attempt.ok
      ? journalize(observed, sealed, deps.config, deps.executionId)
      : journalizeFailure(attempt, sealed, deps.config, deps.executionId),
  );
  if (records.length === 0) {
    records.push(journalize(observed, sealed, deps.config, deps.executionId));
  }

  let baseline: ShadowObservation | undefined;
  if (deps.compareBaseline !== false && observed.engineId !== LOCAL_ENGINE_ID) {
    baseline = await runLocalBaseline(sealed, deps);
    if (baseline) records.push(journalize(baseline, sealed, deps.config, deps.executionId));
  }

  const agree =
    baseline?.verdict !== undefined && observed.verdict !== undefined
      ? baseline.verdict === observed.verdict
      : undefined;

  for (const record of records) deps.journal?.append(record);

  return {
    decision: "claim-verification",
    projectionHash: sealed.hash,
    observed,
    ...(baseline !== undefined ? { baseline } : {}),
    ...(agree !== undefined ? { agree } : {}),
    records,
    authority: "none",
  };
}
