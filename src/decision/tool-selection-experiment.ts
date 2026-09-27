/**
 * tool-selection-experiment.ts — T2-f: the experiment-only Jev scorer.
 *
 * This is not a runtime decision. There is no `DecisionType`, no route-table
 * entry, no policy authority and nothing in the live loop imports it. It exists
 * so an offline experiment can ask an engine about one candidate at a time,
 * under a sealed `experiment:…` subject, before anyone decides whether tool
 * selection deserves promotion.
 *
 * Contract, enforced here:
 * - input: one frozen scope plus one candidate; output: a finite Score in 0..1.
 * - refused: Choice, Noul, missing values, NaN/Infinity, out-of-range scores,
 *   engine failures, and any response shape that cannot be interpreted exactly.
 * - the projection carries SELECTION-TIME information only. `actualChoice`,
 *   execution outcome, evidence contribution and the deterministic ranking are
 *   deliberately absent: a scorer must not be contaminated by the result it is
 *   meant to be compared against (`assertNoPostSelectionFields`).
 * - ALiX owns the candidate set: enumeration, identity, complete-set
 *   validation, sorting and tie-breaking. Jev only scores.
 */

import { TOOL_SELECTION_EXPERIMENT, type ToolSelectionScope, type ToolSelectionSelector } from "./tool-selection-replay.js";
import type { DecisionExecutor } from "./executors.js";
import { executeWithTimeout } from "./executors.js";
import { sealForRemote } from "./boundary.js";
import { DEFAULT_REPLAY_TIMEOUT_MS } from "./replay/harness.js";

export const TOOL_SELECTION_PROJECTOR_VERSION = "tool-selection/v1";

export type ToolSelectionProjection = {
  experiment: typeof TOOL_SELECTION_EXPERIMENT;
  projectorVersion: string;
  /** The recorded objective, when the harness can supply it. */
  objective?: string;
  candidate: {
    tool: string;
    description?: string;
    /** Requirement reasons this tool could close, when it is a candidate. */
    reasons?: string[];
  };
  offeredTools: string[];
  requirementCandidates: Array<{ tool: string; reasons: string[] }>;
  scoping?: {
    fallbackFull: boolean;
    admitted: string[];
  };
};

/** Fields that exist only after a selection happened. */
export const POST_SELECTION_FIELDS = ["actualChoice", "actualChoices", "execution", "evidence", "deterministicRanking", "ranking"] as const;

export function assertNoPostSelectionFields(projection: Record<string, unknown>): void {
  const leaked = POST_SELECTION_FIELDS.filter(field => field in projection);
  if (leaked.length > 0) {
    throw new Error(`tool-selection projection leaks post-selection fields: ${leaked.join(", ")}`);
  }
}

/**
 * Build the projection for one candidate. Selection-time information only —
 * see `POST_SELECTION_FIELDS` for what must never appear.
 */
export function projectToolSelectionCandidate(input: {
  scope: ToolSelectionScope;
  tool: string;
  objective?: string;
  describeTool?: (tool: string) => string | undefined;
  projectorVersion?: string;
}): ToolSelectionProjection {
  const requirement = input.scope.requirementCandidates.find(candidate => candidate.tool === input.tool);
  const description = input.describeTool?.(input.tool);
  const projection: ToolSelectionProjection = {
    experiment: TOOL_SELECTION_EXPERIMENT,
    projectorVersion: input.projectorVersion ?? TOOL_SELECTION_PROJECTOR_VERSION,
    ...(input.objective ? { objective: input.objective } : {}),
    candidate: {
      tool: input.tool,
      ...(description ? { description } : {}),
      ...(requirement ? { reasons: [...requirement.reasons] } : {}),
    },
    offeredTools: [...input.scope.offered],
    requirementCandidates: input.scope.requirementCandidates.map(entry => ({ tool: entry.tool, reasons: [...entry.reasons] })),
    ...(input.scope.scoping
      ? { scoping: { fallbackFull: input.scope.scoping.fallbackFull, admitted: input.scope.scoping.admitted.map(entry => entry.tool) } }
      : {}),
  };
  assertNoPostSelectionFields(projection as unknown as Record<string, unknown>);
  return projection;
}

/** Provenance for one scored candidate: enough to defend a later comparison. */
export type ExperimentScoreRecord = {
  experimentId: typeof TOOL_SELECTION_EXPERIMENT;
  projectorVersion: string;
  scopeId: string;
  candidate: string;
  engineId: string;
  model?: string;
  score: number;
  latencyMs: number;
  projectionHash: string;
};

export type JevExperimentScorerOptions = {
  executor: DecisionExecutor;
  /** Frozen scope this scorer serves; the candidate varies per request. */
  scope: ToolSelectionScope;
  objective?: string;
  describeTool?: (tool: string) => string | undefined;
  model?: string;
  timeoutMs?: number;
  /** Pinned by default; an explicit different version is refused. */
  projectorVersion?: string;
  /** Observability sink for the per-candidate provenance. */
  onScore?: (record: ExperimentScoreRecord) => void;
};

/**
 * A `ToolSelectionSelector` that scores candidates through an engine under the
 * sealed experiment subject. Pass it to `replayToolSelection` as the alternative
 * ordering; ALiX still owns sorting, tie-breaking and set preservation.
 */
export function createJevExperimentScorer(options: JevExperimentScorerOptions): ToolSelectionSelector {
  const projectorVersion = options.projectorVersion ?? TOOL_SELECTION_PROJECTOR_VERSION;
  if (projectorVersion !== TOOL_SELECTION_PROJECTOR_VERSION) {
    // A different projector would silently produce incomparable scores.
    throw new Error(
      `unsupported tool-selection projector version: ${projectorVersion} (pinned: ${TOOL_SELECTION_PROJECTOR_VERSION})`,
    );
  }
  const subject = `experiment:${TOOL_SELECTION_EXPERIMENT}` as const;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;

  return {
    id: `${options.executor.engineId}:${TOOL_SELECTION_EXPERIMENT}`,
    remote: true,
    async score(request) {
      // The projection IS the sealed payload — otherwise the engine would see
      // an adapter-shaped request while provenance hashed a different object.
      const projection = projectToolSelectionCandidate({
        scope: options.scope,
        tool: request.tool,
        ...(options.objective ? { objective: options.objective } : {}),
        ...(options.describeTool ? { describeTool: options.describeTool } : {}),
        projectorVersion,
      });
      const sealed = sealForRemote(subject, projectorVersion, projection);
      const startedAt = Date.now();
      let outcome;
      try {
        outcome = await executeWithTimeout(
          options.executor,
          { decision: sealed.decision, sealed, candidates: [request.tool] },
          timeoutMs,
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      const latencyMs = Date.now() - startedAt;
      if (outcome.kind === "failure") return { error: outcome.error };
      if (outcome.kind !== "score") {
        return { error: `selector returned ${outcome.kind}, expected a bounded score` };
      }
      if (!Number.isFinite(outcome.score) || outcome.score < 0 || outcome.score > 1) {
        return { error: `engine returned an out-of-range score for ${request.tool}: ${outcome.score}` };
      }
      options.onScore?.({
        experimentId: TOOL_SELECTION_EXPERIMENT,
        projectorVersion,
        scopeId: request.scopeId,
        candidate: request.tool,
        engineId: options.executor.engineId,
        ...(options.model ? { model: options.model } : {}),
        score: outcome.score,
        latencyMs,
        projectionHash: sealed.hash,
      });
      return { score: outcome.score };
    },
  };
}
