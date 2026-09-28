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
 *
 * The wire mapping lives here too (`TOOL_SELECTION_JEV_MAPPING`): one Noul
 * question per candidate ("is this the best next step?"), which is already a
 * bounded 0..1 appropriateness probability. It is registered on the adapter by
 * the offline caller (`createJevToolSelectionScorer` does that), never merged
 * into the runtime decision table.
 */

import { TOOL_SELECTION_EXPERIMENT, type ToolSelectionScope, type ToolSelectionSelector } from "./tool-selection-replay.js";
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
      ? {
          scoping: {
            fallbackFull: input.scope.scoping.fallbackFull,
            // The frozen surface only. A recorded admission outside `offered`
            // (an opaque `mcp__<handle>` candidate, say) is not part of this
            // choice problem, and the remote boundary is a trust boundary: its
            // secret gate rejects handle-shaped strings. Filtering is factual
            // — the tool really was both admitted and offered — never a
            // fabricated label.
            admitted: input.scope.scoping.admitted
              .filter(entry => input.scope.offered.includes(entry.tool))
              .map(entry => entry.tool),
          },
        }
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

/**
 * Wire question id for the experiment's single question. System One's verified
 * primitives here are Choice and Noul; this experiment asks one Noul question
 * per candidate ("is this the best next step?"), so the answer is already a
 * bounded 0..1 appropriateness probability. The ordinal `Score` primitive
 * (ordered criteria, 2-10 levels) is deliberately not modelled until a
 * decision actually needs a rubric rating.
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
  const candidate = payload.candidate as { tool?: unknown } | undefined;
  if (!candidate || typeof candidate.tool !== "string" || candidate.tool.length === 0) {
    throw new MalformedResultError("tool-selection projection is missing a candidate tool");
  }
  return payload as unknown as ToolSelectionProjection;
}

/** Bounded, human-readable state: what the model sees for one candidate. */
export function renderToolSelectionState(projection: ToolSelectionProjection): string {
  const requirementLines =
    projection.requirementCandidates.length === 0
      ? ["(none)"]
      : projection.requirementCandidates.map(
          entry => `- ${entry.tool} (${entry.reasons.join(", ") || "no recorded reason"})`,
        );
  return [
    "OBJECTIVE:",
    projection.objective ?? "(not recorded)",
    "",
    "CANDIDATE TOOL:",
    `- ${projection.candidate.tool}${
      projection.candidate.description ? `: ${projection.candidate.description}` : ""
    }`,
    "",
    "OFFERED TOOLS:",
    ...projection.offeredTools.map(tool => `- ${tool}`),
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
          instructions:
            `Is "${projection.candidate.tool}" the most appropriate next tool to execute for this objective, ` +
            "given the other offered tools?",
          criteria: {
            true: "This tool is the best next step among the offered tools",
            false: "Another offered tool, or no tool at all, is a better next step",
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
      kind: "score",
      score: answer.noul,
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
  describeTool?: (tool: string) => string | undefined;
  onScore?: (record: ExperimentScoreRecord) => void;
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
    ...(options.describeTool ? { describeTool: options.describeTool } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.onScore ? { onScore: options.onScore } : {}),
  });
}
