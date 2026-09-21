/**
 * jev-mapping.ts — Model tier ↔ Jev System One wire mapping (J3).
 *
 * A bounded Choice whose OPTIONS are ALiX compute classes supplied by the
 * caller (enabled canonical tiers). Jev never sees a provider or model ID, and
 * a response that is not one of the offered tiers is rejected, never coerced
 * (JEV-1, JEV-10).
 */

import { MalformedResultError } from "../../executors.js";
import type { ChoiceResult } from "../../contracts.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type {
  JevResponseContext,
  JevSystemOneRequest,
  JevSystemOneResponse,
} from "../../engines/jev-protocol.js";
import { JEV_DEFAULT_MODEL, isJevChoiceAnswer } from "../../engines/jev-protocol.js";
import { readModelTierProjection, type ModelTierProjection } from "./projection.js";
import { isRoutableTier, type RoutableTier } from "./tiers.js";

export const JEV_MODEL_TIER_QUESTION_ID = "model-tier";

export function renderModelTierState(features: ModelTierProjection): string {
  return [
    `TASK KIND: ${features.taskKind}`,
    `PROMPT SIZE (chars): ${features.promptChars}`,
    `NEEDS TOOLS: ${features.needsTools}`,
    `LONG CONTEXT: ${features.longContext}`,
  ].join("\n");
}

export function toJevModelTierRequest(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
  candidates: readonly RoutableTier[],
): JevSystemOneRequest {
  if (candidates.length === 0) {
    throw new Error("model-tier requires at least one enabled candidate tier");
  }
  const features = readModelTierProjection(sealed.payload);
  return {
    model: JEV_DEFAULT_MODEL,
    state: renderModelTierState(features),
    questions: [
      {
        id: JEV_MODEL_TIER_QUESTION_ID,
        type: "choice",
        prompt: "Which compute tier should handle this task?",
        options: candidates,
      },
    ],
  };
}

/**
 * Map a response to a native ChoiceResult. A provider/model ID, an unknown
 * tier, or a tier that was not offered is malformed — rejected, never coerced.
 */
export function fromJevModelTierResponse(
  response: JevSystemOneResponse,
  ctx: JevResponseContext & { engineId?: string },
  candidates: readonly RoutableTier[],
): ChoiceResult<RoutableTier> {
  if (!response || typeof response !== "object" || !Array.isArray(response.answers)) {
    throw new MalformedResultError("jev response missing answers array");
  }
  const answer = response.answers.find(
    (item) => item?.id === JEV_MODEL_TIER_QUESTION_ID && isJevChoiceAnswer(item),
  );
  if (!answer || !isJevChoiceAnswer(answer)) {
    throw new MalformedResultError(
      `jev response missing choice answer for question ${JEV_MODEL_TIER_QUESTION_ID}`,
    );
  }
  if (!isRoutableTier(answer.choice) || !candidates.includes(answer.choice)) {
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
    },
  };
}
