/**
 * jev-mapping.ts — Claim verification ↔ System One wire mapping.
 *
 * Verified shape: one Choice question keyed by id; options live in `criteria`
 * as option -> rubric description (the descriptions are what separate the
 * options for the model). The answer is read back from `answers[id]`.
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
import { JEV_DEFAULT_MODEL, isJevChoiceAnswer } from "../../engines/jev-protocol.js";
import { CLAIM_VERDICT_CANDIDATES, isClaimVerdict, type ClaimVerdict } from "./schema.js";
import { readClaimProjection, type ClaimVerificationProjection } from "./projection.js";

export const JEV_CLAIM_QUESTION_ID = "claim-verdict";

/** Rubric descriptions separate the options from one another. */
const VERDICT_CRITERIA: JevChoiceCriteria = {
  supported: "The evidence supports the claim",
  contradicted: "The evidence contradicts the claim",
  insufficient: "The evidence does not bear on the claim either way",
};

/** Human-readable state block. Evidence is bounded by the projection. */
export function renderClaimState(projection: ClaimVerificationProjection): string {
  const evidence =
    projection.evidence.length === 0
      ? "(none provided)"
      : projection.evidence.map((excerpt, index) => `[${index + 1}] ${excerpt}`).join("\n");
  return `CLAIM:\n${projection.claim}\n\nEVIDENCE:\n${evidence}`;
}

function requireClaimProjection(
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
  const projection = requireClaimProjection(sealed);
  return {
    state: renderClaimState(projection),
    model: JEV_DEFAULT_MODEL,
    questions: {
      [JEV_CLAIM_QUESTION_ID]: {
        type: "choice",
        instructions:
          "Does the evidence support the claim, contradict it, or is it insufficient to judge?",
        criteria: VERDICT_CRITERIA,
      },
    },
  };
}

/**
 * Map a response to a native ChoiceResult. Unknown verdicts and out-of-range
 * confidence are malformed results — rejected, never coerced (JEV-1), which
 * makes them fallback-eligible.
 */
export function fromJevResponse(
  response: JevSystemOneResponse,
  ctx: JevResponseContext & { engineId?: string },
): ChoiceResult<ClaimVerdict> {
  const answer = response?.answers?.[JEV_CLAIM_QUESTION_ID];
  if (!isJevChoiceAnswer(answer)) {
    throw new MalformedResultError(
      `jev response missing choice answer for question ${JEV_CLAIM_QUESTION_ID}`,
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

/** Exposed for callers that need the legal option list. */
export const CLAIM_VERDICT_OPTIONS = CLAIM_VERDICT_CANDIDATES;
