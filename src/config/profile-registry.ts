/**
 * profile-registry.ts — Load, validate, and query built-in model profiles.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type ProfileData, validateProfile } from "./profile-types.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type HardwareMatch = "compatible" | "partial" | "incompatible";

export type HardwareMatchResult = {
  status: HardwareMatch;
  reasons: string[];
};

export type SystemInfo = {
  os: string;
  cpu: string;
  ramGb: number;
  gpuName?: string;
  vramGb?: number;
  hasGpu: boolean;
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  installedModels: string[];
  apiProviders: Record<string, { configured: boolean; hasKey: boolean }>;
};

// ─── Registry ──────────────────────────────────────────────────────────

let _profiles: ProfileData[] | null = null;

/** Reset the profile cache. Call when profiles change at runtime or between tests. */
export function resetProfileCache(): void {
  _profiles = null;
}

/** Get the directory containing profile JSON files (dist/ or src/ fallback). */
function profilesDir(): string {
  const distDir = join(dirname(fileURLToPath(import.meta.url)), "profiles");
  const srcDir = join(process.cwd(), "src", "config", "profiles");
  return existsSync(distDir) ? distDir : srcDir;
}

/** Load all built-in profiles from disk. Validates each at load time. */
export function loadProfiles(): ProfileData[] {
  if (_profiles) return _profiles;
  const dir = profilesDir();
  const profiles: ProfileData[] = [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    if (!validateProfile(raw)) {
      console.error(`[profile-registry] Skipping invalid profile: ${file}`);
      continue;
    }
    profiles.push(raw as ProfileData);
  }

  _profiles = profiles;
  return profiles;
}

/** Get all profiles. Returns empty array on error. */
export function listProfiles(): ProfileData[] {
  try {
    return loadProfiles();
  } catch {
    return [];
  }
}

/** Get a single profile by ID. */
export function getProfile(id: string): ProfileData | undefined {
  return listProfiles().find(p => p.id === id);
}

/** Check if a cloud profile has the required API keys. */
function hasApiKeysForProfile(profile: ProfileData, system: SystemInfo): boolean {
  const neededProviders = new Set(
    Object.values(profile.models).map(m => m.provider)
  );
  return Array.from(neededProviders).every(p => system.apiProviders[p]?.hasKey);
}

/** Check hardware compatibility for a single profile. Returns status + reasons. */
export function matchHardware(profile: ProfileData, system: SystemInfo): HardwareMatchResult {
  const reasons: string[] = [];

  // cloud-only profiles only care about API keys, never about GPU/RAM/Ollama
  if (profile.mode === "cloud-only") {
    if (!hasApiKeysForProfile(profile, system)) {
      const missing = [...new Set(Object.values(profile.models).filter(m => !system.apiProviders[m.provider]?.hasKey).map(m => m.provider))];
      reasons.push(`Missing API keys for: ${missing.join(", ")}`);
      return { status: "incompatible", reasons };
    }
    return { status: "compatible", reasons: ["API keys configured"] };
  }

  const hw = profile.hardware;

  if (system.ramGb < hw.minRamGb) {
    reasons.push(`Requires ${hw.minRamGb} GB RAM (detected ${system.ramGb} GB)`);
    return { status: "incompatible", reasons };
  }
  if (hw.requiresGpu && !system.hasGpu) {
    reasons.push("Requires GPU — none detected");
    return { status: "incompatible", reasons };
  }
  if (hw.minVramGb > 0 && (system.vramGb ?? 0) < hw.minVramGb) {
    reasons.push(`Requires ${hw.minVramGb} GB VRAM (detected ${system.vramGb ?? 0} GB)`);
    return { status: "incompatible", reasons };
  }

  if (profile.mode === "local-first") {
    if (!system.ollamaInstalled) { reasons.push("Ollama not installed"); return { status: "partial", reasons }; }
    if (!system.ollamaRunning) { reasons.push("Ollama is installed but not running"); return { status: "partial", reasons }; }
  }

  if (profile.mode === "cloud-first") {
    if (!hasApiKeysForProfile(profile, system)) {
      const missing = [...new Set(Object.values(profile.models).filter(m => !system.apiProviders[m.provider]?.hasKey).map(m => m.provider))];
      reasons.push(`Missing API keys for: ${missing.join(", ")}`);
      return { status: "incompatible", reasons };
    }
    reasons.push("API keys configured");
  }

  if (system.ramGb < hw.recommendedRamGb) {
    reasons.push(`RAM ${system.ramGb} GB is below recommended ${hw.recommendedRamGb} GB`);
    return { status: "partial", reasons };
  }

  reasons.push("Meets all hardware requirements");
  return { status: "compatible", reasons };
}
