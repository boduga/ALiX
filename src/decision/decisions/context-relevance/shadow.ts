/**
 * shadow.ts — Context relevance shadow runner (J2).
 *
 * Evaluates ONE item per call (never a dump), journals every attempt under
 * that item's projectionHash, then ranks/filters deterministically in code.
 * Unscored items (engine failure) are kept rather than dropped: the feature
 * may reduce context, never silently remove context it could not judge.
 *
 * Grants NO execution authority. When the route is disabled the original
 * items pass through unchanged (existing behavior restored).
 */

import type { DecisionJournalRecord } from "../../journal.js";
import type { DecisionJournalStore } from "../../journal.js";
import type { DecisionConfig } from "../../config.js";
import type { EngineRegistry } from "../../registry.js";
import { buildPlan, executeWithFallback } from "../../fallback.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import { observedEngineId } from "../shared/attempts.js";
import { journalAttempts, type JournalContext } from "../shared/journaling.js";
import { projectContextRelevance, type ContextRelevanceItemInput } from "./projection.js";
import { selectWithEngineThresholds, type SelectionResult } from "./selection.js";
import {
  resolveProfileForEngine,
  tryThresholdProfileForEngine,
} from "./thresholds.js";

export type ContextRelevanceShadowDeps = {
  config: DecisionConfig;
  registry: EngineRegistry;
  journal?: DecisionJournalStore;
  timeoutMs?: number;
  /** Cap on selected items after ranking. */
  maxItems?: number;
  executionId?: string;
};

export type ContextRelevanceItemObservation = {
  itemId: string;
  engineId: string;
  /** Absent when every attempt failed for this item. */
  probability?: number;
};

export type ContextRelevanceShadowResult = {
  decision: "context-relevance";
  enabled: boolean;
  /** itemId -> sealed projection hash (replay key). */
  projectionHashes: Record<string, string>;
  observations: ContextRelevanceItemObservation[];
  /** Items kept because no engine produced a score. */
  unscoredIds: string[];
  selection: SelectionResult;
  records: DecisionJournalRecord[];
  /** Explicit: a shadow decision authorizes nothing. */
  authority: "none";
};

/** Journal context for one engine: profile and remote flag are engine-specific. */
function contextFor(
  engineId: string,
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  deps: ContextRelevanceShadowDeps,
): JournalContext {
  const profile = tryThresholdProfileForEngine(engineId);
  return {
    decision: "context-relevance",
    engineId,
    sealed,
    remote: deps.registry.get(engineId)?.remote === true,
    ...(profile !== undefined ? { thresholdProfile: profile.id } : {}),
    ...(deps.executionId !== undefined ? { executionId: deps.executionId } : {}),
  };
}

async function scoreItem(
  item: ContextRelevanceItemInput,
  objective: string,
  deps: ContextRelevanceShadowDeps,
  records: DecisionJournalRecord[],
): Promise<{ sealed: RemoteSealedProjection<Record<string, unknown>>; observation: ContextRelevanceItemObservation }> {
  const sealed = projectContextRelevance({ objective, item });
  const plan = buildPlan("context-relevance", deps.config, deps.registry);
  const result = await executeWithFallback(
    plan,
    { decision: "context-relevance", sealed },
    { timeoutMs: deps.timeoutMs },
  );

  const engineId = observedEngineId(result.attempts, plan.primaryId);
  records.push(
    ...journalAttempts(
      result.attempts,
      result.outcome,
      (attemptEngineId) => contextFor(attemptEngineId, sealed, deps),
      plan.primaryId,
    ),
  );

  const probability = result.outcome.kind === "noul" ? result.outcome.probability : undefined;
  return {
    sealed,
    observation: {
      itemId: item.id,
      engineId,
      ...(probability !== undefined ? { probability } : {}),
    },
  };
}

/**
 * Score every item independently, then select. Never authorizes an action.
 * Projection failure for one item throws before any engine runs for it.
 */
export async function runContextRelevanceShadow(
  input: { objective: string; items: readonly ContextRelevanceItemInput[] },
  deps: ContextRelevanceShadowDeps,
): Promise<ContextRelevanceShadowResult> {
  const orderedIds = input.items.map((item) => item.id);

  if (deps.config.contextRelevance.enabled !== true) {
    return {
      decision: "context-relevance",
      enabled: false,
      projectionHashes: {},
      observations: [],
      unscoredIds: [],
      selection: {
        selectedIds: orderedIds,
        rejectedIds: [],
        thresholdProfileIds: [],
        thresholds: {},
      },
      records: [],
      authority: "none",
    };
  }

  const records: DecisionJournalRecord[] = [];
  const projectionHashes: Record<string, string> = {};
  const observations: ContextRelevanceItemObservation[] = [];

  for (const item of input.items) {
    const { sealed, observation } = await scoreItem(item, input.objective, deps, records);
    projectionHashes[item.id] = sealed.hash;
    observations.push(observation);
  }

  const scored = observations.filter(
    (entry): entry is ContextRelevanceItemObservation & { probability: number } =>
      entry.probability !== undefined,
  );
  const selection = selectWithEngineThresholds(
    scored.map((entry) => ({
      id: entry.itemId,
      probability: entry.probability,
      engineId: entry.engineId,
    })),
    {
      resolveProfile: (engineId) =>
        resolveProfileForEngine(engineId, deps.config.contextRelevance.thresholdProfile),
      maxItems: deps.maxItems,
    },
  );

  const unscoredIds = observations
    .filter((entry) => entry.probability === undefined)
    .map((entry) => entry.itemId);
  const kept = new Set([...selection.selectedIds, ...unscoredIds]);
  const merged: SelectionResult = {
    ...selection,
    selectedIds: orderedIds.filter((id) => kept.has(id)),
    rejectedIds: orderedIds.filter((id) => !kept.has(id)),
  };

  for (const record of records) deps.journal?.append(record);

  return {
    decision: "context-relevance",
    enabled: true,
    projectionHashes,
    observations,
    unscoredIds,
    selection: merged,
    records,
    authority: "none",
  };
}
