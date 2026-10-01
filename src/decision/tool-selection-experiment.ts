/**
 * tool-selection-experiment.ts — T2-f/T2-f1: the experiment-only Jev scorer.
 *
 * This is not a runtime decision. There is no `DecisionType`, no route-table
 * entry, no policy authority and nothing in the live loop imports it. It exists
 * so an offline experiment can ask an engine about one candidate at a time,
 * under a sealed `experiment:…` subject, before anyone decides whether tool
 * selection deserves promotion.
 *
 * Contract, enforced here:
 * - input: one frozen scope plus ONE candidate id; output: a finite ranking
 *   value in 0..1, derived from the engine's native answer.
 * - the engine answers with a Noul probability ("would executing this tool now
 *   be an appropriate next step?"), recorded as `outcomeKind: "noul"` +
 *   `probability` + `rankValue`. It is NOT a Jev Score: the ordinal Score
 *   primitive stays unmodelled until evidence says ranking needs it.
 * - refused: Choice, failure, missing/NaN/Infinity/out-of-range probabilities,
 *   a candidate outside the frozen surface, and any response shape that cannot
 *   be interpreted exactly.
 * - the projection carries SELECTION-TIME information only, and candidate
 *   IDENTITIES only: `actualChoice`, execution outcome, evidence contribution,
 *   the deterministic ranking and any opaque `mcp__<handle>` are absent
 *   (`assertNoPostSelectionFields`).
 * - ALiX owns the candidate set: enumeration, identity, complete-set
 *   validation, sorting and tie-breaking. Jev only ranks candidate ids.
 */

import { TOOL_SELECTION_EXPERIMENT, candidateFor, type ToolSelectionScope, type ToolSelectionSelector } from "./tool-selection-replay.js";
import { MCP_TOOL_PREFIX, type FrozenToolCandidate } from "./tool-selection-candidates.js";
import {
  MalformedResultError,
  executeWithTimeout,
  type DecisionExecutor,
  type ExecutorOutcome,
} from "./executors.js";
import { sealForRemote } from "./boundary.js";
import { DEFAULT_REPLAY_TIMEOUT_MS } from "./replay/harness.js";

export const TOOL_SELECTION_PROJECTOR_VERSION = "tool-selection/v1";

export type ToolSelectionProjection = {
  experiment: typeof TOOL_SELECTION_EXPERIMENT;
  projectorVersion: string;
  /** The recorded objective, when the harness can supply it. */
  objective?: string;
  candidate: {
    candidateId: string;
    label: string;
    description?: string;
    /** Requirement reasons this candidate could close, when it is one. */
    reasons?: string[];
  };
  /** The frozen surface, as identities + labels. Never an executable handle. */
  offered: Array<{ candidateId: string; label: string }>;
  requirementCandidates: Array<{ candidateId: string; reasons: string[] }>;
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
 * see `POST_SELECTION_FIELDS` for what must never appear — and candidate
 * identities only, so an opaque MCP handle can never reach the remote boundary.
 */
export function projectToolSelectionCandidate(input: {
  scope: ToolSelectionScope;
  candidateId: string;
  objective?: string;
  projectorVersion?: string;
}): ToolSelectionProjection {
  const candidate = candidateFor(input.scope, input.candidateId);
  if (!candidate) {
    throw new MalformedResultError(
      `candidate ${input.candidateId} is not on the frozen surface of ${input.scope.scopeId}`,
    );
  }
  assertNoRawHandlesOnSurface(input.scope);
  const requirement = input.scope.requirementCandidates.find(
    entry => entry.candidateId === input.candidateId,
  );
  const projection: ToolSelectionProjection = {
    experiment: TOOL_SELECTION_EXPERIMENT,
    projectorVersion: input.projectorVersion ?? TOOL_SELECTION_PROJECTOR_VERSION,
    ...(input.objective ? { objective: input.objective } : {}),
    candidate: {
      candidateId: candidate.candidateId,
      label: candidate.label,
      ...(candidate.description ? { description: candidate.description } : {}),
      ...(requirement ? { reasons: [...requirement.reasons] } : {}),
    },
    offered: input.scope.offered.map(candidateId => ({
      candidateId,
      label: candidateFor(input.scope, candidateId)?.label ?? candidateId,
    })),
    requirementCandidates: input.scope.requirementCandidates.map(entry => ({
      candidateId: entry.candidateId,
      reasons: [...entry.reasons],
    })),
    ...(input.scope.scoping
      ? {
          scoping: {
            fallbackFull: input.scope.scoping.fallbackFull,
            // The frozen surface only. A recorded admission outside `offered`
            // is not part of this choice problem, and the remote boundary's
            // secret gate rejects handle-shaped strings.
            admitted: input.scope.scoping.admitted
              .filter(entry => input.scope.offered.includes(entry.candidateId))
              .map(entry => entry.candidateId),
          },
        }
      : {}),
  };
  assertNoPostSelectionFields(projection as unknown as Record<string, unknown>);
  return projection;
}

/**
 * A frozen surface must be describable without its handles. A scope that still
 * offers a raw `mcp__<handle>` was never frozen properly, so the projection
 * fails closed here rather than shipping the handle to the remote boundary.
 * Validated once, before any field is built.
 */
export function assertNoRawHandlesOnSurface(scope: ToolSelectionScope): void {
  const raw = scope.offered.find(candidateId => candidateId.startsWith(MCP_TOOL_PREFIX));
  if (raw !== undefined) {
    throw new MalformedResultError(
      `frozen surface of ${scope.scopeId} offers an unresolved MCP handle (${raw}) — freeze candidates first`,
    );
  }
}

/** Provenance for one ranked candidate: enough to defend a later comparison. */
export type ExperimentRankingRecord = {
  experimentId: typeof TOOL_SELECTION_EXPERIMENT;
  projectorVersion: string;
  scopeId: string;
  candidateId: string;
  label?: string;
  engineId: string;
  model?: string;
  /** The native outcome the engine returned — a Noul probability here. */
  outcomeKind: "noul";
  probability: number;
  /** The value ALiX sorted on. Equal to `probability` today. */
  rankValue: number;
  latencyMs: number;
  projectionHash: string;
};

export type JevExperimentScorerOptions = {
  executor: DecisionExecutor;
  /** Frozen scope this scorer serves; the candidate varies per request. */
  scope: ToolSelectionScope;
  objective?: string;
  model?: string;
  timeoutMs?: number;
  /** Pinned by default; an explicit different version is refused. */
  projectorVersion?: string;
  /** Observability sink for the per-candidate provenance. */
  onRanking?: (record: ExperimentRankingRecord) => void;
};

/**
 * A `ToolSelectionSelector` that ranks candidates through an engine under the
 * sealed experiment subject. Pass it to `replayToolSelection` as the
 * alternative ordering; ALiX still owns sorting, tie-breaking and set
 * preservation.
 */
export function createJevExperimentScorer(options: JevExperimentScorerOptions): ToolSelectionSelector {
  const projectorVersion = options.projectorVersion ?? TOOL_SELECTION_PROJECTOR_VERSION;
  if (projectorVersion !== TOOL_SELECTION_PROJECTOR_VERSION) {
    // A different projector would silently produce incomparable results.
    throw new Error(
      `unsupported tool-selection projector version: ${projectorVersion} (pinned: ${TOOL_SELECTION_PROJECTOR_VERSION})`,
    );
  }
  const subject = `experiment:${TOOL_SELECTION_EXPERIMENT}` as const;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;

  return {
    id: `${options.executor.engineId}:${TOOL_SELECTION_EXPERIMENT}`,
    remote: true,
    async rank(request) {
      // The projection IS the sealed payload — otherwise the engine would see
      // an adapter-shaped request while provenance hashed a different object.
      const projection = projectToolSelectionCandidate({
        scope: options.scope,
        candidateId: request.candidateId,
        ...(options.objective ? { objective: options.objective } : {}),
        projectorVersion,
      });
      const sealed = sealForRemote(subject, projectorVersion, projection);
      const startedAt = Date.now();
      let outcome: ExecutorOutcome;
      try {
        outcome = await executeWithTimeout(
          options.executor,
          { decision: sealed.decision, sealed, candidates: [request.candidateId] },
          timeoutMs,
        );
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
      const latencyMs = Date.now() - startedAt;
      if (outcome.kind === "failure") return { error: outcome.error };
      if (outcome.kind !== "noul") {
        return { error: `selector returned ${outcome.kind}, expected a bounded Noul probability` };
      }
      const probability = outcome.probability;
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        return { error: `engine returned an out-of-range probability for ${request.candidateId}: ${probability}` };
      }
      const candidate: FrozenToolCandidate | undefined = candidateFor(options.scope, request.candidateId);
      options.onRanking?.({
        experimentId: TOOL_SELECTION_EXPERIMENT,
        projectorVersion,
        scopeId: request.scopeId,
        candidateId: request.candidateId,
        ...(candidate ? { label: candidate.label } : {}),
        engineId: options.executor.engineId,
        ...(options.model ? { model: options.model } : {}),
        outcomeKind: "noul",
        probability,
        rankValue: probability,
        latencyMs,
        projectionHash: sealed.hash,
      });
      return { rankValue: probability };
    },
  };
}

/**
 * Read the sealed payload back into a projection, refusing anything that is not
 * this experiment under this projector version. A payload from another
 * experiment or another projector version is a malformed input here, never
 * something to interpret loosely.
 */
export function readToolSelectionProjection(
  payload: Record<string, unknown>,
): ToolSelectionProjection {
  if (payload.experiment !== TOOL_SELECTION_EXPERIMENT) {
    throw new MalformedResultError(
      `tool-selection projection is for experiment ${String(payload.experiment)}, not ${TOOL_SELECTION_EXPERIMENT}`,
    );
  }
  if (payload.projectorVersion !== TOOL_SELECTION_PROJECTOR_VERSION) {
    throw new MalformedResultError(
      `tool-selection projection uses projector ${String(payload.projectorVersion)}, not ${TOOL_SELECTION_PROJECTOR_VERSION}`,
    );
  }
  const candidate = payload.candidate as { candidateId?: unknown; label?: unknown } | undefined;
  if (!candidate || typeof candidate.candidateId !== "string" || candidate.candidateId.length === 0) {
    throw new MalformedResultError("tool-selection projection is missing a candidate id");
  }
  if (typeof candidate.label !== "string" || candidate.label.length === 0) {
    throw new MalformedResultError("tool-selection projection is missing a candidate label");
  }
  return payload as unknown as ToolSelectionProjection;
}
