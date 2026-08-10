/**
 * profile-patch.ts — Bounded config patching for model profiles.
 *
 * applyProfilePatch writes only these fields to a persisted config:
 *   modelProfile, models
 *
 * `model` and `subagents` are loader-derived runtime compatibility
 * projections and are deliberately NOT produced or persisted here — the
 * loader re-derives them from `models` on the next load. All other sections
 * (policy, workspace, daemon, memory, approvals, tools, logging, apiKeys,
 * permissions, mcpServers, context, skills, extensions, ui, toolConfig,
 * runtime) are never touched.
 *
 * NOTE: `ProfileRuntime.maxContextTokens` is intentionally NOT propagated.
 * RuntimeConfig has no such field and nothing reads `config.runtime
 * .maxContextTokens` — max-token budgets come from `models.<tier>
 * .maxContextTokens` (see runtime-builder/agent-loop/session). The old patch
 * wrote a phantom, unread property through an untyped path; §5.1 restricts
 * the patch to `{ modelProfile, models }`.
 */

import type { AlixConfig, ModelConfig, ModelTier, PersistedAlixConfig } from "../config/schema.js";
import { withoutDerivedModelProjections } from "./persistence.js";
import type { ProfileData, ProfileModelTier } from "./profile-types.js";
import { PROFILE_TIER_MAP } from "./profile-types.js";

export type ProfilePatch = {
  modelProfile: string;
  models: Partial<Record<ModelTier, ModelConfig>>;
};

export const PRESERVED_SECTIONS = [
  "policy", "workspace", "daemon", "memory", "approvals", "tools",
  "logging", "apiKeys", "permissions", "mcpServers", "mcpServerPaths",
  "context", "skills", "extensions", "ui", "toolConfig",
];

/**
 * Build a patch that carries ONLY the profile's model assignments, keyed by
 * canonical `ModelTier`. Profile-vocabulary tiers are mapped via
 * `PROFILE_TIER_MAP` (§5.2) — `coder` → `models.coding`, `planner` →
 * `models.thinking`, and tiers with no configuration equivalent (e.g.
 * `classifier`) are skipped.
 */
export function buildProfilePatch(profile: ProfileData): ProfilePatch {
  const patch: ProfilePatch = { modelProfile: profile.id, models: {} };

  for (const [profileTier, model] of Object.entries(profile.models)) {
    const tier = PROFILE_TIER_MAP[profileTier as ProfileModelTier];
    if (!tier) continue; // e.g. classifier has no configuration equivalent
    patch.models[tier] = { provider: model.provider, name: model.name };
    if (model.temperature !== undefined) patch.models[tier].temperature = model.temperature;
  }

  return patch;
}

/**
 * Merge a profile patch into an existing runtime config and return a
 * `PersistedAlixConfig` ready for `writeConfig()` (§5.4).
 *
 * Profiles are partial presets (§5.3): `models = { ...existing.models,
 * ...patch.models }` — patch tiers win, unspecified existing tiers survive,
 * and no unrelated field is wiped. The loader-derived `model`/`subagents`
 * projections (including stale ones from the input config) are stripped by
 * `withoutDerivedModelProjections()` before returning.
 */
export function applyProfilePatch(existingConfig: AlixConfig, patch: ProfilePatch): PersistedAlixConfig {
  const merged: AlixConfig = {
    ...existingConfig,
    modelProfile: patch.modelProfile,
    models: { ...(existingConfig.models ?? {}), ...patch.models },
  };
  return withoutDerivedModelProjections(merged);
}
