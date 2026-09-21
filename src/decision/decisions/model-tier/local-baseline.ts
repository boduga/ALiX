/**
 * local-baseline.ts — Deterministic model-tier baseline (J3).
 *
 * Feature → canonical tier, using only enabled tiers. Image-generation tasks
 * route to the `image` tier (and abstain when it is not configured). Hard
 * capability requirements are the caller's job — this baseline does not gate on
 * them, because a pass/fail constraint must not be decided probabilistically.
 */

import type { ModelTier } from "../../../config/schema.js";
import type { ModelTierProjection } from "./projection.js";

export type LocalTierChoice = {
  tier?: ModelTier;
  reason: string;
};

/** Preferred tier per task kind, most specific first. */
const TASK_KIND_PREFERENCE: Record<ModelTierProjection["taskKind"], readonly ModelTier[]> = {
  code: ["coding", "default", "thinking"],
  critique: ["critic", "thinking", "default"],
  quick: ["fast", "tiny", "default"],
  analysis: ["thinking", "default"],
  synthesis: ["thinking", "default"],
  image: ["image"],
  other: ["default"],
};

export function chooseTierLocally(
  features: ModelTierProjection,
  enabled: readonly ModelTier[],
): LocalTierChoice {
  if (enabled.length === 0) {
    return { reason: "no enabled tiers" };
  }

  const preference = TASK_KIND_PREFERENCE[features.taskKind];
  // A long-context request should not land on the smallest tier when a larger
  // one is available; the ordering is stable either way.
  const preferred = features.longContext
    ? [...preference.filter((tier) => tier !== "tiny"), ...preference.filter((tier) => tier === "tiny")]
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
