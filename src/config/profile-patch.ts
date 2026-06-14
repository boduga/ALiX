/**
 * profile-patch.ts — Bounded config patching for model profiles.
 *
 * applyProfilePatch writes only these fields to an AlixConfig:
 *   modelProfile, model, models (per-tier mappings)
 *
 * It NEVER touches: policy, workspace, daemon, memory, approvals,
 * tools, logging, apiKeys, permissions, mcpServers, context,
 * skills, extensions, ui, toolConfig.
 */

import type { AlixConfig } from "../config/schema.js";
import type { ProfileData } from "./profile-types.js";

export type ProfilePatch = {
  modelProfile: string;
  model?: { provider: string; name: string; temperature?: number };
  models?: Record<string, { provider: string; name: string; temperature?: number; contextWindow?: number }>;
  runtime?: { maxContextTokens?: number };
};

export const PRESERVED_SECTIONS = [
  "policy", "workspace", "daemon", "memory", "approvals", "tools",
  "logging", "apiKeys", "permissions", "mcpServers", "mcpServerPaths",
  "context", "skills", "extensions", "ui", "toolConfig",
];

export function buildProfilePatch(profile: ProfileData): ProfilePatch {
  const patch: ProfilePatch = { modelProfile: profile.id };

  if (profile.models.default) {
    patch.model = { provider: profile.models.default.provider, name: profile.models.default.name };
    if (profile.models.default.temperature !== undefined) patch.model.temperature = profile.models.default.temperature;
  }

  patch.models = {};
  for (const [tier, model] of Object.entries(profile.models)) {
    patch.models[tier] = { provider: model.provider, name: model.name };
    if (model.temperature !== undefined) patch.models[tier].temperature = model.temperature;
    if (model.contextWindow !== undefined) patch.models[tier].contextWindow = model.contextWindow;
  }

  if (profile.runtime?.maxContextTokens) {
    patch.runtime = { maxContextTokens: profile.runtime.maxContextTokens };
  }

  return patch;
}

export function applyProfilePatch(existingConfig: AlixConfig, patch: ProfilePatch): AlixConfig {
  const result: Record<string, unknown> = { ...(existingConfig as any) };
  result.modelProfile = patch.modelProfile;
  if (patch.model) result.model = { ...(result.model as object), ...patch.model };
  if (patch.models) result.models = { ...((result.models as object) || {}), ...patch.models };
  if (patch.runtime) result.runtime = { ...(result.runtime as object), ...patch.runtime };

  // Sync models into subagents so the runtime uses the profile's per-tier models.
  // Mapping: planner->thinking, coder->coding, critic->critic, researcher->fast, embeddings->tiny
  if (patch.models) {
    const tierMap: Record<string, string> = { planner: "thinking", coder: "coding", critic: "critic", researcher: "fast", embeddings: "tiny" };
    result.subagents = { ...((result.subagents as object) || {}) };
    for (const [profileTier, model] of Object.entries(patch.models)) {
      const subagentKey = tierMap[profileTier];
      if (!subagentKey) continue;
      (result.subagents as Record<string, unknown>)[subagentKey] = {
        ...((result.subagents as Record<string, unknown>)[subagentKey] as object || {}),
        provider: model.provider,
        name: model.name,
      };
    }
  }

  return result as AlixConfig;
}
