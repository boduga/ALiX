/**
 * shadow.ts — Claim verification shadow runner (J1).
 *
 * Runs the configured route and, when it differs, the deterministic local
 * baseline over the SAME sealed projection, journaling each engine's outcome
 * under one projectionHash. That is the baseline-vs-Jev comparison the J1
 * exit criteria ask for, and the calibration input J4 will read.
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
import { CLAIM_VERDICTS, isClaimVerdict, type ClaimVerdict } from "./schema.js";
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
};

function verdictOf(outcome: ExecutorOutcome): ClaimVerdict | undefined {
  return outcome.kind === "choice" && isClaimVerdict(outcome.choice) ? outcome.choice : undefined;
}

function observedEngineId(attempts: readonly AttemptRecord[], fallbackId: string): string {
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    if (attempts[index]?.ok) return attempts[index]!.engineId;
  }
  return fallbackId;
}

function totalLatency(attempts: readonly AttemptRecord[]): number {
  return attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
}

function toDecisionOutcome(outcome: ExecutorOutcome) {
  switch (outcome.kind) {
    case "choice":
      return {
        kind: "choice" as const,
        choice: outcome.choice,
        candidates: [...CLAIM_VERDICTS] as unknown[],
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

function journalize(
  observation: ShadowObservation,
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  config: DecisionConfig,
): DecisionJournalRecord {
  const remote = observation.engineId === JEV_ENGINE_ID;
  const engineVersion =
    observation.outcome.kind !== "failure" ? observation.outcome.provenance.engineVersion : undefined;
  return recordDecision({
    decision: "claim-verification",
    engineId: observation.engineId,
    ...(engineVersion !== undefined ? { engineVersion } : {}),
    projectionHash: sealed.hash,
    projectorVersion: sealed.projectorVersion,
    outcome: toDecisionOutcome(observation.outcome),
    thresholdProfile: config.claimVerification.thresholdProfile,
    latencyMs: observation.latencyMs,
    remote,
    redactionApplied: remote,
  });
}

async function runConfigured(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: ClaimVerificationShadowDeps,
): Promise<ShadowObservation> {
  const plan = buildPlan("claim-verification", deps.config, deps.registry);
  const result = await executeWithFallback(
    plan,
    { decision: "claim-verification", sealed, candidates: [...CLAIM_VERDICTS] },
    { timeoutMs: deps.timeoutMs },
  );
  const engineId = observedEngineId(result.attempts, plan.primaryId);
  return {
    engineId,
    outcome: result.outcome,
    ...(verdictOf(result.outcome) !== undefined ? { verdict: verdictOf(result.outcome)! } : {}),
    latencyMs: totalLatency(result.attempts),
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
    candidates: [...CLAIM_VERDICTS],
  });
  return {
    engineId: LOCAL_ENGINE_ID,
    outcome,
    ...(verdictOf(outcome) !== undefined ? { verdict: verdictOf(outcome)! } : {}),
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
  const observed = await runConfigured(sealed, deps);
  const records: DecisionJournalRecord[] = [journalize(observed, sealed, deps.config)];

  let baseline: ShadowObservation | undefined;
  if (deps.compareBaseline !== false && observed.engineId !== LOCAL_ENGINE_ID) {
    baseline = await runLocalBaseline(sealed, deps);
    if (baseline) records.push(journalize(baseline, sealed, deps.config));
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
