/**
 * resolution.ts — Tier → concrete model resolution (J3 task 23).
 *
 * A selected tier is resolved ONLY through the canonical model configuration
 * (`resolveModelConfig` reading `models.*`). No legacy alias, no second source
 * of truth, and no provider/model ID ever comes back from Jev.
 *
 * Fail-closed (arch §11): an unknown or disabled tier is rejected here rather
 * than silently falling back to `models.default`, so a bad tier cannot reach a
 * provider invocation.
 */

import type { AlixConfig, ModelConfig, ModelTier } from "../../../config/schema.js";
import { resolveModelConfig } from "../../../config/model-resolver.js";
import { assertRoutableTier, listEnabledTiers } from "./tiers.js";

/**
 * Resolve the concrete model for a tier via the canonical configuration.
 * Throws for an unknown tier or one that is not configured/enabled.
 */
export function resolveTierModel(
  config: Pick<AlixConfig, "models">,
  tier: ModelTier,
): ModelConfig {
  assertRoutableTier(tier, listEnabledTiers(config));
  return resolveModelConfig(config, tier);
}

export type CurrentRouting = {
  tier: ModelTier;
  provider: string;
  name: string;
};

/** What the existing routing policy would use today (the fallback arm). */
export function describeCurrentRouting(config: Pick<AlixConfig, "models">): CurrentRouting {
  const model = resolveTierModel(config, "default");
  return { tier: "default", provider: model.provider, name: model.name };
}

/** Whether a tier resolves to the same concrete model as current routing. */
export function tierMatchesCurrentRouting(
  config: Pick<AlixConfig, "models">,
  tier: ModelTier,
): boolean {
  const current = describeCurrentRouting(config);
  const target = resolveTierModel(config, tier);
  return target.provider === current.provider && target.name === current.name;
}
