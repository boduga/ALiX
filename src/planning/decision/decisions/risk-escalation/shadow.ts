/**
 * shadow.ts — Risk-escalation shadow runner (J6).
 *
 * Runs the configured route and, when it differs, the deterministic local
 * baseline over the SAME sealed projection, journaling each engine's outcome
 * under one projectionHash. It also reports the composed approval
 * recommendation — `composeApproval(policyRequires, tier above low)` — as an
 * OBSERVATION, never an enforcement. PolicyGate remains the only authority
 * that can require an approval.
 *
 * Grants NO execution authority.
 */

import type { DecisionJournalRecord } from "../../journal.js";
import type { DecisionJournalStore } from "../../journal.js";
import type { DecisionConfig } from "../../config.js";
import type { EngineRegistry } from "../../registry.js";
import { buildPlan, executeWithFallback } from "../../fallback.js";
import { composeApproval } from "../../approval.js";
import { LOCAL_ENGINE_ID } from "../../engines/local.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import { observedEngineId, totalLatency } from "../shared/attempts.js";
import { journalAttempts, journalizeOutcome, type JournalContext } from "../shared/journaling.js";
import {
  RISK_TIER_CANDIDATES,
  isRiskTier,
  type RiskTier,
} from "./schema.js";
import {
  projectRiskEscalation,
  type RiskEscalationActionInput,
} from "./projection.js";

export type RiskObservation = {
  engineId: string;
  outcome: import("../../executors.js").ExecutorOutcome;
  tier?: RiskTier;
  latencyMs: number;
};

export type RiskEscalationShadowResult = {
  decision: "risk-escalation";
  enabled: boolean;
  projectionHash: string;
  observed?: RiskObservation;
  baseline?: RiskObservation;
  /** Baseline/observed tier agreement, when both produced a tier. */
  agree?: boolean;
  /**
   * Whether the deterministic policy PLUS this observation would require
   * approval. Advisory only — the runtime asks PolicyGate, not this value.
   * Absent when the route is disabled.
   */
  recommendApproval?: boolean;
  records: DecisionJournalRecord[];
  /** Explicit: a shadow decision authorizes nothing. */
  authority: "none";
};

export type RiskEscalationShadowDeps = {
  config: DecisionConfig;
  registry: EngineRegistry;
  journal?: DecisionJournalStore;
  timeoutMs?: number;
  /** Risk context at decision time. */
  risk?: import("../../contracts.js").RiskContext;
  /** Default true; skipped automatically when the observed engine is local. */
  compareBaseline?: boolean;
};

function tierOf(outcome: RiskObservation["outcome"]): RiskTier | undefined {
  return outcome.kind === "choice" && isRiskTier(outcome.choice) ? outcome.choice : undefined;
}

/** Conditional spread so a missing tier does not add an `undefined` key. */
function withTier(outcome: RiskObservation["outcome"]): { tier?: RiskTier } {
  const tier = tierOf(outcome);
  return tier !== undefined ? { tier } : {};
}

/** Journal context for one engine; `remote` comes from the registry meta. */
function contextFor(
  engineId: string,
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: RiskEscalationShadowDeps,
): JournalContext {
  return {
    decision: "risk-escalation",
    engineId,
    sealed,
    remote: deps.registry.get(engineId)?.remote === true,
    thresholdProfile: deps.config.riskEscalation.thresholdProfile,
    candidates: RISK_TIER_CANDIDATES,
    ...(deps.risk !== undefined ? { risk: deps.risk } : {}),
  };
}

type ConfiguredRun = {
  observation: RiskObservation;
  attempts: import("../../fallback.js").AttemptRecord[];
  primaryId: string;
};

async function runConfigured(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: RiskEscalationShadowDeps,
): Promise<ConfiguredRun> {
  const plan = buildPlan("risk-escalation", deps.config, deps.registry);
  const result = await executeWithFallback(
    plan,
    { decision: "risk-escalation", sealed, candidates: RISK_TIER_CANDIDATES },
    { timeoutMs: deps.timeoutMs },
  );
  return {
    observation: {
      engineId: observedEngineId(result.attempts, plan.primaryId),
      outcome: result.outcome,
      ...withTier(result.outcome),
      latencyMs: totalLatency(result.attempts),
    },
    attempts: result.attempts,
    primaryId: plan.primaryId,
  };
}

async function runLocalBaseline(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: RiskEscalationShadowDeps,
): Promise<RiskObservation | undefined> {
  const executor = deps.registry.get(LOCAL_ENGINE_ID)?.executor;
  if (!executor) return undefined;
  const started = Date.now();
  const outcome = await executor.execute({
    decision: "risk-escalation",
    sealed,
    candidates: RISK_TIER_CANDIDATES,
  });
  return {
    engineId: LOCAL_ENGINE_ID,
    outcome,
    ...withTier(outcome),
    latencyMs: Date.now() - started,
  };
}

export type RiskEscalationShadowInput = {
  action: RiskEscalationActionInput;
  /** What deterministic policy already requires. Absent = unknown. */
  policyRequires?: boolean;
};

/**
 * Project, execute, compare, journal. Never authorizes an action.
 * Projection failure throws before any engine runs (no remote call).
 */
export async function runRiskEscalationShadow(
  input: RiskEscalationShadowInput,
  deps: RiskEscalationShadowDeps,
): Promise<RiskEscalationShadowResult> {
  if (deps.config.riskEscalation.enabled !== true) {
    return {
      decision: "risk-escalation",
      enabled: false,
      projectionHash: "",
      records: [],
      authority: "none",
    };
  }

  const sealed = projectRiskEscalation(input.action);
  const { observation: observed, attempts, primaryId } = await runConfigured(sealed, deps);
  const records: DecisionJournalRecord[] = journalAttempts(
    attempts,
    observed.outcome,
    (engineId) => contextFor(engineId, sealed, deps),
    primaryId,
  );

  let baseline: RiskObservation | undefined;
  if (deps.compareBaseline !== false && observed.engineId !== LOCAL_ENGINE_ID) {
    baseline = await runLocalBaseline(sealed, deps);
    if (baseline) {
      records.push(
        journalizeOutcome(
          contextFor(baseline.engineId, sealed, deps),
          baseline.outcome,
          baseline.latencyMs,
        ),
      );
    }
  }

  const agree =
    baseline?.tier !== undefined && observed.tier !== undefined
      ? baseline.tier === observed.tier
      : undefined;

  // Fail closed: an unknown tier counts as exceeding the low-risk bar.
  const riskExceeds = observed.tier === undefined ? true : observed.tier !== "low";
  const recommendApproval = composeApproval(input.policyRequires ?? false, riskExceeds);

  for (const record of records) deps.journal?.append(record);

  return {
    decision: "risk-escalation",
    enabled: true,
    projectionHash: sealed.hash,
    observed,
    ...(baseline !== undefined ? { baseline } : {}),
    ...(agree !== undefined ? { agree } : {}),
    recommendApproval,
    records,
    authority: "none",
  };
}
