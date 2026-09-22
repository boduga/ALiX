/**
 * labels.ts — Outcome labels for calibration (J4 task 26).
 *
 * A label is the GROUND TRUTH for a journaled decision, recorded after the
 * fact and independent of which engine answered. Without labels a journal
 * record is an observation, not evidence — so nothing here is ever inferred
 * from the engine's own output.
 *
 * Risk context is NOT here: it is a decision-time property and lives on the
 * journal record (see `contracts.ts`).
 */

import type { DecisionType } from "../contracts.js";

/**
 * Ground-truth judgement of one decision. `unknown` means "not judged" and is
 * excluded from calibration rather than treated as incorrect.
 */
export const OUTCOME_LABELS = ["correct", "incorrect", "unknown"] as const;
export type OutcomeLabel = (typeof OUTCOME_LABELS)[number];

export function isOutcomeLabel(value: unknown): value is OutcomeLabel {
  return (OUTCOME_LABELS as readonly unknown[]).includes(value);
}

/**
 * Direction of an incorrect decision, for decisions that select (relevance
 * filtering, threshold gating). Optional: only meaningful on `incorrect`.
 */
export const LABEL_ERROR_TYPES = ["false_positive", "false_negative", "other"] as const;
export type LabelErrorType = (typeof LABEL_ERROR_TYPES)[number];

export function isLabelErrorType(value: unknown): value is LabelErrorType {
  return (LABEL_ERROR_TYPES as readonly unknown[]).includes(value);
}

export type DecisionOutcomeLabel = {
  /** The journal record this label judges. */
  decisionId: string;
  decision: DecisionType;
  label: OutcomeLabel;
  /** Present only when `label` is `incorrect`. */
  errorType?: LabelErrorType;
  observedAt: number;
  note?: string;
};

export class LabelValidationError extends Error {
  readonly code = "LABEL_VALIDATION";
  constructor(message: string) {
    super(`Invalid outcome label: ${message}`);
    this.name = "LabelValidationError";
  }
}

function throwIfInvalid(condition: boolean, message: string): void {
  if (condition) throw new LabelValidationError(message);
}

/** Pure builder + validator. No I/O. */
export function createOutcomeLabel(input: {
  decisionId: string;
  decision: DecisionType;
  label: OutcomeLabel;
  errorType?: LabelErrorType;
  observedAt?: number;
  note?: string;
}): DecisionOutcomeLabel {
  throwIfInvalid(
    typeof input.decisionId !== "string" || input.decisionId.length === 0,
    "decisionId required",
  );
  throwIfInvalid(typeof input.decision !== "string" || input.decision.length === 0, "decision required");
  throwIfInvalid(!isOutcomeLabel(input.label), `unknown label: ${String(input.label)}`);
  throwIfInvalid(
    input.errorType !== undefined && !isLabelErrorType(input.errorType),
    `unknown error type: ${String(input.errorType)}`,
  );
  throwIfInvalid(
    input.errorType !== undefined && input.label !== "incorrect",
    "errorType is only meaningful on an incorrect label",
  );
  throwIfInvalid(
    input.note !== undefined && typeof input.note !== "string",
    "note must be a string when present",
  );
  const observedAt = input.observedAt ?? Date.now();
  throwIfInvalid(!Number.isFinite(observedAt), "observedAt must be finite");
  return {
    decisionId: input.decisionId,
    decision: input.decision,
    label: input.label,
    ...(input.errorType !== undefined ? { errorType: input.errorType } : {}),
    observedAt,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
}

/**
 * Structural guard for values read back from disk. Requires `observedAt`
 * (unlike the builder, which defaults it).
 */
export function isDecisionOutcomeLabel(value: unknown): value is DecisionOutcomeLabel {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.decisionId === "string" &&
    v.decisionId.length > 0 &&
    typeof v.decision === "string" &&
    v.decision.length > 0 &&
    isOutcomeLabel(v.label) &&
    (v.errorType === undefined || isLabelErrorType(v.errorType)) &&
    typeof v.observedAt === "number" &&
    Number.isFinite(v.observedAt) &&
    (v.note === undefined || typeof v.note === "string")
  );
}

/** Most recent label per decisionId wins (labels can be revised). */
export function indexLabelsByDecisionId(
  labels: readonly DecisionOutcomeLabel[],
): Map<string, DecisionOutcomeLabel> {
  const byId = new Map<string, DecisionOutcomeLabel>();
  for (const label of labels) {
    const existing = byId.get(label.decisionId);
    if (!existing || label.observedAt >= existing.observedAt) byId.set(label.decisionId, label);
  }
  return byId;
}
