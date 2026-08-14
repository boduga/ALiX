/**
 * CAP-10 — `CapabilityMeasurementOutcome` discriminated union.
 * Three variants (ruling #15): effective / ineffective / inconclusive.
 * Each carries evidenceRefs, confidence, summary, signals.
 *
 * @module capability/measurement/outcome-discriminated-union
 */

import type { CapabilityEvolutionSignal } from "../evolution/a7-proposals.js";

export type CapabilityMeasurementOutcomeKind = "effective" | "ineffective" | "inconclusive";

export const CAPABILITY_MEASUREMENT_OUTCOMES: readonly CapabilityMeasurementOutcomeKind[] = [
  "effective",
  "ineffective",
  "inconclusive",
] as const;

interface CapabilityMeasurementOutcomeCommon {
  readonly evidenceRefs: readonly string[];
  readonly confidence: number;
  readonly summary: string;
  readonly signals: readonly CapabilityEvolutionSignal[];
}

export type CapabilityMeasurementOutcome =
  | (CapabilityMeasurementOutcomeCommon & { readonly kind: "effective" })
  | (CapabilityMeasurementOutcomeCommon & { readonly kind: "ineffective" })
  | (CapabilityMeasurementOutcomeCommon & { readonly kind: "inconclusive" });

export function isCapabilityMeasurementOutcome(value: unknown): value is CapabilityMeasurementOutcome {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (!CAPABILITY_MEASUREMENT_OUTCOMES.includes(v.kind as CapabilityMeasurementOutcomeKind)) return false;
  if (!Array.isArray(v.evidenceRefs)) return false;
  if (typeof v.confidence !== "number") return false;
  if (typeof v.summary !== "string") return false;
  if (!Array.isArray(v.signals)) return false;
  return true;
}

export function isEffectiveOutcome(
  value: CapabilityMeasurementOutcome,
): value is Extract<CapabilityMeasurementOutcome, { kind: "effective" }> {
  return value.kind === "effective";
}

export function isIneffectiveOutcome(
  value: CapabilityMeasurementOutcome,
): value is Extract<CapabilityMeasurementOutcome, { kind: "ineffective" }> {
  return value.kind === "ineffective";
}

export function isInconclusiveOutcome(
  value: CapabilityMeasurementOutcome,
): value is Extract<CapabilityMeasurementOutcome, { kind: "inconclusive" }> {
  return value.kind === "inconclusive";
}
