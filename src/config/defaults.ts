import { homedir } from "node:os";
import type { AlixConfig } from "./schema.js";

export const DEFAULT_CONFIG: AlixConfig = {
  version: 1,
  model: {
    provider: "anthropic",
    name: "claude-sonnet-4-6",
    temperature: 0.2,
    streaming: true
  },
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
    host: "0.0.0.0",
    port: 4137,
    transport: "sse"
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
      { role: "explorer",         mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      { role: "reviewer",          mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      { role: "test_investigator", mode: "read_only", retryCount: 1 },
      { role: "docs_researcher",   mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      { role: "worker",            mode: "write",     retryCount: 0 },
    ],
  }
};
