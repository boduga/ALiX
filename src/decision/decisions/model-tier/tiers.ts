/**
 * tiers.ts — Canonical ALiX compute classes offered for routing (J3).
 *
 * JEV-10: Jev selects a TIER, never a provider/model ID. The candidate set is
 * derived from the canonical `models.*` configuration, so a tier that is not
 * configured is not offered and cannot be selected.
 */

import type { AlixConfig } from "../../../config/schema.js";
import { isValidModelConfig } from "../../../config/schema.js";

/**
 * Compute classes offered for routing. `image` is deliberately excluded: it is
 * a modality choice, not a compute class, so this decision abstains on vision
 * requests and leaves them to the existing routing policy.
 */
export const ROUTABLE_TIERS = [
  "tiny",
  "fast",
  "default",
  "coding",
  "thinking",
  "critic",
] as const;

export type RoutableTier = (typeof ROUTABLE_TIERS)[number];

export function isRoutableTier(value: unknown): value is RoutableTier {
  return (ROUTABLE_TIERS as readonly unknown[]).includes(value);
}

/** Filter an untrusted candidate list down to routable tiers (order preserved). */
export function filterRoutableTiers(
  candidates: readonly unknown[] | undefined,
): RoutableTier[] {
  return (candidates ?? []).filter(isRoutableTier);
}

/** Tiers with a valid canonical model entry, in canonical order. */
export function listEnabledTiers(config: Pick<AlixConfig, "models">): RoutableTier[] {
  return ROUTABLE_TIERS.filter((tier) => isValidModelConfig(config.models?.[tier]));
}

/** Fail-closed membership check. Unknown/disabled tiers are rejected. */
export function assertRoutableTier(
  tier: unknown,
  enabled: readonly RoutableTier[],
): asserts tier is RoutableTier {
  if (!isRoutableTier(tier) || !enabled.includes(tier)) {
    throw new Error(
      `Unknown or disabled model tier: ${String(tier)} (enabled: ${enabled.join(", ") || "none"})`,
    );
  }
}
