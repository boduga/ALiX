import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir as realHomedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { AlixConfig, DerivedSubagentConfig, McpServerConfig, ModelConfig, ModelTier, ModelTierConfig, SubagentConfig } from "./schema.js";
import { isValidModelConfig, MODEL_SUBAGENT_TIERS, seedLegacyModelDefault } from "./schema.js";
import { NO_MODEL_CONFIGURED_MESSAGE } from "./model-resolver.js";
import { validateConfig } from "./validator.js";
import { CredentialStore } from "../security/credentials/credential-store.js";
import { chooseBackend, loadCredentialStoreWithKeychainFallback } from "../security/credentials/backend-selection.js";
import { isCredentialReference, resolveCredential } from "../security/credentials/credential-reference.js";
import { ConfigSigner, type TrustReport } from "./signing.js";
import { ConfigMutationService } from "./mutation.js";

function getEnvTier(name: (typeof MODEL_SUBAGENT_TIERS)[number]): Partial<ModelTierConfig> | undefined {
  const provider = process.env[`ALIX_${name.toUpperCase()}_PROVIDER`];
  const model = process.env[`ALIX_${name.toUpperCase()}_MODEL`];
  if (provider || model) {
    return { ...(provider ? { provider: provider as string } : {}), ...(model ? { name: model } : {}) };
  }
  return undefined;
}

/**
 * Single-source model normalization (§5.2–§5.5 of the plan).
 *
 * Mutates the runtime config object only — it never writes to disk. The loader
 * is the only projector; writers and resolvers must not call this.
 *
 * - Seeds `models.default` from the legacy `model` projection only when no
 *   canonical default exists yet (an invalid-but-present `models.default`
 *   still wins — legacy never replaces an existing key).
 * - Re-derives `model` as a shallow clone of a valid `models.default`.
 * - Re-derives ONLY the six canonical `subagents.<tier>` keys from
 *   `models[tier] ?? models.default`, preserving `enabled`/`roles` (behavior
 *   config) and dropping stale/non-canonical tier keys.
 */
export function normalizeModelConfig(config: Partial<AlixConfig>): void {
  // §5.2 Legacy migration — legacy `model` seeds `models.default` only when no
  // canonical default exists (key presence wins, even if the value is invalid).
  seedLegacyModelDefault(config);

  // §5.3 Projection — `model` derives from a valid `models.default`.
  const canonicalDefault = config.models?.default;
  config.model = isValidModelConfig(canonicalDefault) ? { ...canonicalDefault } : undefined;

  // §5.4 + §2.8.1 Projection — derive only the six canonical subagent tiers,
  // preserving `enabled`/`roles` behavior config and dropping stale keys.
  const existing = config.subagents;
  const projectedTiers: DerivedSubagentConfig = {};
  let anyResolved = false;
  for (const tier of MODEL_SUBAGENT_TIERS) {
    const source = config.models?.[tier] ?? config.models?.default;
    if (isValidModelConfig(source)) {
      projectedTiers[tier] = { ...source };
      anyResolved = true;
    }
  }
  const hasBehaviorConfig =
    existing !== undefined &&
    (existing.enabled !== undefined || existing.roles !== undefined);
  if (anyResolved || hasBehaviorConfig) {
    config.subagents = {
      enabled: existing?.enabled ?? DEFAULT_CONFIG.subagents!.enabled,
      roles: existing?.roles ?? DEFAULT_CONFIG.subagents!.roles,
      ...projectedTiers,
    };
  } else {
    // Preserve the distinction between "no model config" and "model config
    // exists but no valid subagent projection exists".
    config.subagents = undefined;
  }
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
  modelTiers?: Partial<Record<Exclude<ModelTier, "default">, Partial<ModelTierConfig>>>;
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
  /** Enable config trust evaluation (signature verification + anti-rollback). */
  trustEvaluation?: boolean | LoadConfigTrustOptions;
};

export type LoadConfigTrustOptions = {
  /** If true, trust failures are fatal errors (default: false = warnings only). */
  productionMode?: boolean;
  /** PEM-encoded trusted public key for signature verification. */
  publicKeyPem?: string;
  /** Path to the anti-rollback version stamp. */
  stampPath?: string;
};

/**
 * Extended config type that carries a trust report when trust evaluation is enabled.
 */
export type TrustedAlixConfig = AlixConfig & {
  /** Trust evaluation report, populated when trustEvaluation is enabled. */
  _trustReport?: TrustReport;
};

/**
 * The project-local ALiX directory (`<cwd>/.alix/`). This is the canonical
 * single source of truth for the project-scoped ALiX state — config.json,
 * config.sig, provenance.jsonl, and any future per-project files all live
 * here. Use this helper instead of inlining `join(cwd, ".alix")` so the
 * path convention lives in one place; a future change to nested-vs-flat
 * layout (e.g. a per-machine subdir) is a one-line edit instead of a
 * Shotgun-Surgery search-and-replace.
 */
export function projectConfigDir(cwd: string): string {
  return join(cwd, ".alix");
}

export async function loadConfig(cwd: string, options: LoadConfigOptions = {}): Promise<AlixConfig> {
  const userConfigPath = join(homedir(), ".config", "alix", "config.json");
  const projectConfigDirResolved = projectConfigDir(cwd);
  const projectConfigPath = join(projectConfigDirResolved, "config.json");

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
        // Honor the active backend selector (issue #350, Phase 2): after
        // `alix credential migrate --to keychain` scrubs the plain-file
        // store, loadConfig MUST read the keychain backend or the cred://
        // references resolve to nothing. Still lazy — the keychain binding
        // resolves inside the provider's load(), never at module import.
        // A missing keychain daemon falls back to plain-file (constraint
        // #3) via the shared helper.
        const backend = await chooseBackend();
        credentialStore = await loadCredentialStoreWithKeychainFallback(
          backend,
          (msg) => console.warn(`During config load: ${msg}`),
        );
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

  // Streaming default/override lands on `models.default` (authoritative, §2.8.3)
  // so the `model` projection below reflects it. Falls back to the legacy
  // `model` when no canonical default exists yet — normalizeModelConfig seeds
  // `models.default` from the legacy model, carrying the flag through.
  if (process.env.ALIX_STREAMING !== undefined) {
    const streaming = process.env.ALIX_STREAMING !== "false" && process.env.ALIX_STREAMING !== "0";
    if (result.models?.default) {
      result.models.default.streaming = streaming;
    } else if (result.model) {
      result.model.streaming = streaming;
    }
  } else if (result.models?.default && result.models.default.streaming === undefined) {
    // Streaming is the default in any local context (TTY or piped); an
    // explicit config `model.streaming: false` remains the opt-out, and
    // initAgent's shouldAutoDisableStreaming() (= isCI) turns it off in CI
    // so CI logs stay deterministic. Without this default, `runTaskLoop`
    // treats undefined as `?? false` and nothing ever streams.
    result.models.default.streaming = true;
  } else if (result.model && result.model.streaming === undefined) {
    result.model.streaming = true;
  }

  // Single-source model normalization: seed `models.default` from any legacy
  // `model`, then re-derive the `model`/`subagents` compatibility projections
  // from `models`. The loader is the only projector.
  normalizeModelConfig(result);

  // Validate that a model is configured — no hardcoded defaults
  if (options.requireModel !== false && (!result.model?.provider || !result.model?.name)) {
    throw new Error(
      `${NO_MODEL_CONFIGURED_MESSAGE}\n` +
      "Example: alix models set-default deepseek deepseek-v4-flash\n" +
      "Or run: alix models doctor"
    );
  }

  const validation = validateConfig(result);
  if (validation.issues.length > 0) {
    for (const issue of validation.issues) {
      const prefix = issue.level === "error" ? "ERROR" : "WARN";
      console.warn(`[Config ${prefix}] ${issue.path}: ${issue.message}`);
    }
  }

  // Trust evaluation: signature verification + anti-rollback
  const trustOpts = options.trustEvaluation;
  if (trustOpts) {
    const productionMode = typeof trustOpts === "object" ? (trustOpts.productionMode ?? false) : false;
    const publicKeyPem = typeof trustOpts === "object" ? (trustOpts.publicKeyPem ?? null) : null;
    const stampPath = typeof trustOpts === "object" ? (trustOpts.stampPath ?? undefined) : undefined;

    const projectConfigDirResolved = projectConfigDir(cwd);
    let configVersion = 0;
    try {
      if (existsSync(projectConfigDirResolved)) {
        const mutationService = new ConfigMutationService(projectConfigDirResolved);
        configVersion = await mutationService.getVersion();
      }
    } catch {
      // Version read is best-effort
    }

    const trustReport = await ConfigSigner.evaluateTrust(
      projectConfigDirResolved,
      publicKeyPem,
      configVersion,
      productionMode,
    );

    // P4.4c: Record trust evaluation evidence (best-effort)
    try {
      const { ConfigTrustHistory } = await import("../security/evidence/config-trust-history.js");
      const history = new ConfigTrustHistory();
      await history.recordTrustEvaluation(trustReport, configVersion);
    } catch {
      // Evidence recording must never block config loading
    }

    // Store the trust report on the config for access by callers
    (result as TrustedAlixConfig)._trustReport = trustReport;

    // Emit issues
    for (const issue of trustReport.issues) {
      const prefix = issue.severity === "error" ? "ERROR" : "WARN";
      console.warn(`[Config Trust ${prefix}] ${issue.code}: ${issue.message}`);
    }

    // Fail closed in production mode
    if (!trustReport.trusted && productionMode) {
      const errors = trustReport.issues.filter((i) => i.severity === "error");
      throw new Error(
        `Config trust evaluation failed (production mode). ` +
        errors.map((e) => `${e.code}: ${e.message}`).join("; "),
      );
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
      models: { ...(result.models ?? {}), ...(override.models ?? {}) },
      subagents: { ...(result.subagents ?? DEFAULT_CONFIG.subagents) } as SubagentConfig,
    };
    // Apply config-file modelTiers overrides to the canonical `models` object
    // (authoritative) instead of the subagents projection (§2.8.2). This runs
    // inside the override loop so config precedence works (later configs win).
    const modelTiers = override.modelTiers;
    if (modelTiers) {
      for (const tier of MODEL_SUBAGENT_TIERS) {
        const tierOverride = modelTiers[tier];
        if (tierOverride) {
          result.models = {
            ...(result.models ?? {}),
            [tier]: { ...result.models?.[tier], ...tierOverride },
          };
        }
      }
    }
    // Apply env var overrides for model tiers (highest priority) → models.<tier>
    for (const tier of MODEL_SUBAGENT_TIERS) {
      const envOverride = getEnvTier(tier);
      if (envOverride) {
        result.models = {
          ...(result.models ?? {}),
          [tier]: { ...(result.models?.[tier] ?? { provider: "", name: "" }), ...envOverride },
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