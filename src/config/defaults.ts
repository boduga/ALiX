import type { AlixConfig } from "./schema.js";

export const DEFAULT_CONFIG: AlixConfig = {
  version: 1,
  model: {
    provider: "mock",
    name: "mock-planner",
    temperature: 0.2
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
    denyCommands: ["rm -rf /", "git push --force"]
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
    transport: "sse"
  }
};
