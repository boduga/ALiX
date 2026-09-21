/**
 * shadow.ts — Model-tier shadow runner (J3 task 24).
 *
 * Runs the configured route over task FEATURES (never provider/model IDs),
 * journals every attempt, and compares the selected tier against the concrete
 * model the current routing policy would use. The comparison is the signal for
 * task 25 (gate active routing after evaluation).
 *
 * Grants NO execution authority.
 */

import type { DecisionJournalRecord } from "../../journal.js";
import type { DecisionJournalStore } from "../../journal.js";
import type { AlixConfig } from "../../../config/schema.js";
import type { EngineRegistry } from "../../registry.js";
import { buildPlan, executeWithFallback } from "../../fallback.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import { DEFAULT_DECISION_CONFIG } from "../../config.js";
import { observedEngineId } from "../shared/attempts.js";
import { journalAttempts, type JournalContext } from "../shared/journaling.js";
import { projectModelTier, type ModelTierRequestFeatures } from "./projection.js";
import { isRoutableTier, listEnabledTiers, type RoutableTier } from "./tiers.js";
import {
  describeCurrentRouting,
  tierMatchesCurrentRouting,
  type CurrentRouting,
} from "./resolution.js";

export type ModelTierShadowDeps = {
  config: AlixConfig;
  registry: EngineRegistry;
  journal?: DecisionJournalStore;
  timeoutMs?: number;
  executionId?: string;
};

export type ModelTierObservation = {
  engineId: string;
  tier?: RoutableTier;
  confidence?: number;
};

export type ModelTierShadowResult = {
  decision: "model-tier";
  enabled: boolean;
  enabledTiers: RoutableTier[];
  observed?: ModelTierObservation;
  /** What the existing routing policy would use today. */
  current: CurrentRouting;
  /** True when the selected tier resolves to the current routing model. */
  agree?: boolean;
  records: DecisionJournalRecord[];
  /** Explicit: a shadow decision authorizes nothing. */
  authority: "none";
};

function contextFor(
  engineId: string,
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: ModelTierShadowDeps,
): JournalContext {
  const decisionConfig = deps.config.decision ?? DEFAULT_DECISION_CONFIG;
  return {
    decision: "model-tier",
    engineId,
    sealed,
    remote: deps.registry.get(engineId)?.remote === true,
    thresholdProfile: decisionConfig.modelTier.thresholdProfile,
    candidates: listEnabledTiers(deps.config),
    ...(deps.executionId !== undefined ? { executionId: deps.executionId } : {}),
  };
}

/**
 * Project, execute, compare, journal. Never authorizes an action.
 * Disabled route returns no observation and no records.
 */
export async function runModelTierShadow(
  features: ModelTierRequestFeatures,
  deps: ModelTierShadowDeps,
): Promise<ModelTierShadowResult> {
  const decisionConfig = deps.config.decision ?? DEFAULT_DECISION_CONFIG;
  const enabledTiers = listEnabledTiers(deps.config);
  const current = describeCurrentRouting(deps.config);

  if (decisionConfig.modelTier.enabled !== true) {
    return {
      decision: "model-tier",
      enabled: false,
      enabledTiers,
      current,
      records: [],
      authority: "none",
    };
  }

  const sealed = projectModelTier(features);
  const plan = buildPlan("model-tier", decisionConfig, deps.registry);
  const result = await executeWithFallback(
    plan,
    { decision: "model-tier", sealed, candidates: enabledTiers },
    { timeoutMs: deps.timeoutMs },
  );

  const records = journalAttempts(
    result.attempts,
    result.outcome,
    (engineId) => contextFor(engineId, sealed, deps),
    plan.primaryId,
  );
  for (const record of records) deps.journal?.append(record);

  const tier =
    result.outcome.kind === "choice" && isRoutableTier(result.outcome.choice)
      ? result.outcome.choice
      : undefined;
  const confidence = result.outcome.kind === "choice" ? result.outcome.confidence : undefined;
  const agree = tier !== undefined ? tierMatchesCurrentRouting(deps.config, tier) : undefined;

  return {
    decision: "model-tier",
    enabled: true,
    enabledTiers,
    observed: {
      engineId: observedEngineId(result.attempts, plan.primaryId),
      ...(tier !== undefined ? { tier } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    current,
    ...(agree !== undefined ? { agree } : {}),
    records,
    authority: "none",
  };
}
