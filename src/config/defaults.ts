import { homedir } from "node:os";
import type { AlixConfig } from "./schema.js";

export const DEFAULT_CONFIG: AlixConfig = {
  version: 1,
  model: undefined as any,
  permissions: {
    default: "ask",
    tools: {
      "file.read": "allow",
      "file.write": "ask",
      "shell.run": "ask",
      "git.diff": "allow"
    },
    protectedPaths: [".git/**", ".env", ".env.*", "secrets/**"],
    allowNetworkDomains: [],
    denyCommands: ["rm -rf /", "git push --force"],
    sessionMode: "ask"
  },
  context: {
    repoMap: true,
    repoMapMode: "lite",
    maxRepoMapTokens: 4000,
    semanticSearch: false,
    includeGitStatus: true,
    pinnedFiles: []
  },
  runtime: {
    provider: "process",
    shell: "bash",
    commandTimeoutMs: 120000,
    envAllowlist: ["PATH", "HOME", "SHELL"]
  },
  ui: {
    enabled: true,
    host: "127.0.0.1",
    port: 4137,
    transport: "sse",
    security: {
      authentication: "disabled-loopback-development",
      remoteAccess: false,
      allowedHosts: ["127.0.0.1", "::1", "localhost"],
      allowedOrigins: [],
      trustedProxyCidrs: [],
      requireTlsForRemote: true,
    }
  },
  mcpServers: [
    {
      type: "stdio",
      name: "fetch",
      command: "uvx",
      args: ["mcp-server-fetch"]
    }
  ],
  mcpServerPaths: [],
  skills: {
    factory: {
      enabled: false,
      provider: "ollama",
      model: "llama3",
      maxStore: 50,
      maxCandidates: 20,
      autoPromote: false
    },
    store: {
      enabled: true,
      path: `${homedir()}/.alix/skills`
    }
  },
  extensions: {
    store: {
      enabled: true,
      path: `${homedir()}/.alix/extensions`
    }
  },
  subagents: {
    enabled: true,
    roles: [
      { role: "explorer",         mode: "read_only", style: "fast", retryCount: 1 },
      { role: "reviewer",          mode: "read_only", style: "critic", retryCount: 1 },
      { role: "test_investigator", mode: "read_only", style: "thinking", retryCount: 1 },
      { role: "docs_researcher",   mode: "read_only", style: "fast", retryCount: 1 },
      { role: "worker",            mode: "write",     style: "coding",  retryCount: 0 },
    ],
  },
  ownership: {
    enabled: true,
    autoAcquire: true,
    defaultTtlMs: 30 * 60 * 1000,
    historyRetentionDays: 30,
  },
};

/**
 * Permissive test config that allows all tool operations.
 * Bypasses PolicyGate to test routing logic, not approval workflows.
 */
export const PERMIT_ALL_CONFIG: AlixConfig = {
  ...DEFAULT_CONFIG,
  model: { provider: "test", name: "test-model" },
  permissions: {
    ...DEFAULT_CONFIG.permissions,
    default: "allow",
    sessionMode: "bypass",
    tools: {
      "file.read": "allow",
      "file.write": "allow",
      "shell.run": "allow",
      "git.diff": "allow",
    },
  },
};
