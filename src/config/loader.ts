import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir as realHomedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { AlixConfig } from "./schema.js";

// Test seam — allows tests to override homedir without touching the real OS module
let homedirOverride: string | undefined;
export function _setHomedirOverride(path: string | undefined): void { homedirOverride = path; }
function homedir(): string { return homedirOverride ?? realHomedir(); }

type PartialConfig = Partial<AlixConfig> & {
  model?: Partial<AlixConfig["model"]>;
  permissions?: Partial<AlixConfig["permissions"]>;
  context?: Partial<AlixConfig["context"]>;
  runtime?: Partial<AlixConfig["runtime"]>;
  ui?: Partial<AlixConfig["ui"]>;
};

// Load config from user home (~/.config/alix/config.json) and project (.alix/config.json).
// Precedence: defaults → user config → project config
// API keys from config are injected as environment variables.
export async function loadConfig(cwd: string): Promise<AlixConfig> {
  const userConfigPath = join(homedir(), ".config", "alix", "config.json");
  const projectConfigPath = join(cwd, ".alix", "config.json");

  const userConfig = existsSync(userConfigPath) ? await readJson(userConfigPath) : {};
  const projectConfig = existsSync(projectConfigPath) ? await readJson(projectConfigPath) : {};

  // Inject API keys as env vars so providers pick them up
  const apiKeys = { ...(userConfig as any).apiKeys, ...(projectConfig as any).apiKeys };
  for (const [provider, key] of Object.entries(apiKeys)) {
    const envVar = `${provider.toUpperCase()}_API_KEY`;
    if (typeof key === "string" && key && !process.env[envVar]) {
      process.env[envVar] = key;
    }
  }

  return mergeConfig(DEFAULT_CONFIG, userConfig as PartialConfig, projectConfig as PartialConfig);
}

async function readJson(path: string): Promise<PartialConfig> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as PartialConfig;
}

export function mergeConfig(
  base: AlixConfig,
  ...overrides: PartialConfig[]
): AlixConfig {
  let result = base;
  for (const override of overrides) {
    if (!override) continue;
    result = {
      ...result,
      ...override,
      model: { ...result.model, ...override.model },
      permissions: {
        ...result.permissions,
        ...override.permissions,
        tools: { ...result.permissions.tools, ...override.permissions?.tools },
        protectedPaths: mergeUnique(result.permissions.protectedPaths, override.permissions?.protectedPaths ?? [])
      },
      context: { ...result.context, ...override.context },
      runtime: { ...result.runtime, ...override.runtime },
      ui: { ...result.ui, ...override.ui }
    };
  }
  return result;
}

function mergeUnique<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}