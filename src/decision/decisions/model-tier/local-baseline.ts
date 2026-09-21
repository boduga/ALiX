/**
 * local-baseline.ts — Deterministic model-tier baseline (J3).
 *
 * Feature → compute class, using only enabled tiers. Conservative: abstains
 * when the request needs vision (this decision is not equipped to route
 * modality) or when no enabled tier satisfies the request, so the existing
 * routing policy keeps the call.
 */

import type { ModelTierProjection } from "./projection.js";
import type { RoutableTier } from "./tiers.js";

export type LocalTierChoice = {
  tier?: RoutableTier;
  reason: string;
};

/** Preferred tier per task kind, most specific first. */
const TASK_KIND_PREFERENCE: Record<ModelTierProjection["taskKind"], readonly RoutableTier[]> = {
  code: ["coding", "default", "thinking"],
  critique: ["critic", "thinking", "default"],
  quick: ["fast", "tiny", "default"],
  analysis: ["thinking", "default"],
  synthesis: ["thinking", "default"],
  other: ["default"],
};

export function chooseTierLocally(
  features: ModelTierProjection,
  enabled: readonly RoutableTier[],
): LocalTierChoice {
  if (features.needsVision) {
    return { reason: "vision requests are outside this decision's candidate set" };
  }
  if (enabled.length === 0) {
    return { reason: "no enabled tiers" };
  }

  const preference = TASK_KIND_PREFERENCE[features.taskKind];
  const preferred = features.longContext
    ? [...preference.filter((tier) => tier !== "tiny"), "tiny" as RoutableTier]
    : [...preference];

  for (const tier of preferred) {
    if (enabled.includes(tier)) {
      return {
        tier,
        reason: `taskKind=${features.taskKind}${features.longContext ? " longContext" : ""} -> ${tier}`,
      };
    }
  }
  return { reason: `no enabled tier satisfies taskKind=${features.taskKind}` };
}
