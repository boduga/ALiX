/**
 * tool-selection-jev-mapping.ts — the OFFLINE experiment's System One wire
 * mapping and its one-call composition.
 *
 * Offline only: this module is imported by the experiment's replay tooling and
 * its tests, never by the live loop. It registers nothing in the engine route
 * table — the Jev adapter accepts an `experiment:` subject only when the caller
 * passes this mapping through `experimentMappings`, so tool selection stays an
 * experiment rather than a supported `DecisionType`.
 *
 * The wire primitive is Noul, deliberately: one question per candidate, answered
 * independently. The ordinal `Score` primitive (ordered criteria, 2-10 levels)
 * stays unmodelled until evidence says ranking needs a rubric rating.
 */

import { TOOL_SELECTION_EXPERIMENT, type ToolSelectionScope, type ToolSelectionSelector } from "./tool-selection-replay.js";
import {
  TOOL_SELECTION_PROJECTOR_VERSION,
  createJevExperimentScorer,
  readToolSelectionProjection,
  type ExperimentRankingRecord,
  type ToolSelectionProjection,
} from "./tool-selection-experiment.js";
import {
  MalformedResultError,
  type ExecutorOutcome,
} from "./executors.js";
import { JEV_ENGINE_ID, createJevExecutor, type JevDecisionMapping } from "./engines/jev.js";
import {
  JEV_DEFAULT_MODEL,
  isJevNoulAnswer,
  type JevResponseContext,
  type JevSystemOneRequest,
  type JevSystemOneResponse,
  type JevTransport,
} from "./engines/jev-protocol.js";

/** Wire question id for the experiment's single question. */
export const TOOL_SELECTION_JEV_QUESTION_ID = "tool-selection-appropriateness";

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
 * per-candidate experiment scorer. Nothing here touches the route table, and
 * nothing in the live loop imports this module.
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

/** Re-exported so callers importing the mapping get the pinned version too. */
export { TOOL_SELECTION_PROJECTOR_VERSION };
