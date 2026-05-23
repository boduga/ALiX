import { homedir } from "node:os";
import type { AlixConfig } from "./schema.js";

export const MODEL_TIERS = {
  thinking: { provider: "ollama", name: "phi4-mini-reasoning" },  // Strategic reasoning, planning
  coding:   { provider: "ollama", name: "qwen2.5-coder:7b" },   // Code generation, tool execution
  fast:     { provider: "ollama", name: "llama3.2:3b" },          // Quick classification, routing
  critic:   { provider: "ollama", name: "llama3.2:3b" },         // Verification, validation (reused for MVP)
  tiny:     { provider: "ollama", name: "llama3.2:3b" },         // Embeddings, reranking, intent (reused for MVP)
} as const;

export const DEFAULT_CONFIG: AlixConfig = {
  version: 1,
  model: {
    provider: MODEL_TIERS.coding.provider,
    name: MODEL_TIERS.coding.name,
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
    thinking: { provider: "ollama", name: "phi4-mini-reasoning" },
    coding: { provider: "ollama", name: "qwen2.5-coder:7b" },
    fast: { provider: "ollama", name: "llama3.2:3b" },
    critic: { provider: "ollama", name: "llama3.2:3b" },   // Verification loops
    tiny: { provider: "ollama", name: "llama3.2:3b" },      // Embeddings, intent classification
    roles: [
      { role: "explorer",         mode: "read_only", style: "fast", retryCount: 1 },
      { role: "reviewer",          mode: "read_only", style: "critic", retryCount: 1 },  // Now uses critic
      { role: "test_investigator", mode: "read_only", style: "thinking", retryCount: 1 },
      { role: "docs_researcher",   mode: "read_only", style: "fast", retryCount: 1 },
      { role: "worker",            mode: "write",     style: "coding",  retryCount: 0 },
    ],
  }
};
