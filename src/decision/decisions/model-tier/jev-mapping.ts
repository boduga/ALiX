/**
 * jev-mapping.ts — Model tier ↔ System One wire mapping.
 *
 * Verified shape: one Choice question keyed by id whose `criteria` map is the
 * enabled canonical tiers (option -> rubric description). Jev never sees a
 * provider or model ID, and a response that is not one of the offered tiers is
 * rejected, never coerced (JEV-1, JEV-10).
 */

import { MalformedResultError } from "../../executors.js";
import type { ChoiceResult } from "../../contracts.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type {
  JevChoiceCriteria,
  JevResponseContext,
  JevSystemOneRequest,
  JevSystemOneResponse,
} from "../../engines/jev-protocol.js";
import { JEV_DEFAULT_MODEL, JEV_MAX_CHOICE_OPTIONS, isJevChoiceAnswer } from "../../engines/jev-protocol.js";
import type { ModelTier } from "../../../config/schema.js";
import { isModelTier } from "../../../config/schema.js";
import { readModelTierProjection, type ModelTierProjection } from "./projection.js";

export const JEV_MODEL_TIER_QUESTION_ID = "model-tier";

/** Rubric descriptions separate the compute classes from one another. */
const TIER_DESCRIPTIONS: Record<ModelTier, string> = {
  default: "Balanced general-purpose work",
  thinking: "Deep reasoning, analysis, or planning",
  coding: "Code generation, edits, and refactors",
  fast: "Quick, simple lookups or classifications",
  critic: "Review, verification, or critique of existing work",
  tiny: "The smallest and cheapest option that can still do the job",
  image: "Image generation or editing",
};

function tierCriteria(candidates: readonly ModelTier[]): JevChoiceCriteria {
  const criteria: JevChoiceCriteria = {};
  for (const tier of candidates) {
    criteria[tier] = TIER_DESCRIPTIONS[tier];
  }
  return criteria;
}

export function renderModelTierState(features: ModelTierProjection): string {
  return [
    `TASK KIND: ${features.taskKind}`,
    `PROMPT SIZE (chars): ${features.promptChars}`,
    `NEEDS TOOLS: ${features.needsTools}`,
    `NEEDS IMAGE INPUT: ${features.needsVision}`,
    `LONG CONTEXT: ${features.longContext}`,
  ].join("\n");
}

export function toJevModelTierRequest(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  candidates: readonly ModelTier[],
): JevSystemOneRequest {
  if (candidates.length === 0) {
    throw new Error("model-tier requires at least one enabled candidate tier");
  }
  if (candidates.length > JEV_MAX_CHOICE_OPTIONS) {
    throw new Error(`model-tier has ${candidates.length} candidates, over the ${JEV_MAX_CHOICE_OPTIONS} limit`);
  }
  const features = readModelTierProjection(sealed.payload);
  return {
    state: renderModelTierState(features),
    model: JEV_DEFAULT_MODEL,
    questions: {
      [JEV_MODEL_TIER_QUESTION_ID]: {
        type: "choice",
        instructions: "Which compute tier should handle this task?",
        criteria: tierCriteria(candidates),
      },
    },
  };
}

/**
 * Map a response to a native ChoiceResult. A provider/model ID, an unknown
 * tier, or a tier that was not offered is malformed — rejected, never coerced.
 */
export function fromJevModelTierResponse(
  response: JevSystemOneResponse,
  ctx: JevResponseContext & { engineId?: string },
  candidates: readonly ModelTier[],
): ChoiceResult<ModelTier> {
  const answer = response?.answers?.[JEV_MODEL_TIER_QUESTION_ID];
  if (!isJevChoiceAnswer(answer)) {
    throw new MalformedResultError(
      `jev response missing choice answer for question ${JEV_MODEL_TIER_QUESTION_ID}`,
    );
  }
  if (!isModelTier(answer.choice) || !candidates.includes(answer.choice)) {
    throw new MalformedResultError(
      `jev returned a non-candidate tier: ${String(answer.choice)}`,
    );
  }
  if (
    answer.confidence !== undefined &&
    (typeof answer.confidence !== "number" ||
      !Number.isFinite(answer.confidence) ||
      answer.confidence < 0 ||
      answer.confidence > 1)
  ) {
    throw new MalformedResultError("jev confidence outside 0..1");
  }
  return {
    kind: "choice",
    choice: answer.choice,
    ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
    provenance: {
      engineId: ctx.engineId ?? "jev",
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
}
