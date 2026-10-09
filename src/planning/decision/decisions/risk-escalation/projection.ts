/**
 * projection.ts — RiskEscalationProjection (J6).
 *
 * ONE action, described — never raw. The caller summarizes the action
 * (capability + a bounded human-readable summary + bounded detail) rather
 * than passing raw commands, arguments, or tool output: those can carry
 * secrets or adversarial text, and the boundary rejects them (JEV-3, JEV-4).
 */

import { projectForRemote, type Projector } from "../../projector.js";
import type { RemoteSealedProjection } from "../../boundary.js";
import type { DecisionType } from "../../contracts.js";

export const RISK_ESCALATION_DECISION: DecisionType = "risk-escalation";
export const RISK_ESCALATION_PROJECTOR_VERSION = "risk-escalation/v1";

/** Bounded so the projection stays minimum-necessary (JEV-6). */
export const MAX_CAPABILITY_CHARS = 120;
export const MAX_SUMMARY_CHARS = 500;
export const MAX_DETAIL_CHARS = 1_000;

export type RiskEscalationActionInput = {
  /** Capability being invoked, e.g. "shell.run". */
  capability: string;
  /** What the action does, in the caller's words — not raw args. */
  summary: string;
  /** Optional extra context, bounded. Never raw tool output. */
  detail?: string;
};

/** Minimal typed projection: capability + bounded description. */
export type RiskEscalationProjection = {
  capability: string;
  summary: string;
  detail: string;
};

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function createRiskEscalationProjector(): Projector<
  RiskEscalationActionInput,
  RiskEscalationProjection
> {
  return {
    decision: RISK_ESCALATION_DECISION,
    version: RISK_ESCALATION_PROJECTOR_VERSION,
    project(input: RiskEscalationActionInput): RiskEscalationProjection {
      const capability = clip(
        typeof input?.capability === "string" ? input.capability : "",
        MAX_CAPABILITY_CHARS,
      );
      if (capability.length === 0) {
        throw new Error("risk-escalation projection requires a non-empty capability");
      }
      const summary = clip(
        typeof input?.summary === "string" ? input.summary : "",
        MAX_SUMMARY_CHARS,
      );
      if (summary.length === 0) {
        throw new Error("risk-escalation projection requires a non-empty summary");
      }
      const detail = clip(
        typeof input?.detail === "string" ? input.detail : "",
        MAX_DETAIL_CHARS,
      );
      return { capability, summary, detail };
    },
  };
}

export function projectRiskEscalation(
  input: RiskEscalationActionInput,
  opts?: { now?: number },
): RemoteSealedProjection<RiskEscalationProjection> {
  return projectForRemote(createRiskEscalationProjector(), input, opts);
}

/** Lenient read of a sealed payload for local engines. */
export function readRiskProjection(payload: unknown): RiskEscalationProjection {
  const record = (payload ?? {}) as Record<string, unknown>;
  return {
    capability: typeof record.capability === "string" ? record.capability : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    detail: typeof record.detail === "string" ? record.detail : "",
  };
}
