import type { AlixConfig, ModelConfig, ModelTier } from "./schema.js";
import { isValidModelConfig } from "./schema.js";

/** Canonical "no model configured" guidance — shared with the loader's richer message. */
export const NO_MODEL_CONFIGURED_MESSAGE =
  "No model configured. Run: alix models set-default";

/**
 * The resolver only reads the canonical `models` object, so callers with a
 * partial config (e.g. a TaskLoopDeps fragment) don't need a full `AlixConfig`
 * or an `as AlixConfig` cast.
 */
export type ModelSourceConfig = Pick<AlixConfig, "models">;

/** Resolve the effective model, or `undefined` when none resolves (non-throwing). */
export function tryResolveModelConfig(
  config: ModelSourceConfig,
  tier?: ModelTier,
): ModelConfig | undefined {
  const models = config.models;
  const source =
    tier === undefined || tier === "default"
      ? models?.default
      : models?.[tier] ?? models?.default;

  return isValidModelConfig(source) ? { ...source } : undefined;
}

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
 * configuration by accident. Throws §3.4 when no valid model resolves (use
 * `tryResolveModelConfig` for an optional read).
 */
export function resolveModelConfig(
  config: ModelSourceConfig,
  tier?: ModelTier,
): ModelConfig {
  const resolved = tryResolveModelConfig(config, tier);
  if (!resolved) {
    throw new Error(NO_MODEL_CONFIGURED_MESSAGE);
  }
  return resolved;
}
