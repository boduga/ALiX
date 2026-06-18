import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir as realHomedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { AlixConfig, McpServerConfig, ModelTierConfig, SubagentConfig } from "./schema.js";
import { validateConfig } from "./validator.js";
import { CredentialStore } from "../security/credentials/credential-store.js";
import { isCredentialReference, resolveCredential } from "../security/credentials/credential-reference.js";

function getEnvTier(name: "thinking" | "coding" | "fast" | "critic" | "tiny" | "image"): Partial<ModelTierConfig> | undefined {
  const provider = process.env[`ALIX_${name.toUpperCase()}_PROVIDER`];
  const model = process.env[`ALIX_${name.toUpperCase()}_MODEL`];
  if (provider || model) {
    return { ...(provider ? { provider: provider as string } : {}), ...(model ? { name: model } : {}) };
  }
  return undefined;
}

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
  subagents?: SubagentConfig;
  modelTiers?: {
    thinking?: Partial<ModelTierConfig>;
    coding?: Partial<ModelTierConfig>;
    fast?: Partial<ModelTierConfig>;
  };
};

// Load config from two sources (in order of precedence):
// 1. ~/.config/alix/config.json   — user config (API keys, model settings, MCP servers)
// 2. <cwd>/.alix/config.json       — project config (overrides everything)
//
// API keys from config are injected as environment variables.
export { DEFAULT_CONFIG } from "./defaults.js";

export type LoadConfigOptions = {
  /** When true (default), throws if model.provider or model.name is missing */
  requireModel?: boolean;
  /** Override the credential store (for testing). When not provided, the default platform store is used. */
  credentialStore?: CredentialStore;
};

export async function loadConfig(cwd: string, options: LoadConfigOptions = {}): Promise<AlixConfig> {
  const userConfigPath = join(homedir(), ".config", "alix", "config.json");
  const projectConfigPath = join(cwd, ".alix", "config.json");

  const userConfig = existsSync(userConfigPath) ? await readJson(userConfigPath) : {};
  const projectConfig = existsSync(projectConfigPath) ? await readJson(projectConfigPath) : {};

  // Merge apiKeys from both configs (project overrides user)
  let apiKeys: Record<string, unknown> = {
    ...(userConfig as any).apiKeys,
    ...(projectConfig as any).apiKeys
  };

  // Resolve cred:// references in apiKeys before injecting as env vars
  const hasCredentialRefs = Object.values(apiKeys).some(
    (v) => typeof v === "string" && v.startsWith("cred://")
  );

  if (hasCredentialRefs) {
    let credentialStore: CredentialStore;
    if (options.credentialStore) {
      credentialStore = options.credentialStore;
    } else {
      try {
        credentialStore = new CredentialStore();
        await credentialStore.load();
      } catch (err) {
        throw new Error(
          "Credential store is unavailable. Config references 'cred://' but the credential " +
          "store could not be loaded. Check the credential store integrity or run " +
          `'alix credential list' for diagnostics. Details: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const resolvedApiKeys: Record<string, string> = {};
    for (const [provider, value] of Object.entries(apiKeys)) {
      if (typeof value === "string" && isCredentialReference(value)) {
        const resolved = resolveCredential(value, credentialStore);
        if (resolved === null) {
          throw new Error(
            `Credential not found for apiKeys.${provider}: ${value}. ` +
            `Store the credential with: alix credential set ${provider} apiKey <value>`
          );
        }
        resolvedApiKeys[provider] = resolved;
      } else if (typeof value === "string") {
        resolvedApiKeys[provider] = value;
      }
    }
    apiKeys = resolvedApiKeys;
  }

  // Inject resolved API keys as env vars so providers pick them up
  // Map provider names to their expected env var names
  const PROVIDER_ENV_MAP: Record<string, string> = {
    google: "GEMINI_API_KEY",
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    groq: "GROQ_API_KEY",
    perplexity: "PERPLEXITY_API_KEY",
    minimax: "MINIMAX_API_KEY",
    zhipuai: "ZHIPUAI_API_KEY",
    grokai: "GROKAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
  };
  for (const [provider, key] of Object.entries(apiKeys)) {
    const envVar = PROVIDER_ENV_MAP[provider] ?? `${provider.toUpperCase()}_API_KEY`;
    if (typeof key === "string" && key && !process.env[envVar]) {
      process.env[envVar] = key;
    }
  }

  // Collect modelTiers overrides from config files (user → project)
  const modelTiers: PartialConfig["modelTiers"] = {
    ...(userConfig as any).modelTiers,
    ...(projectConfig as any).modelTiers
  };

  const result = mergeConfig(
    DEFAULT_CONFIG,
    ...([userConfig, projectConfig] as PartialConfig[]),
    { modelTiers } as PartialConfig
  );

  // Override the result's apiKeys with resolved values
  if (hasCredentialRefs) {
    result.apiKeys = apiKeys as Record<string, string>;
  }

  if (process.env.ALIX_STREAMING !== undefined) {
    result.model.streaming = process.env.ALIX_STREAMING !== "false" && process.env.ALIX_STREAMING !== "0";
  }

  // Validate that a model is configured — no hardcoded defaults
  if (options.requireModel !== false && (!result.model?.provider || !result.model?.name)) {
    throw new Error(
      "No model configured. Run: alix config set-default-model\n" +
      "Example: alix config set-default-model deepseek deepseek-v4-flash\n" +
      "Or run: alix models doctor"
    );
  }

  // Fill unset subagent tiers from the main model
  const TIERS = ["thinking", "coding", "fast", "critic", "tiny", "image"] as const;
  for (const tier of TIERS) {
    if (!result.subagents?.[tier]) {
      if (!result.subagents) (result as any).subagents = {};
      (result.subagents as any)[tier] = {
        provider: result.model.provider,
        name: result.model.name,
      };
    }
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
      ui: {
        ...result.ui,
        ...override.ui,
        security: { ...result.ui?.security, ...override.ui?.security } as AlixConfig["ui"]["security"] | undefined,
      },
      mcpServers: normalizeMcpServers(
        override.mcpServers !== undefined ? override.mcpServers : result.mcpServers
      ),
      mcpServerPaths: mergeUnique(result.mcpServerPaths ?? [], override.mcpServerPaths ?? []),
      subagents: { ...(result.subagents ?? DEFAULT_CONFIG.subagents) } as SubagentConfig,
    };
    // Apply config-file modelTiers overrides to subagent tier configs
    // This runs inside the override loop so config precedence works (later configs win)
    const tiers: ("thinking" | "coding" | "fast" | "critic" | "tiny" | "image")[] = ["thinking", "coding", "fast", "critic", "tiny", "image"];
    if ((override as any).modelTiers) {
      for (const tier of tiers) {
        const tierOverride = (override as any).modelTiers[tier];
        if (tierOverride) {
          (result.subagents![tier] as ModelTierConfig) = {
            ...result.subagents![tier],
            ...tierOverride,
          };
        }
      }
    }
    // Apply env var overrides for model tiers (highest priority)
    for (const tier of tiers) {
      const envOverride = getEnvTier(tier);
      if (envOverride) {
        (result.subagents![tier] as ModelTierConfig) = {
          ...(result.subagents![tier] ?? { provider: "", name: "" }),
          ...envOverride,
        };
      }
    }
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