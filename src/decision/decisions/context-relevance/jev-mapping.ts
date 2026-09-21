/**
 * jev-mapping.ts — Context relevance ↔ Jev System One wire mapping (J2).
 *
 * Uses the Noul primitive: "Is this item relevant to the objective?" returns
 * P(yes) in 0..1 with no separate confidence field (per the System One
 * primitive contract). The consumer applies the threshold in code — the model
 * is never asked to rank a set.
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

function readProjection(sealed: RemoteSealedProjection<Record<string, unknown>>) {
  const projection = readRelevanceProjection(sealed.payload);
  if (projection.objective.length === 0 || projection.item.length === 0) {
    throw new Error("context-relevance projection requires an objective and an item");
  }
  return projection;
}

export function toJevRelevanceRequest(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
): JevSystemOneRequest {
  const projection = readProjection(sealed);
  return {
    model: JEV_DEFAULT_MODEL,
    state: renderRelevanceState(projection.objective, projection.item),
    questions: [
      {
        id: JEV_RELEVANCE_QUESTION_ID,
        type: "noul",
        prompt: "Is this item relevant to the objective?",
      },
    ],
  };
}

/**
 * Map a Noul response to a native NoulResult. A missing answer or an
 * out-of-range probability is malformed — rejected, never coerced (JEV-1).
 */
export function fromJevRelevanceResponse(
  response: JevSystemOneResponse,
  ctx: JevResponseContext & { engineId?: string },
): NoulResult {
  if (!response || typeof response !== "object" || !Array.isArray(response.answers)) {
    throw new MalformedResultError("jev response missing answers array");
  }
  const answer = response.answers.find(
    (item) => item?.id === JEV_RELEVANCE_QUESTION_ID && isJevNoulAnswer(item),
  );
  if (!answer || !isJevNoulAnswer(answer)) {
    throw new MalformedResultError(
      `jev response missing noul answer for question ${JEV_RELEVANCE_QUESTION_ID}`,
    );
  }
  if (
    typeof answer.probability !== "number" ||
    !Number.isFinite(answer.probability) ||
    answer.probability < 0 ||
    answer.probability > 1
  ) {
    throw new MalformedResultError("jev probability outside 0..1");
  }
  return {
    kind: "noul",
    probability: answer.probability,
    provenance: {
      engineId: ctx.engineId ?? "jev",
      ...(response.model !== undefined ? { engineVersion: response.model } : {}),
      latencyMs: ctx.latencyMs,
      remote: true,
      projectionHash: ctx.projectionHash,
    },
  };
}
