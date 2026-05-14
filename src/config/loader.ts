import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir as realHomedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { AlixConfig } from "./schema.js";
import { validateConfig } from "./validator.js";

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
  mcpServers?: Partial<AlixConfig["mcpServers"]>;
  mcpServerPaths?: string[];
};

// Load config from three sources (in order of precedence):
// 1. ~/.config/alix/config.json   — XDG user config (API keys, model settings)
// 2. ~/.alix/config.json          — global user config (MCP servers, permissions)
// 3. <cwd>/.alix/config.json     — project config (overrides everything)
//
// API keys from config are injected as environment variables.
export async function loadConfig(cwd: string): Promise<AlixConfig> {
  const xdgConfigPath = join(homedir(), ".config", "alix", "config.json");
  const globalConfigPath = join(homedir(), ".alix", "config.json");
  const projectConfigPath = join(cwd, ".alix", "config.json");

  const xdgConfig = existsSync(xdgConfigPath) ? await readJson(xdgConfigPath) : {};
  const globalConfig = existsSync(globalConfigPath) ? await readJson(globalConfigPath) : {};
  const projectConfig = existsSync(projectConfigPath) ? await readJson(projectConfigPath) : {};

  // Inject API keys as env vars so providers pick them up
  const apiKeys = {
    ...(xdgConfig as any).apiKeys,
    ...(globalConfig as any).apiKeys,
    ...(projectConfig as any).apiKeys
  };
  for (const [provider, key] of Object.entries(apiKeys)) {
    const envVar = `${provider.toUpperCase()}_API_KEY`;
    if (typeof key === "string" && key && !process.env[envVar]) {
      process.env[envVar] = key;
    }
  }

  const result = mergeConfig(DEFAULT_CONFIG, xdgConfig as PartialConfig, globalConfig as PartialConfig, projectConfig as PartialConfig);

  if (process.env.ALIX_STREAMING !== undefined) {
    result.model.streaming = process.env.ALIX_STREAMING !== "false" && process.env.ALIX_STREAMING !== "0";
  }

  const validation = validateConfig(result);
  if (validation.issues.length > 0) {
    for (const issue of validation.issues) {
      const prefix = issue.level === "error" ? "ERROR" : "WARN";
      console.warn(`[Config ${prefix}] ${issue.path}: ${issue.message}`);
    }
  }
  return result;
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
      ui: { ...result.ui, ...override.ui },
      mcpServers: normalizeMcpServers(
        override.mcpServers !== undefined ? override.mcpServers : result.mcpServers
      ),
      mcpServerPaths: mergeUnique(result.mcpServerPaths ?? [], override.mcpServerPaths ?? [])
    };
  }
  return result;
}

function mergeUnique<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}

// Normalize mcpServers: convert old `{ name: ..., type: ... }` map format to array format
function normalizeMcpServers(servers: AlixConfig["mcpServers"]): AlixConfig["mcpServers"] {
  if (!servers) return [];
  if (Array.isArray(servers)) return servers;
  // Convert Record<string, McpServerConfig> to array, injecting name from key
  return Object.entries(servers as Record<string, McpServerConfig>).map(([name, config]) => ({
    ...config,
    name
  }));
}