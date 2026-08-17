import type { ContextBudgetConfig } from "./context-budget.js";

export type SessionMode = "auto" | "ask" | "bypass";

export type Decision = "ask" | "allow" | "deny";

export type ModelConfig = {
  provider: string;
  name: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxContextTokens?: number;
  maxIterations?: number;
  streaming?: boolean;
};

/**
 * Canonical configuration tier vocabulary.
 *
 * This is the single runtime/type source of truth for configuration tiers.
 * The profile vocabulary (ProfileModelTier in profile-types.ts) is a
 * distinct, mapped vocabulary — see PROFILE_TIER_MAP for the only bridge.
 */
export const MODEL_TIER_VALUES = [
  "default",
  "thinking",
  "coding",
  "fast",
  "critic",
  "tiny",
  "image",
] as const;

export type ModelTier = typeof MODEL_TIER_VALUES[number];

/**
 * The six non-default subagent tiers. `default` is represented by the
 * `model` projection, therefore only these six appear under `subagents`.
 */
export const MODEL_SUBAGENT_TIERS = [
  "thinking",
  "coding",
  "fast",
  "critic",
  "tiny",
  "image",
] as const;

export type ModelsConfig =
  Partial<Record<ModelTier, ModelConfig>>;

/**
 * Loader-owned compatibility projection.
 *
 * `default` is represented by `model`, therefore only the six
 * non-default tiers appear here.
 */
export type DerivedSubagentConfig =
  Partial<
    Record<Exclude<ModelTier, "default">, ModelConfig>
  >;

/**
 * Boundary validator — is this arbitrary string a canonical configuration
 * tier?
 *
 * Used only at external boundaries: CLI arguments, config-file values, and
 * other arbitrary strings. `resolveModelConfig()` does not need this check
 * because its API accepts `ModelTier`.
 */
export function isModelTier(
  value: string,
): value is ModelTier {
  return (
    MODEL_TIER_VALUES as readonly string[]
  ).includes(value);
}

/**
 * Validity predicate for a resolved model — a model is usable only when it
 * names both a provider and a model.
 *
 * Shared by the loader projection (`normalizeModelConfig`) and
 * `resolveModelConfig()` so both agree on what counts as "configured".
 * Lives in schema.ts next to `isModelTier` so the resolver stays a pure,
 * dependency-light module (runtime readers that import it do not transitively
 * pull the loader, signing, or credential-store modules).
 */
export function isValidModelConfig(
  model: ModelConfig | undefined,
): model is ModelConfig {
  return (
    model !== undefined &&
    typeof model.provider === "string" &&
    model.provider.length > 0 &&
    typeof model.name === "string" &&
    model.name.length > 0
  );
}

/**
 * §5.2 legacy migration — seed `models.default` from a legacy `model` when no
 * canonical default exists (key presence wins, even if the value is invalid).
 *
 * Shared by the loader (`normalizeModelConfig`, in-memory on load) and the
 * persistence boundary (`withoutDerivedModelProjections`, before a write) so
 * the two sites cannot drift and stripping a projection never destroys the
 * user's only model assignment. Mutates `config` in place.
 */
export function seedLegacyModelDefault(config: Partial<AlixConfig>): void {
  if (config.models?.default === undefined && isValidModelConfig(config.model)) {
    config.models = { ...(config.models ?? {}), default: { ...config.model } };
  }
}

export type PermissionConfig = {
  default: Decision;
  tools: Record<string, Decision>;
  protectedPaths: string[];
  allowNetworkDomains: string[];
  denyCommands: string[];
  sessionMode?: SessionMode; // "auto" | "ask" | "bypass", defaults to "ask"
  shellWhitelist?: {
    enabled: boolean;
    commands: string[];
    allowUnmatched?: boolean;  // true = approval, false = deny
  };
};

export type ContextConfig = {
  repoMap: boolean;
  repoMapMode: "lite" | "full";
  maxRepoMapTokens: number;
  semanticSearch: boolean;
  includeGitStatus: boolean;
  pinnedFiles: string[];
  /** C0/C1 reserved-output reservation knobs (B; defaults 0.20 / 4,096 / 32,768). */
  budget?: ContextBudgetConfig;
};

export type RuntimeConfig = {
  provider: "process" | "docker" | "remote";
  shell: string;
  commandTimeoutMs: number;
  envAllowlist: string[];
};

export type UiConfig = {
  enabled: boolean;
  host: string;
  port: number;
  transport: "sse" | "websocket";
  security?: UiSecurityConfig;
};

export type UiSecurityConfig = {
  authentication: "required" | "disabled-loopback-development";
  remoteAccess: boolean;
  allowedHosts: string[];
  allowedOrigins: string[];
  trustedProxyCidrs: string[];
  requireTlsForRemote: boolean;
};

export type McpTransportType = "stdio" | "http" | "websocket";

export type McpServerConfig =
  | { type: "stdio"; name: string; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "http"; name: string; url: string; headers?: Record<string, string> }
  | { type: "websocket"; name: string; url: string; headers?: Record<string, string> };

export type SkillFactoryConfig = {
  enabled: boolean;
  provider: string;
  model: string;
  maxStore: number;
  maxCandidates: number;
  autoPromote: boolean;
};

export type SkillStoreConfig = {
  enabled: boolean;
  path: string;
};

export type SkillSafetyConfig = {
  /** Require explicit confirmation for non-core skill installs (default true). */
  requireConfirmation?: boolean;
  /** Scan package scripts for denied files/secrets before install (default true). */
  scanScripts?: boolean;
  /** `alix skills run` blocks network access (best-effort; default true). */
  denyNetwork?: boolean;
  /** Timeout in ms for `alix skills run` (default 30000). */
  sandboxTimeoutMs?: number;
  /**
   * DANGEROUS_SHELL_PATTERNS codes to skip during the pre-install script scan
   * (operator-acknowledged as reviewed). Default [] — every warning fires until
   * explicitly acknowledged. Never suppresses deny-level verifier findings.
   */
  ignoreWarningPatterns?: string[];
  /**
   * When true, `alix skills run` refuses to execute if network isolation was
   * requested (`denyNetwork`) but could not be established (unshare missing /
   * user namespaces blocked). Default false — falls back to env-only isolation
   * with a prominent warning.
   */
  requireNetworkIsolation?: boolean;
};

export type ExtensionStoreConfig = {
  enabled: boolean;
  path: string;
};

export type SubagentRole = "auto" | "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker" | "researcher";

export type SubagentRoleConfig = {
  role: SubagentRole;
  mode: "read_only" | "write";
  style?: SubagentStyle;  // references MODEL_TIERS bucket
  retryCount?: number;
  enabled?: boolean;
};

export type SubagentStyle = "thinking" | "coding" | "fast" | "critic" | "tiny" | "image";

export type ToolReliabilityTier = "stable" | "unstable" | "experimental";

export type ModelToolReliability = {
  modelPattern: string;  // regex pattern to match model name
  tier: ToolReliabilityTier;
  defaultMaxTools: number;
  preferKeywordScoring: boolean;
};

export type ToolConfig = {
  maxTools: number;
  tokenBudget: number;
  reliabilityDefaults: ModelToolReliability[];
};

export type ModelTierConfig = {
  provider: string;
  name: string;
};

export type SubagentConfig = {
  enabled: boolean;
  thinking?: ModelTierConfig;  // Strategic reasoning, planning, complex logic
  coding?: ModelTierConfig;     // Code generation, tool execution, patches
  fast?: ModelTierConfig;       // Quick classification, routing, simple tasks
  critic?: ModelTierConfig;     // Verification, validation, hallucination checks
  tiny?: ModelTierConfig;       // Embeddings, reranking, memory compression, intent
  image?: ModelTierConfig;     // Image generation, multimodal analysis
  roles: SubagentRoleConfig[];
};

export type SubagentTask = {
  id: string;
  role: SubagentRole;
  prompt: string;
  mode: "read_only" | "write";
  ownedPaths?: string[];
  expectedOutput?: string;
  contextBundle?: string; // serialized context from ContextCompiler
};

export type SubagentResult = {
  id: string;
  role: SubagentRole;
  status: "success" | "failed" | "rejected" | "partial";
  findings: SubagentFinding[];
  events: string[]; // serialized session events
  error?: string;
};

export type SubagentFinding = {
  type: "file_ref" | "code_location" | "summary" | "risk_flag" | "web_source" | "synthesis";
  content: string;
  confidence: "high" | "medium" | "low";
  refs?: string[];
};

export type WebSourceFinding = {
  type: "web_source";
  content: string;
  url: string;
  title: string;
  confidence: "high" | "medium" | "low";
  refs?: string[];
};

export type SynthesisFinding = {
  type: "synthesis";
  content: string;
  sources: string[];
  confidence: "high" | "medium" | "low";
};

/**
 * AlixConfig — the runtime configuration shape.
 *
 * Persisted (single source of truth on disk):
 *   models, modelProfile, apiKeys, all other persisted configuration.
 *
 * Runtime-only compatibility projections (produced exclusively by
 * loadConfig(), never independently persisted):
 *   model, subagents
 *
 * apiKeys remains independent and is never coupled to model selection.
 */
export type AlixConfig = {
  version: 1;
  model: ModelConfig;
  permissions: PermissionConfig;
  context: ContextConfig;
  runtime: RuntimeConfig;
  ui: UiConfig;
  apiKeys?: Record<string, string>;
  mcpServers?: McpServerConfig[];
  mcpServerPaths?: string[];
  skills?: {
    factory?: SkillFactoryConfig;
    store?: SkillStoreConfig;
    safety?: SkillSafetyConfig;
  };
  extensions?: {
    store?: ExtensionStoreConfig;
  };
  subagents?: SubagentConfig;
  toolConfig?: ToolConfig;
  ownership?: {
    enabled?: boolean;
    autoAcquire?: boolean;
    defaultTtlMs?: number;
    historyRetentionDays?: number;
  };
  modelProfile?: string;
  models?: ModelsConfig;
};

/**
 * Nominal persistence brand for the persisted configuration representation.
 *
 * The brand is type-only: `declare const` emits nothing at runtime and the
 * unique-symbol computed property is erased, so it never appears in a
 * serialized config.json. A raw AlixConfig cannot structurally satisfy
 * PersistedAlixConfig — only after crossing `withoutDerivedModelProjections()`
 * is an object branded as persisted.
 */
declare const persistedConfigBrand: unique symbol;

/**
 * The only `subagents` content that may reach disk.
 *
 * §2.8.1/§2.8.4: `subagents` is a valid container of non-model subagent
 * *behavior* configuration — `enabled`/`roles` are preserved, never replaced —
 * but the six `<tier>` keys are loader-derived model-selection projections and
 * must never be independently written.
 */
export type PersistedSubagentConfig = {
  enabled?: boolean;
  roles?: SubagentRoleConfig[];
};

/**
 * Persisted configuration representation.
 *
 * `model` and the six `subagents.<tier>` keys (loader-derived compatibility
 * projections) are stripped; `models` is the single persistent source of model
 * assignments. `subagents.enabled`/`roles` are behavior config and may persist.
 */
export interface PersistedAlixConfig
  extends Omit<AlixConfig, "model" | "subagents"> {
  /** Behavior config only (enabled/roles); model-tier projections never persist. */
  subagents?: PersistedSubagentConfig;
  readonly [persistedConfigBrand]: true;
}

export type ValidationIssue = {
  path: string;
  level: "error" | "warning";
  message: string;
};

export type ConfigValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};
