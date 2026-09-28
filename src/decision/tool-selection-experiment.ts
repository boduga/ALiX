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
import { JEV_ENGINE_ID, createJevExecutor, type JevDecisionMapping } from "./engines/jev.js";
import {
  JEV_DEFAULT_MODEL,
  isJevNoulAnswer,
  type JevResponseContext,
  type JevSystemOneRequest,
  type JevSystemOneResponse,
  type JevTransport,
} from "./engines/jev-protocol.js";

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
      label: labelFor(input.scope, candidateId),
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
 * carries a raw `mcp__<handle>` has not been frozen properly, so this fails
 * closed rather than shipping the handle to the boundary.
 */
function labelFor(scope: ToolSelectionScope, candidateId: string): string {
  if (candidateId.startsWith(MCP_TOOL_PREFIX)) {
    throw new MalformedResultError(
      `frozen surface of ${scope.scopeId} contains an unresolved MCP handle — freeze candidates first`,
    );
  }
  return candidateFor(scope, candidateId)?.label ?? candidateId;
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
 * Wire question id for the experiment's single question. System One's verified
 * primitives here are Choice and Noul; this experiment asks one Noul question
 * per candidate, so the answer is already a bounded 0..1 appropriateness
 * probability. The ordinal `Score` primitive (ordered criteria, 2-10 levels) is
 * deliberately not modelled until a decision actually needs a rubric rating.
 */
export const TOOL_SELECTION_JEV_QUESTION_ID = "tool-selection-appropriateness";

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

/** Bounded, human-readable state: what the model sees for one candidate. */
export function renderToolSelectionState(projection: ToolSelectionProjection): string {
  const requirementLines =
    projection.requirementCandidates.length === 0
      ? ["(none)"]
      : projection.requirementCandidates.map(
          entry => `- ${entry.candidateId} (${entry.reasons.join(", ") || "no recorded reason"})`,
        );
  return [
    "OBJECTIVE:",
    projection.objective ?? "(not recorded)",
    "",
    "CANDIDATE:",
    `- ${projection.candidate.label} [${projection.candidate.candidateId}]${
      projection.candidate.description ? `: ${projection.candidate.description}` : ""
    }`,
    "",
    // Context, not a comparison: the question below asks about this candidate
    // alone, and a candidate is scored without seeing the others' answers.
    "OTHER TOOLS AVAILABLE THIS TURN (context only):",
    ...projection.offered.map(entry => `- ${entry.label} [${entry.candidateId}]`),
    "",
    "TOOLS THAT WOULD CLOSE A DETECTED REQUIREMENT:",
    ...requirementLines,
  ].join("\n");
}

/**
 * The experiment's Jev mapping. It is NOT a runtime decision mapping: it is
 * registered on the adapter by the offline caller through
 * `experimentMappings`, so `experiment:tool-selection-replay` can be scored
 * without tool selection becoming a supported `DecisionType`.
 */
export const TOOL_SELECTION_JEV_MAPPING: JevDecisionMapping = {
  toRequest(sealed): JevSystemOneRequest {
    const projection = readToolSelectionProjection(sealed.payload);
    return {
      state: renderToolSelectionState(projection),
      model: JEV_DEFAULT_MODEL,
      questions: {
        [TOOL_SELECTION_JEV_QUESTION_ID]: {
          type: "noul",
          // Per-candidate and independent: the candidate does not see how the
          // other candidates were judged, so "best" would not be answerable.
          instructions:
            "Would executing this tool now be an appropriate next step for the objective?",
          criteria: {
            true: "Executing this tool now would be an appropriate next step for the objective",
            false: "Executing this tool now would not be an appropriate next step for the objective",
          },
        },
      },
    };
  },
  fromResponse(response: JevSystemOneResponse, ctx: JevResponseContext): ExecutorOutcome {
    const answer = response?.answers?.[TOOL_SELECTION_JEV_QUESTION_ID];
    if (!isJevNoulAnswer(answer)) {
      throw new MalformedResultError(
        `jev response missing noul answer for question ${TOOL_SELECTION_JEV_QUESTION_ID}`,
      );
    }
    if (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new MalformedResultError(`jev noul outside 0..1: ${String(answer.noul)}`);
    }
    return {
      kind: "noul",
      probability: answer.noul,
      provenance: {
        engineId: JEV_ENGINE_ID,
        ...(response.model !== undefined ? { engineVersion: response.model } : {}),
        latencyMs: ctx.latencyMs,
        remote: true,
        projectionHash: ctx.projectionHash,
        ...(response.usage !== undefined
          ? {
              usage: {
                inputTokens: response.usage.input_tokens ?? 0,
                outputTokens: response.usage.output_tokens ?? 0,
              },
            }
          : {}),
      },
    };
  },
};

export type JevToolSelectionScorerOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Injected transport (tests). Defaults to the fetch-based transport. */
  transport?: JevTransport;
  scope: ToolSelectionScope;
  objective?: string;
  onRanking?: (record: ExperimentRankingRecord) => void;
};

/**
 * The one-call composition the offline experiment uses: a Jev executor that has
 * this experiment's mapping registered (and only this one), wrapped in the
 * per-candidate experiment scorer. Nothing here touches the route table.
 */
export function createJevToolSelectionScorer(
  options: JevToolSelectionScorerOptions,
): ToolSelectionSelector {
  const executor = createJevExecutor({
    enabled: true,
    apiKey: options.apiKey,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.transport !== undefined ? { transport: options.transport } : {}),
    experimentMappings: { [TOOL_SELECTION_EXPERIMENT]: TOOL_SELECTION_JEV_MAPPING },
  });
  return createJevExperimentScorer({
    executor,
    scope: options.scope,
    ...(options.objective ? { objective: options.objective } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.onRanking ? { onRanking: options.onRanking } : {}),
  });
}
