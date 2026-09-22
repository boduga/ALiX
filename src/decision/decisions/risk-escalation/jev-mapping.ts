/**
 * jev-mapping.ts — Risk escalation ↔ System One wire mapping.
 *
 * Verified shape: one Choice question keyed by id whose `criteria` map is the
 * three risk tiers. The model judges severity only; authority stays with
 * deterministic policy (`composeApproval`).
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
import { isRiskTier, type RiskTier } from "./schema.js";
import { readRiskProjection, type RiskEscalationProjection } from "./projection.js";

export const JEV_RISK_QUESTION_ID = "action-risk";

/** Rubric descriptions separate the tiers from one another. */
const RISK_CRITERIA: JevChoiceCriteria = {
  low: "Observational only: reading or searching, no state change",
  medium: "Reversible change to workspace state, or an unclear effect",
  high: "Destructive or irreversible: deletes, overwrites, force operations, privilege escalation",
};

export function renderRiskState(projection: RiskEscalationProjection): string {
  const detail = projection.detail.length === 0 ? "(none provided)" : projection.detail;
  return `CAPABILITY:\n${projection.capability}\n\nACTION:\n${projection.summary}\n\nDETAIL:\n${detail}`;
}

function requireRiskProjection(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
): RiskEscalationProjection {
  const projection = readRiskProjection(sealed.payload);
  if (projection.capability.length === 0 || projection.summary.length === 0) {
    throw new Error("risk-escalation projection requires a capability and a summary");
  }
  return projection;
}

export function toJevRiskRequest(
  sealed: RemoteSealedProjection<Record<string, unknown>>,
): JevSystemOneRequest {
  const projection = requireRiskProjection(sealed);
  return {
    state: renderRiskState(projection),
    model: JEV_DEFAULT_MODEL,
    questions: {
      [JEV_RISK_QUESTION_ID]: {
        type: "choice",
        instructions: "What risk tier is this action: low, medium, or high?",
        criteria: RISK_CRITERIA,
      },
    },
  };
}

/**
 * Map a response to a native ChoiceResult. Unknown tiers are malformed —
 * rejected, never coerced (JEV-1), which makes them fallback-eligible.
 */
export function fromJevRiskResponse(
  response: JevSystemOneResponse,
  ctx: JevResponseContext & { engineId?: string },
): ChoiceResult<RiskTier> {
  const answer = response?.answers?.[JEV_RISK_QUESTION_ID];
  if (!isJevChoiceAnswer(answer)) {
    throw new MalformedResultError(
      `jev response missing choice answer for question ${JEV_RISK_QUESTION_ID}`,
    );
  }
  if (!isRiskTier(answer.choice)) {
    throw new MalformedResultError(`jev returned a non-tier verdict: ${String(answer.choice)}`);
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
