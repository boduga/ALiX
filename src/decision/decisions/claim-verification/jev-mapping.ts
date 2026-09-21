/**
 * jev-mapping.ts — Claim verification ↔ Jev System One wire mapping (J1).
 *
 * Pure: builds a Choice request from a sealed projection and maps a Jev
 * response back to a native ChoiceResult. Transport and endpoint live in
 * `engines/jev-protocol.ts` + `engines/jev.ts`.
 */

import { MalformedResultError } from "../../executors.js";
import type { ChoiceResult } from "../../contracts.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type {
  JevResponseContext,
  JevSystemOneRequest,
  JevSystemOneResponse,
} from "../../engines/jev-protocol.js";
import { JEV_DEFAULT_MODEL } from "../../engines/jev-protocol.js";
import { CLAIM_VERDICT_CANDIDATES, isClaimVerdict, type ClaimVerdict } from "./schema.js";
import { readClaimProjection, type ClaimVerificationProjection } from "./projection.js";

export const JEV_CLAIM_QUESTION_ID = "claim-verdict";

/** Human-readable state block. Evidence is bounded by the projection. */
export function renderClaimState(projection: ClaimVerificationProjection): string {
  const evidence =
    projection.evidence.length === 0
      ? "(none provided)"
      : projection.evidence.map((excerpt, index) => `[${index + 1}] ${excerpt}`).join("\n");
  return `CLAIM:\n${projection.claim}\n\nEVIDENCE:\n${evidence}`;
}

function readProjection(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
): ClaimVerificationProjection {
  const projection = readClaimProjection(sealed.payload);
  if (projection.claim.length === 0) {
    throw new Error("claim-verification projection is missing a claim");
  }
  return projection;
}

export function toJevRequest(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
): JevSystemOneRequest {
  const projection = readProjection(sealed);
  return {
    model: JEV_DEFAULT_MODEL,
    state: renderClaimState(projection),
    questions: [
      {
        id: JEV_CLAIM_QUESTION_ID,
        type: "choice",
        prompt: "Does the evidence support the claim, contradict it, or is it insufficient?",
        options: CLAIM_VERDICT_CANDIDATES,
      },
    ],
  };
}

/**
 * Map a Jev response to a native ChoiceResult. Unknown verdicts and
 * out-of-range confidence are malformed results — rejected, never coerced
 * (JEV-1), which makes them fallback-eligible.
 */
export function fromJevResponse(
  response: JevSystemOneResponse,
  ctx: JevResponseContext & { engineId?: string },
): ChoiceResult<ClaimVerdict> {
  if (!response || typeof response !== "object" || !Array.isArray(response.answers)) {
    throw new MalformedResultError("jev response missing answers array");
  }
  const answer = response.answers.find((item) => item?.id === JEV_CLAIM_QUESTION_ID);
  if (!answer) {
    throw new MalformedResultError(
      `jev response missing answer for question ${JEV_CLAIM_QUESTION_ID}`,
    );
  }
  if (!isClaimVerdict(answer.choice)) {
    throw new MalformedResultError(`jev returned unknown verdict: ${String(answer.choice)}`);
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
