export type SessionMode = "auto" | "ask" | "bypass";

export type Decision = "ask" | "allow" | "deny";

export type ModelConfig = {
  provider: "mock" | "anthropic" | "openai" | "google" | "openrouter" | "groq" | "ollama" | "perplexity" | "minimax" | "zhipuai" | "grokai" | "deepseek" | "local";
  name: string;
  temperature?: number;
  maxOutputTokens?: number;
  maxContextTokens?: number;
  maxIterations?: number;
  streaming?: boolean;
};

export type PermissionConfig = {
  default: Decision;
  tools: Record<string, Decision>;
  protectedPaths: string[];
  allowNetworkDomains: string[];
  denyCommands: string[];
  sessionMode?: SessionMode; // "auto" | "ask" | "bypass", defaults to "ask"
};

export type ContextConfig = {
  repoMap: boolean;
  repoMapMode: "lite" | "full";
  maxRepoMapTokens: number;
  semanticSearch: boolean;
  includeGitStatus: boolean;
  pinnedFiles: string[];
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

export type ExtensionStoreConfig = {
  enabled: boolean;
  path: string;
};

export type SubagentRole = "auto" | "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";

export type SubagentRoleConfig = {
  role: SubagentRole;
  mode: "read_only" | "write";
  style?: SubagentStyle;  // references MODEL_TIERS bucket
  retryCount?: number;
  enabled?: boolean;
};

export type SubagentStyle = "thinking" | "coding" | "fast" | "critic" | "tiny";

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
  provider: "mock" | "anthropic" | "openai" | "google" | "openrouter" | "groq" | "ollama" | "perplexity" | "minimax" | "zhipuai" | "grokai" | "deepseek";
  name: string;
};

export type SubagentConfig = {
  enabled: boolean;
  thinking: ModelTierConfig;  // Strategic reasoning, planning, complex logic
  coding: ModelTierConfig;     // Code generation, tool execution, patches
  fast: ModelTierConfig;       // Quick classification, routing, simple tasks
  critic: ModelTierConfig;     // Verification, validation, hallucination checks
  tiny: ModelTierConfig;       // Embeddings, reranking, memory compression, intent
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
  status: "success" | "failed" | "rejected";
  findings: SubagentFinding[];
  events: string[]; // serialized session events
  error?: string;
};

export type SubagentFinding = {
  type: "file_ref" | "code_location" | "summary" | "risk_flag";
  content: string;
  confidence: "high" | "medium" | "low";
  refs?: string[];
};

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
  };
  extensions?: {
    store?: ExtensionStoreConfig;
  };
  subagents?: SubagentConfig;
  toolConfig?: ToolConfig;
};

export type ValidationIssue = {
  path: string;
  level: "error" | "warning";
  message: string;
};

export type ConfigValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
};
