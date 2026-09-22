/**
 * labels.ts — Outcome labels for calibration (J4 task 26).
 *
 * A label is the GROUND TRUTH for a journaled decision, recorded after the
 * fact and independent of which engine answered. Without labels a journal
 * record is an observation, not evidence — so nothing here is ever inferred
 * from the engine's own output.
 */

import type { DecisionType } from "../contracts.js";

/** Risk context a decision was made under. Thresholds may be per risk. */
export const RISK_CONTEXTS = ["low", "medium", "high"] as const;
export type RiskContext = (typeof RISK_CONTEXTS)[number];

export function isRiskContext(value: unknown): value is RiskContext {
  return (RISK_CONTEXTS as readonly unknown[]).includes(value);
}

/**
 * Ground-truth judgement of one decision. `unknown` means "not judged" and is
 * excluded from calibration rather than treated as incorrect.
 */
export const OUTCOME_LABELS = ["correct", "incorrect", "unknown"] as const;
export type OutcomeLabel = (typeof OUTCOME_LABELS)[number];

export function isOutcomeLabel(value: unknown): value is OutcomeLabel {
  return (OUTCOME_LABELS as readonly unknown[]).includes(value);
}

export type DecisionOutcomeLabel = {
  /** The journal record this label judges. */
  decisionId: string;
  decision: DecisionType;
  label: OutcomeLabel;
  risk?: RiskContext;
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

function assert(condition: boolean, message: string): void {
  if (!condition) throw new LabelValidationError(message);
}

/** Pure builder + validator. No I/O. */
export function createOutcomeLabel(input: {
  decisionId: string;
  decision: DecisionType;
  label: OutcomeLabel;
  risk?: RiskContext;
  observedAt?: number;
  note?: string;
}): DecisionOutcomeLabel {
  assert(
    typeof input.decisionId === "string" && input.decisionId.length > 0,
    "decisionId required",
  );
  assert(typeof input.decision === "string" && input.decision.length > 0, "decision required");
  assert(isOutcomeLabel(input.label), `unknown label: ${String(input.label)}`);
  assert(
    input.risk === undefined || isRiskContext(input.risk),
    `unknown risk context: ${String(input.risk)}`,
  );
  assert(
    input.note === undefined || typeof input.note === "string",
    "note must be a string when present",
  );
  const observedAt = input.observedAt ?? Date.now();
  assert(Number.isFinite(observedAt), "observedAt must be finite");
  return {
    decisionId: input.decisionId,
    decision: input.decision,
    label: input.label,
    ...(input.risk !== undefined ? { risk: input.risk } : {}),
    observedAt,
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
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
