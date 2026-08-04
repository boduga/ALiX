import type { SkillSafetyConfig } from "../config/schema.js";

export interface LoadedSkillSafetyConfig {
  requireConfirmation: boolean;
  scanScripts: boolean;
  denyNetwork: boolean;
  sandboxTimeoutMs: number;
  /** DANGEROUS_SHELL_PATTERNS codes the operator has acknowledged (skip warning). */
  ignoreWarningPatterns: string[];
  /** Fail `alix skills run` when network isolation is requested but unavailable. */
  requireNetworkIsolation: boolean;
}

/**
 * Best-effort read of `skills.safety` config; defaults to safe values on
 * failure. Shared by the skills install gate (install.ts) and the sandboxed
 * runner (run-skill.ts) so neither pulls the other's module graph.
 */
export async function loadSafetyConfig(): Promise<LoadedSkillSafetyConfig> {
  try {
    const { loadConfig } = await import("../config/loader.js");
    const config = await loadConfig(process.cwd());
    const safety: SkillSafetyConfig | undefined = config.skills?.safety;
    return {
      requireConfirmation: safety?.requireConfirmation ?? true,
      scanScripts: safety?.scanScripts ?? true,
      denyNetwork: safety?.denyNetwork ?? true,
      sandboxTimeoutMs: safety?.sandboxTimeoutMs ?? 30_000,
      ignoreWarningPatterns: safety?.ignoreWarningPatterns ?? [],
      requireNetworkIsolation: safety?.requireNetworkIsolation ?? false,
    };
  } catch {
    return {
      requireConfirmation: true,
      scanScripts: true,
      denyNetwork: true,
      sandboxTimeoutMs: 30_000,
      ignoreWarningPatterns: [],
      requireNetworkIsolation: false,
    };
  }
}
