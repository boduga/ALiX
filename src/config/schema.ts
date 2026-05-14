export type Decision = "ask" | "allow" | "deny";

export type ModelConfig = {
  provider: "mock" | "anthropic" | "openai" | "google" | "openrouter" | "groq" | "ollama" | "perplexity" | "minimax" | "zhipuai" | "grokai" | "deepseek" | "local";
  name: string;
  temperature?: number;
  maxOutputTokens?: number;
};

export type PermissionConfig = {
  default: Decision;
  tools: Record<string, Decision>;
  protectedPaths: string[];
  allowNetworkDomains: string[];
  denyCommands: string[];
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
