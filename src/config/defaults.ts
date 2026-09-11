import { homedir } from "node:os";
import type { AlixConfig } from "./schema.js";
import {
  DEFAULT_OUTPUT_RATIO,
  DEFAULT_OUTPUT_FLOOR,
  DEFAULT_OUTPUT_CAP,
} from "./context-budget.js";
import { defaultRoleConfigs } from "../agents/agent-registry.js";

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
    pinnedFiles: [],
    budget: {
      outputRatio: DEFAULT_OUTPUT_RATIO,
      outputFloor: DEFAULT_OUTPUT_FLOOR,
      outputCap: DEFAULT_OUTPUT_CAP,
    }
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
    },
    safety: {
      requireConfirmation: true,
      scanScripts: true,
      denyNetwork: true,
      sandboxTimeoutMs: 30_000,
      ignoreWarningPatterns: [],
      requireNetworkIsolation: false,
    },
  },
  extensions: {
    store: {
      enabled: true,
      path: `${homedir()}/.alix/extensions`
    }
  },
  subagents: {
    enabled: true,
    roles: defaultRoleConfigs(),
  },
  ownership: {
    enabled: true,
    autoAcquire: true,
    defaultTtlMs: 30 * 60 * 1000,
    historyRetentionDays: 30,
  },
  tracing: {
    // Disabled by default (design §10): no Langfuse client is constructed, no
    // credentials are resolved, no network requests occur, NoopTraceClient is used.
    enabled: false,
    langfuse: {
      // baseUrl is empty by default; an operator enabling tracing must supply a
      // valid http(s) URL (validator flags it otherwise). Keys are fixed store-only
      // references resolved through the existing credential mechanism at load time.
      baseUrl: "",
      publicKey: "cred://langfuse/publicKey",
      secretKey: "cred://langfuse/secretKey",
    },
    capture: {
      messages: "truncated",
      reasoning: "off",
      toolInput: "truncated",
      toolOutput: "truncated",
      maxMessageChars: 4000,
      maxToolOutputChars: 2000,
    },
    flushTimeoutMs: 2000,
  },
};

/**
 * Permissive test config that allows all tool operations.
 * Bypasses PolicyGate to test routing logic, not approval workflows.
 */
export const PERMIT_ALL_CONFIG: AlixConfig = {
  ...DEFAULT_CONFIG,
  models: { default: { provider: "test", name: "test-model" } },
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
