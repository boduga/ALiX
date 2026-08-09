import type { AlixConfig, ModelConfig, ModelTier } from "./schema.js";
import { isValidModelConfig } from "./schema.js";

/**
 * Pure model resolver — the single reader runtime code uses to pick a model.
 *
 * Reads ONLY the canonical `models` object (single source of truth). It never
 * inspects the derived `model`/`subagents` compatibility projections or
 * `modelProfile`, never mutates the config, never normalizes, and relies on
 * the `ModelTier` type (guarded by `isModelTier` at the CLI/config boundary)
 * instead of validating arbitrary strings.
 *
 * Resolution (§3.1 of the plan):
 *   - no tier, or `"default"`            → `models.default`
 *   - explicit non-default tier          → `models[tier] ?? models.default`
 *
 * An invalid-but-present `models[tier]` shadows the default (it resolves, then
 * fails the validity check) — matching the loader projection's semantics where
 * an explicit entry that names no provider/model does not silently fall back.
 *
 * Returns a defensive copy (§3.3) so callers cannot mutate the loaded
 * configuration by accident. Throws §3.4 when no valid model resolves.
 */
export function resolveModelConfig(
  config: AlixConfig,
  tier?: ModelTier,
): ModelConfig {
  const models = config.models;
  const source =
    tier === undefined || tier === "default"
      ? models?.default
      : models?.[tier] ?? models?.default;

  if (isValidModelConfig(source)) {
    return { ...source };
  }
  throw new Error("No model configured. Run: alix models set-default");
}
