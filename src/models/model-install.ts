/**
 * model-install.ts — Apply, install, list, and show model profiles.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getProfile, listProfiles } from "../config/profile-registry.js";
import { buildProfilePatch, applyProfilePatch, PRESERVED_SECTIONS, type ProfilePatch } from "../config/profile-patch.js";
import type { ProfileData } from "../config/profile-types.js";
import type { AlixConfig } from "../config/schema.js";

export type ApplyResult = { success: boolean; message: string; changes?: ProfilePatch; preserved?: string[] };
export type InstallResult = { success: boolean; message: string; pulled: string[]; skipped: string[]; errors: string[] };

function configPath(cwd: string): string { return join(cwd, ".alix", "config.json"); }

function readConfig(cwd: string): AlixConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) throw new Error(`No config found at ${path}. Run "alix init" first.`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeConfig(cwd: string, config: AlixConfig): void {
  writeFileSync(configPath(cwd), JSON.stringify(config, null, 2), "utf-8");
}

export function listAllProfiles(): ProfileData[] { return listProfiles(); }
export function showProfileDetail(id: string): ProfileData | undefined { return getProfile(id); }

const PRESERVED = PRESERVED_SECTIONS;

export function applyProfile(profileId: string, cwd: string, dryRun = false): ApplyResult {
  const profile = getProfile(profileId);
  if (!profile) return { success: false, message: `Unknown profile: ${profileId}. Use "alix models list-profiles" to see available profiles.` };
  const config = readConfig(cwd);
  const patch = buildProfilePatch(profile);
  const newConfig = applyProfilePatch(config, patch);
  if (dryRun) {
    return { success: true, message: `[DRY-RUN] Would apply profile: ${profileId}`, changes: patch, preserved: PRESERVED.filter(s => (config as any)[s] !== undefined) };
  }
  writeConfig(cwd, newConfig);
  return { success: true, message: `Applied profile: ${profile.id} — ${profile.name}`, changes: patch, preserved: PRESERVED.filter(s => (config as any)[s] !== undefined) };
}

export function installProfile(profileId: string, cwd: string, dryRun = false): InstallResult | ApplyResult {
  const profile = getProfile(profileId);
  if (!profile) return { success: false, message: `Unknown profile: ${profileId}` };
  if (profile.mode === "cloud-only") {
    return dryRun ? { success: true, message: `[DRY-RUN] Would validate API keys and apply profile: ${profileId}`, pulled: [], skipped: [], errors: [] } : applyProfile(profileId, cwd);
  }
  const modelsToPull = profile.install?.ollamaPull || [];
  const pulled: string[] = [];
  const errors: string[] = [];
  for (const model of modelsToPull) {
    if (dryRun) continue;
    try {
      execFileSync("ollama", ["pull", model], { timeout: 300000, stdio: "pipe" });
      pulled.push(model);
    } catch { errors.push(model); }
  }
  const applyResult = dryRun ? applyProfile(profileId, cwd, true) : applyProfile(profileId, cwd);
  return { success: applyResult.success && errors.length === 0, message: dryRun ? `[DRY-RUN] Would install profile: ${profileId} (would pull ${modelsToPull.length} models)` : `Installed profile: ${profileId}. Pulled ${pulled.length}, errors ${errors.length}.`, pulled, skipped: dryRun ? modelsToPull : [], errors };
}
