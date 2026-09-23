/**
 * jev-mapping.ts — Context relevance ↔ System One wire mapping.
 *
 * Verified shape: one Noul question keyed by id; the answer is the probability
 * that the item is relevant, read from `answers[id].noul`. A Noul has no
 * confidence field — the value is the answer and the certainty together.
 */

import { MalformedResultError } from "../../executors.js";
import type { NoulResult } from "../../contracts.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type {
  JevResponseContext,
  JevSystemOneRequest,
  JevSystemOneResponse,
} from "../../engines/jev-protocol.js";
import { JEV_DEFAULT_MODEL, isJevNoulAnswer } from "../../engines/jev-protocol.js";
import { readRelevanceProjection } from "./projection.js";

export const JEV_RELEVANCE_QUESTION_ID = "context-relevant";

export function renderRelevanceState(objective: string, item: string): string {
  return `OBJECTIVE:\n${objective}\n\nITEM:\n${item}`;
}

function requireRelevanceProjection(sealed: RemoteSealedProjection<Record<string, unknown>>) {
  const projection = readRelevanceProjection(sealed.payload);
  if (projection.objective.length === 0 || projection.item.length === 0) {
    throw new Error("context-relevance projection requires an objective and an item");
  }
  return projection;
}

export function toJevRelevanceRequest(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
): JevSystemOneRequest {
  const projection = requireRelevanceProjection(sealed);
  return {
    state: renderRelevanceState(projection.objective, projection.item),
    model: JEV_DEFAULT_MODEL,
    questions: {
      [JEV_RELEVANCE_QUESTION_ID]: {
        type: "noul",
        instructions: "Is the item relevant to the objective?",
        criteria: {
          true: "The item carries information the objective needs",
          false: "The item is unrelated to the objective",
        },
      },
    },
  };
}

/**
 * Map a Noul response to a native NoulResult. A missing answer or an
 * out-of-range value is malformed — rejected, never coerced (JEV-1).
 */
export function fromJevRelevanceResponse(
  response: JevSystemOneResponse,
  ctx: JevResponseContext & { engineId?: string },
): NoulResult {
  const answer = response?.answers?.[JEV_RELEVANCE_QUESTION_ID];
  if (!isJevNoulAnswer(answer)) {
    throw new MalformedResultError(
      `jev response missing noul answer for question ${JEV_RELEVANCE_QUESTION_ID}`,
    );
  }
  if (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
    throw new MalformedResultError("jev noul value outside 0..1");
  }
  return {
    kind: "noul",
    probability: answer.noul,
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
