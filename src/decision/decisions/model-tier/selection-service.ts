/**
 * selection-service.ts — Model-tier routing behind a feature flag (J3 task 25).
 *
 * Modes:
 *  - "off"    — keep the existing routing policy; no engine call.
 *  - "shadow" — observe + journal, keep the existing routing policy.
 *  - "active" — return the selected tier for the caller to resolve through the
 *               canonical configuration (`resolveTierModel`).
 *
 * "off" is the default, so wiring this call site changes no routing until an
 * operator flips `modelTier.enabled` (and, per the plan, only after evaluation).
 */

import type { RoutableTier } from "./tiers.js";
import type { ModelTierRequestFeatures } from "./projection.js";
import type { ModelTierShadowDeps, ModelTierShadowResult } from "./shadow.js";
import { runModelTierShadow } from "./shadow.js";

export type ModelTierSelectionMode = "off" | "shadow" | "active";

export type ModelTierSelection = {
  mode: ModelTierSelectionMode;
  /** Present only in "active" mode and only when a tier was selected. */
  tier?: RoutableTier;
  shadow?: ModelTierShadowResult;
};

export async function selectModelTier(
  features: ModelTierRequestFeatures,
  deps: ModelTierShadowDeps & { mode?: ModelTierSelectionMode },
): Promise<ModelTierSelection> {
  const mode = deps.mode ?? "off";
  if (mode === "off") {
    return { mode };
  }

  const shadow = await runModelTierShadow(features, deps);
  if (mode === "shadow") {
    return { mode, shadow };
  }

  const tier = shadow.observed?.tier;
  return { mode, ...(tier !== undefined ? { tier } : {}), shadow };
}
