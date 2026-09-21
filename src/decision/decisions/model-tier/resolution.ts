/**
 * resolution.ts — Tier → concrete model resolution (J3 task 23).
 *
 * A selected tier is resolved ONLY through the canonical model configuration
 * (`resolveModelConfig` reading `models.*`). No legacy alias, no second source
 * of truth, and no provider/model ID ever comes back from Jev.
 */

import type { AlixConfig, ModelConfig, ModelTier } from "../../../config/schema.js";
import { resolveModelConfig } from "../../../config/model-resolver.js";
import type { RoutableTier } from "./tiers.js";

/** Resolve the concrete model for a tier via the canonical configuration. */
export function resolveTierModel(
  config: Pick<AlixConfig, "models">,
  tier: RoutableTier | ModelTier,
): ModelConfig {
  return resolveModelConfig(config, tier);
}

export type CurrentRouting = {
  tier: ModelTier;
  provider: string;
  name: string;
};

/** What the existing routing policy would use today (the fallback arm). */
export function describeCurrentRouting(config: Pick<AlixConfig, "models">): CurrentRouting {
  const model = resolveModelConfig(config, "default");
  return { tier: "default", provider: model.provider, name: model.name };
}

/** Whether a tier resolves to the same concrete model as current routing. */
export function tierMatchesCurrentRouting(
  config: Pick<AlixConfig, "models">,
  tier: RoutableTier,
): boolean {
  const current = describeCurrentRouting(config);
  const target = resolveTierModel(config, tier);
  return target.provider === current.provider && target.name === current.name;
}
