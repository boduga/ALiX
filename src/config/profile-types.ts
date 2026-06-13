/**
 * profile-types.ts — TypeScript types + runtime validation for model profiles.
 *
 * validateProfile() is a type guard used at load time to reject malformed
 * JSON profiles. It checks all known fields strictly.
 */

export type ModelTier =
  | "default"
  | "planner"
  | "researcher"
  | "coder"
  | "critic"
  | "embeddings";

export type ProfileMode = "local-first" | "cloud-first" | "cloud-only";

export type ProfileModel = {
  provider: string;
  name: string;
  temperature?: number;
  contextWindow?: number;
};

export type ProfileHardware = {
  minRamGb: number;
  recommendedRamGb: number;
  requiresGpu: boolean;
  minVramGb: number;
};

export type ProfileFallbacks = {
  enabled: boolean;
  local?: { provider: string; name: string };
  cloud?: { provider: string; name: string };
};

export type ProfileRuntime = {
  maxConcurrentAgents?: number;
  maxContextTokens?: number;
  toolMode?: string;
  shellMode?: string;
  localModelsRequired?: boolean;
  ollamaRequired?: boolean;
};

export type ProfileInstall = {
  ollamaPull?: string[];
};

export type ProfileData = {
  id: string;
  name: string;
  description: string;
  mode: ProfileMode;
  hardware: ProfileHardware;
  models: Partial<Record<ModelTier, ProfileModel>>;
  fallbacks?: ProfileFallbacks;
  runtime?: ProfileRuntime;
  install?: ProfileInstall;
};

const VALID_MODES = new Set(["local-first", "cloud-first", "cloud-only"]);
const VALID_TIERS = new Set(["default", "planner", "researcher", "coder", "critic", "embeddings"]);

/** Runtime validation: ensure a loaded profile matches ProfileData shape. */
export function validateProfile(raw: unknown): raw is ProfileData {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;

  if (typeof p.id !== "string" || !p.id) return false;
  if (typeof p.name !== "string" || !p.name) return false;
  if (!VALID_MODES.has(p.mode as string)) return false;

  // Validate hardware
  if (!p.hardware || typeof p.hardware !== "object") return false;
  const hw = p.hardware as Record<string, unknown>;
  if (typeof hw.minRamGb !== "number" || hw.minRamGb < 0) return false;
  if (typeof hw.recommendedRamGb !== "number") return false;
  if (typeof hw.requiresGpu !== "boolean") return false;
  if (typeof hw.minVramGb !== "number" || hw.minVramGb < 0) return false;

  // Validate models — only known tier keys allowed, each with valid entry
  if (!p.models || typeof p.models !== "object") return false;
  for (const key of Object.keys(p.models)) {
    if (!VALID_TIERS.has(key)) return false;          // reject typos like "planer"
    const entry = (p.models as Record<string, unknown>)[key];
    if (!entry || typeof entry !== "object") return false;
    const m = entry as Record<string, unknown>;
    if (typeof m.provider !== "string" || !m.provider) return false;
    if (typeof m.name !== "string" || !m.name) return false;
    if (m.temperature !== undefined && typeof m.temperature !== "number") return false;
    if (m.contextWindow !== undefined && typeof m.contextWindow !== "number") return false;
  }

  // Validate fallbacks if present
  if (p.fallbacks !== undefined) {
    if (typeof p.fallbacks !== "object") return false;
    const fb = p.fallbacks as Record<string, unknown>;
    if (typeof fb.enabled !== "boolean") return false;
    for (const side of ["local", "cloud"] as const) {
      if (fb[side] !== undefined) {
        if (typeof fb[side] !== "object") return false;
        const e = fb[side] as Record<string, unknown>;
        if (typeof e.provider !== "string" || typeof e.name !== "string") return false;
      }
    }
  }

  // Validate install.ollamaPull if present
  if (p.install !== undefined) {
    if (typeof p.install !== "object") return false;
    const inst = p.install as Record<string, unknown>;
    if (inst.ollamaPull !== undefined) {
      if (!Array.isArray(inst.ollamaPull)) return false;
      if (!inst.ollamaPull.every((m: unknown) => typeof m === "string")) return false;
    }
  }

  return true;
}
