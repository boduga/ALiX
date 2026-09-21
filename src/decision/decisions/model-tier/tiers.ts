/**
 * tiers.ts — Canonical tier candidates for routing (J3).
 *
 * JEV-10: Jev selects a TIER, never a provider/model ID. The candidate set is
 * every canonical tier that is actually configured, so an unconfigured tier is
 * never offered and cannot be selected.
 *
 * `image` IS a candidate: it is the tier for image-generation tasks (e.g. a
 * "nano banana" model configured as `models.image`). Capability requirements
 * such as image *input* are hard constraints the CALLER applies by filtering
 * the candidate set — a probabilistic decision must not be the gate for a
 * pass/fail requirement.
 */

import type { AlixConfig, ModelTier } from "../../../config/schema.js";
import { MODEL_TIER_VALUES, isModelTier, isValidModelConfig } from "../../../config/schema.js";

/** Canonical tier candidates, in canonical order. */
export const TIER_CANDIDATES = MODEL_TIER_VALUES;

/** Untrusted-input guard: `isModelTier` requires a string, values may be anything. */
export function isModelTierValue(value: unknown): value is ModelTier {
  return typeof value === "string" && isModelTier(value);
}

/** Tiers with a valid canonical model entry, in canonical order. */
export function listEnabledTiers(config: Pick<AlixConfig, "models">): ModelTier[] {
  return MODEL_TIER_VALUES.filter((tier) => isValidModelConfig(config.models?.[tier]));
}

/** Filter an untrusted candidate list down to canonical tiers (order preserved). */
export function filterTierCandidates(candidates: readonly unknown[] | undefined): ModelTier[] {
  return (candidates ?? []).filter(isModelTierValue);
}

/** Fail-closed membership check. Unknown or unconfigured tiers are rejected. */
export function assertEnabledTier(
  tier: unknown,
  enabled: readonly ModelTier[],
): asserts tier is ModelTier {
  if (!isModelTierValue(tier) || !enabled.includes(tier)) {
    throw new Error(
      `Unknown or disabled model tier: ${String(tier)} (enabled: ${enabled.join(", ") || "none"})`,
    );
  }
}
