# Configuration Format

## Purpose

Configuration controls providers, model defaults, permissions, patch policy, context budgets, runtime providers, UI behavior, and extensions. It must be explicit, mergeable, inspectable, and safe by default.

## Config Files

```text
User config:
  ~/.config/alix/config.json

Project config:
  <repo>/.alix/config.json

Session overrides:
  CLI flags and environment variables
```

Precedence:

```text
CLI flag -> environment variable -> project config -> user config -> built-in default
```

## Top-Level Shape

```ts
type AlixConfig = {
  version: 1;
  model: ModelConfig;
  providerHints?: ProviderHints;
  permissions: PermissionConfig;
  context: ContextConfig;
  patch: PatchConfig;
  runtime: RuntimeConfig;
  ui: UiConfig;
  memory: MemoryConfig;
  extensions: ExtensionConfig;
};
```

## Model Config

```ts
type ModelConfig = {
  provider: "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "local";
  name: string;
  temperature?: number;
  maxOutputTokens?: number;
};

type ProviderHints = {
  exploration?: string;
  editing?: string;
  review?: string;
  default?: string;
};
```

Provider hints are optional and user-configured. The harness must not silently route work to a different provider unless config permits it.

## Permission Config

```ts
type PermissionConfig = {
  default: "ask" | "allow" | "deny";
  tools: Record<string, "ask" | "allow" | "deny">;
  protectedPaths: string[];
  allowNetworkDomains: string[];
  denyCommands: string[];
};
```

Built-in protected paths:

```json
[".git/**", ".env", ".env.*", "**/secrets/**", "**/*.pem", "**/*.key"]
```

## Context Config

```ts
type ContextConfig = {
  repoMap: boolean;
  repoMapMode: "lite" | "full";
  maxRepoMapTokens: number;
  semanticSearch: boolean;
  includeGitStatus: boolean;
  pinnedFiles: string[];
};
```

MVP default:

```json
{
  "repoMap": true,
  "repoMapMode": "lite",
  "maxRepoMapTokens": 4000,
  "semanticSearch": false,
  "includeGitStatus": true,
  "pinnedFiles": []
}
```

## Patch Config

```ts
type PatchConfig = {
  requireApproval: boolean;
  checkpointStrategy: "auto" | "git" | "file_copy";
  editFormatPolicies: EditFormatPolicy[];
  fullFileRewrite: {
    default: "deny" | "ask";
    allowNewFiles: boolean;
    allowGeneratedFiles: boolean;
    maxLinesWithoutApproval: number;
  };
};
```

## Runtime Config

```ts
type RuntimeConfig = {
  provider: "process" | "docker" | "remote";
  shell: string;
  commandTimeoutMs: number;
  envAllowlist: string[];
};
```

MVP uses `process`.

## UI Config

```ts
type UiConfig = {
  enabled: boolean;
  host: string;
  port: number;
  transport: "sse" | "websocket";
};
```

MVP default:

```json
{
  "enabled": true,
  "host": "127.0.0.1",
  "port": 4137,
  "transport": "sse"
}
```

## Memory Config

```ts
type MemoryConfig = {
  projectMemoryFile: string;
  sessionSummaries: boolean;
  userMemory: "disabled" | "enabled";
  repoIndexDir: string;
};
```

## Extension Config

```ts
type ExtensionConfig = {
  skills: string[];
  hooks: Record<string, string[]>;
  mcpServers: Array<{
    id: string;
    command: string;
    args: string[];
    enabled: boolean;
  }>;
};
```

## Example Config

```json
{
  "version": 1,
  "model": {
    "provider": "google",
    "name": "gemini-2.5-pro",
    "temperature": 0.2
  },
  "providerHints": {
    "exploration": "google",
    "editing": "anthropic",
    "default": "anthropic"
  },
  "permissions": {
    "default": "ask",
    "tools": {
      "file.read": "allow",
      "file.write": "ask",
      "shell.run": "ask",
      "git.diff": "allow"
    },
    "protectedPaths": [".git/**", ".env", ".env.*", "secrets/**"],
    "allowNetworkDomains": [],
    "denyCommands": ["rm -rf /", "git push --force"]
  },
  "context": {
    "repoMap": true,
    "repoMapMode": "lite",
    "maxRepoMapTokens": 4000,
    "semanticSearch": false,
    "includeGitStatus": true,
    "pinnedFiles": []
  },
  "patch": {
    "requireApproval": true,
    "checkpointStrategy": "auto",
    "editFormatPolicies": [],
    "fullFileRewrite": {
      "default": "ask",
      "allowNewFiles": true,
      "allowGeneratedFiles": true,
      "maxLinesWithoutApproval": 40
    }
  },
  "runtime": {
    "provider": "process",
    "shell": "bash",
    "commandTimeoutMs": 120000,
    "envAllowlist": ["PATH", "HOME", "SHELL"]
  },
  "ui": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 4137,
    "transport": "sse"
  },
  "memory": {
    "projectMemoryFile": "HARNESS.md",
    "sessionSummaries": true,
    "userMemory": "disabled",
    "repoIndexDir": ".alix/index"
  },
  "extensions": {
    "skills": [],
    "hooks": {},
    "mcpServers": []
  }
}
```

## MVP Acceptance Tests

- Project config overrides user config.
- CLI provider flag overrides project config.
- Protected built-in paths apply even if project config omits them.
- Invalid config fails before a model request is made.
- `alix config show` prints the merged effective config with secrets redacted.
