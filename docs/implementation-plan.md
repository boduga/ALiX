# ALiX MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ALiX MVP: a local-first CLI agent harness with event logging, RepoMapLite, mock provider, policy-gated tools, patch-safe edits, verification, and a vanilla JavaScript inspector UI.

**Architecture:** ALiX is a TypeScript/Node CLI with an event-sourced JSONL session kernel. The CLI, tool runtime, patch engine, verifier, and local UI all read from or append to the same session event log. The first implementation uses a mock provider so the kernel and safety layers can be built without external model calls.

**Tech Stack:** TypeScript, Node v24, npm, built-in Node test runner, vanilla JavaScript, Server-Sent Events, JSONL session logs.

---

## File Structure

Create:

```text
package.json
package-lock.json
tsconfig.json
src/
  cli.ts
  index.ts
  config/
    defaults.ts
    loader.ts
    schema.ts
  events/
    event-log.ts
    replay.ts
    types.ts
  repomap/
    repomap-lite.ts
  providers/
    mock-provider.ts
    types.ts
  policy/
    policy-engine.ts
    approvals.ts
  tools/
    file-tools.ts
    shell-tool.ts
  patch/
    edit-format-policy.ts
    patch-engine.ts
    search-replace.ts
    structured-patch.ts
  checkpoints/
    checkpoint-manager.ts
  verifier/
    verifier.ts
  server/
    server.ts
  ui/
    index.html
    app.js
    styles.css
tests/
  config-loader.test.ts
  event-log.test.ts
  repomap-lite.test.ts
  mock-provider.test.ts
  policy-engine.test.ts
  patch-engine.test.ts
  verifier.test.ts
  server.test.ts
fixtures/
  sample-repo/
    package.json
    src/
      add.ts
      add.test.ts
```

Responsibilities:

- `src/cli.ts`: CLI entrypoint and command dispatch.
- `src/config/*`: default config, schema validation, user/project/flag merge.
- `src/events/*`: append-only JSONL event store and replay projections.
- `src/repomap/*`: MVP repository map.
- `src/providers/*`: normalized provider interface and mock provider.
- `src/policy/*`: capability checks and approval queue.
- `src/tools/*`: file/search and shell execution tools.
- `src/patch/*`: edit format selection, parsing, validation, applying.
- `src/checkpoints/*`: git/file-copy checkpoints and rollback.
- `src/verifier/*`: command discovery and execution.
- `src/server/*`: local HTTP/SSE server.
- `src/ui/*`: vanilla JavaScript inspector.

## Task 1: npm TypeScript Scaffold

**Files:**

- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `src/cli.ts`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "alix",
  "version": "0.1.0",
  "description": "Agentic Lifecycle & Intelligence eXchange",
  "type": "module",
  "bin": {
    "alix": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "node --test dist/tests/**/*.test.js",
    "check": "npm run build && npm test"
  },
  "engines": {
    "node": ">=24"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.9.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "rootDir": ".",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `src/index.ts`**

```ts
export const ALIX_VERSION = "0.1.0";
```

- [ ] **Step 4: Create `src/cli.ts`**

```ts
#!/usr/bin/env node
import { ALIX_VERSION } from "./index.js";

const [, , command] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`ALiX ${ALIX_VERSION}

Usage:
  alix run "<task>"
  alix serve
  alix config show
`);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(ALIX_VERSION);
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
```

- [ ] **Step 5: Create `tests/smoke.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ALIX_VERSION } from "../src/index.js";

test("exports ALiX version", () => {
  assert.equal(ALIX_VERSION, "0.1.0");
});
```

- [ ] **Step 6: Install dependencies**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm install
```

Expected: `package-lock.json` is created and dependencies install successfully.

- [ ] **Step 7: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: TypeScript build succeeds and smoke test passes.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json src tests
git commit -m "chore: scaffold ALiX TypeScript CLI"
```

## Task 2: Config Loader

**Files:**

- Create: `src/config/schema.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/loader.ts`
- Create: `tests/config-loader.test.ts`

- [ ] **Step 1: Create `src/config/schema.ts`**

```ts
export type Decision = "ask" | "allow" | "deny";

export type ModelConfig = {
  provider: "mock" | "anthropic" | "openai" | "google" | "openrouter" | "ollama" | "local";
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

export type AlixConfig = {
  version: 1;
  model: ModelConfig;
  permissions: PermissionConfig;
  context: ContextConfig;
  runtime: RuntimeConfig;
  ui: UiConfig;
};
```

- [ ] **Step 2: Create `src/config/defaults.ts`**

```ts
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
```

- [ ] **Step 3: Create `src/config/loader.ts`**

```ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { AlixConfig } from "./schema.js";

type PartialConfig = Partial<AlixConfig> & {
  model?: Partial<AlixConfig["model"]>;
  permissions?: Partial<AlixConfig["permissions"]>;
  context?: Partial<AlixConfig["context"]>;
  runtime?: Partial<AlixConfig["runtime"]>;
  ui?: Partial<AlixConfig["ui"]>;
};

export async function loadConfig(cwd: string): Promise<AlixConfig> {
  const projectPath = join(cwd, ".alix", "config.json");
  const projectConfig = existsSync(projectPath) ? await readJson(projectPath) : {};
  return mergeConfig(DEFAULT_CONFIG, projectConfig);
}

async function readJson(path: string): Promise<PartialConfig> {
  const text = await readFile(path, "utf8");
  return JSON.parse(text) as PartialConfig;
}

export function mergeConfig(base: AlixConfig, override: PartialConfig): AlixConfig {
  return {
    ...base,
    ...override,
    model: { ...base.model, ...override.model },
    permissions: {
      ...base.permissions,
      ...override.permissions,
      tools: { ...base.permissions.tools, ...override.permissions?.tools },
      protectedPaths: mergeUnique(base.permissions.protectedPaths, override.permissions?.protectedPaths ?? [])
    },
    context: { ...base.context, ...override.context },
    runtime: { ...base.runtime, ...override.runtime },
    ui: { ...base.ui, ...override.ui }
  };
}

function mergeUnique<T>(a: T[], b: T[]): T[] {
  return Array.from(new Set([...a, ...b]));
}
```

- [ ] **Step 4: Create `tests/config-loader.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader.js";

test("loads default config when project config is absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  try {
    const config = await loadConfig(dir);
    assert.equal(config.model.provider, "mock");
    assert.equal(config.ui.port, 4137);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("project config overrides defaults and preserves protected paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-config-"));
  try {
    await mkdir(join(dir, ".alix"));
    await writeFile(
      join(dir, ".alix", "config.json"),
      JSON.stringify({ model: { name: "custom-mock" }, permissions: { protectedPaths: ["private/**"] } })
    );

    const config = await loadConfig(dir);
    assert.equal(config.model.name, "custom-mock");
    assert.ok(config.permissions.protectedPaths.includes(".git/**"));
    assert.ok(config.permissions.protectedPaths.includes("private/**"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/config tests/config-loader.test.ts
git commit -m "feat: add ALiX config loader"
```

## Task 3: Event Kernel

**Files:**

- Create: `src/events/types.ts`
- Create: `src/events/event-log.ts`
- Create: `src/events/replay.ts`
- Create: `tests/event-log.test.ts`

- [ ] **Step 1: Create event types**

Create `src/events/types.ts`:

```ts
export type EventActor = "user" | "agent" | "system" | "tool" | "policy" | "verifier";

export type AlixEvent<TType extends string = string, TPayload = unknown> = {
  id: string;
  seq: number;
  version: 1;
  sessionId: string;
  runId?: string;
  parentEventId?: string;
  timestamp: string;
  type: TType;
  actor: EventActor;
  payload: TPayload;
};

export type NewEvent<TType extends string = string, TPayload = unknown> = Omit<
  AlixEvent<TType, TPayload>,
  "id" | "seq" | "version" | "timestamp"
>;

export type SessionProjection = {
  sessionId: string;
  eventCount: number;
  approvals: Record<string, unknown>;
  changedFiles: string[];
  summary?: string;
};
```

- [ ] **Step 2: Create append-only event log**

Create `src/events/event-log.ts`:

```ts
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AlixEvent, NewEvent } from "./types.js";

export class EventLog {
  readonly path: string;
  private nextSeq = 1;

  constructor(readonly sessionDir: string) {
    this.path = join(sessionDir, "events.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const events = await this.readAll();
    this.nextSeq = events.length + 1;
  }

  async append<TType extends string, TPayload>(
    event: NewEvent<TType, TPayload>
  ): Promise<AlixEvent<TType, TPayload>> {
    const fullEvent: AlixEvent<TType, TPayload> = {
      ...event,
      id: randomUUID(),
      seq: this.nextSeq++,
      version: 1,
      timestamp: new Date().toISOString()
    };
    await appendFile(this.path, `${JSON.stringify(fullEvent)}\n`, "utf8");
    return fullEvent;
  }

  async readAll(): Promise<AlixEvent[]> {
    if (!existsSync(this.path)) return [];
    const text = await readFile(this.path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AlixEvent);
  }
}
```

- [ ] **Step 3: Create replay projection**

Create `src/events/replay.ts`:

```ts
import type { AlixEvent, SessionProjection } from "./types.js";

export function replay(events: AlixEvent[]): SessionProjection {
  const sessionId = events[0]?.sessionId ?? "";
  const projection: SessionProjection = {
    sessionId,
    eventCount: events.length,
    approvals: {},
    changedFiles: []
  };

  for (const event of events) {
    if (event.type === "patch.applied") {
      const payload = event.payload as { changedFiles?: string[] };
      projection.changedFiles.push(...(payload.changedFiles ?? []));
    }
    if (event.type === "session.ended") {
      const payload = event.payload as { summary?: string };
      projection.summary = payload.summary;
    }
  }

  projection.changedFiles = Array.from(new Set(projection.changedFiles));
  return projection;
}
```

- [ ] **Step 4: Create `tests/event-log.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../src/events/event-log.js";
import { replay } from "../src/events/replay.js";

test("appends events with increasing sequence numbers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-events-"));
  try {
    const log = new EventLog(dir);
    await log.init();
    const first = await log.append({ sessionId: "s1", type: "session.started", actor: "system", payload: {} });
    const second = await log.append({ sessionId: "s1", type: "user.message", actor: "user", payload: { text: "hi" } });
    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);
    assert.equal((await log.readAll()).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("replay reconstructs changed files", () => {
  const projection = replay([
    {
      id: "1",
      seq: 1,
      version: 1,
      sessionId: "s1",
      timestamp: new Date().toISOString(),
      type: "patch.applied",
      actor: "system",
      payload: { changedFiles: ["a.ts", "a.ts", "b.ts"] }
    }
  ]);

  assert.deepEqual(projection.changedFiles, ["a.ts", "b.ts"]);
});
```

- [ ] **Step 5: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/events tests/event-log.test.ts
git commit -m "feat: add event-sourced session kernel"
```

## Task 4: RepoMapLite

**Files:**

- Create: `src/repomap/repomap-lite.ts`
- Create: `tests/repomap-lite.test.ts`
- Create: `fixtures/sample-repo/package.json`
- Create: `fixtures/sample-repo/src/add.ts`
- Create: `fixtures/sample-repo/src/add.test.ts`

- [ ] **Step 1: Create fixture repo files**

Create `fixtures/sample-repo/package.json`:

```json
{
  "name": "sample-repo",
  "scripts": {
    "test": "node --test"
  }
}
```

Create `fixtures/sample-repo/src/add.ts`:

```ts
export function add(a: number, b: number): number {
  return a + b;
}
```

Create `fixtures/sample-repo/src/add.test.ts`:

```ts
import { add } from "./add";

if (add(1, 2) !== 3) {
  throw new Error("add failed");
}
```

- [ ] **Step 2: Create `src/repomap/repomap-lite.ts`**

```ts
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type RepoFileKind = "source" | "test" | "config" | "docs" | "asset" | "unknown";

export type RepoFileSummary = {
  path: string;
  kind: RepoFileKind;
  language?: string;
  sizeBytes: number;
  lineCount?: number;
};

export type SymbolSummary = {
  path: string;
  name: string;
  kind: "function" | "class" | "type" | "interface" | "const" | "unknown";
  line?: number;
};

export type RepoMapLite = {
  root: string;
  generatedAt: string;
  files: RepoFileSummary[];
  configFiles: string[];
  docsFiles: string[];
  testFiles: string[];
  sourceFiles: string[];
  topLevelSymbols: SymbolSummary[];
};

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next"]);

export async function buildRepoMapLite(root: string): Promise<RepoMapLite> {
  const paths = await walk(root);
  const files: RepoFileSummary[] = [];
  const topLevelSymbols: SymbolSummary[] = [];

  for (const path of paths) {
    const fullPath = join(root, path);
    const info = await stat(fullPath);
    const text = await readTextIfSmall(fullPath, info.size);
    const lineCount = text ? text.split("\n").length : undefined;
    const kind = classify(path);
    files.push({ path, kind, language: languageFor(path), sizeBytes: info.size, lineCount });
    if (text && kind === "source") {
      topLevelSymbols.push(...extractSymbols(path, text));
    }
  }

  return {
    root,
    generatedAt: new Date().toISOString(),
    files,
    configFiles: files.filter((f) => f.kind === "config").map((f) => f.path),
    docsFiles: files.filter((f) => f.kind === "docs").map((f) => f.path),
    testFiles: files.filter((f) => f.kind === "test").map((f) => f.path),
    sourceFiles: files.filter((f) => f.kind === "source").map((f) => f.path),
    topLevelSymbols
  };
}

async function walk(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(root, fullPath)));
    } else if (entry.isFile()) {
      files.push(relative(root, fullPath));
    }
  }
  return files.sort();
}

async function readTextIfSmall(path: string, size: number): Promise<string | undefined> {
  if (size > 200_000) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function classify(path: string): RepoFileKind {
  if (/package\.json$|tsconfig\.json$|pyproject\.toml$|Cargo\.toml$|go\.mod$|Makefile$/.test(path)) return "config";
  if (/README|AGENTS\.md$|CLAUDE\.md$|HARNESS\.md$|^docs\//.test(path)) return "docs";
  if (/(\.test\.|\.spec\.|^test\/|^tests\/|__tests__)/.test(path)) return "test";
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|kt|cs|rb|php|swift|c|cpp|h|hpp)$/.test(path)) return "source";
  return "unknown";
}

function languageFor(path: string): string | undefined {
  const ext = path.split(".").pop();
  return ext;
}

function extractSymbols(path: string, text: string): SymbolSummary[] {
  const symbols: SymbolSummary[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const match =
      line.match(/export\s+function\s+(\w+)/) ??
      line.match(/function\s+(\w+)/) ??
      line.match(/class\s+(\w+)/) ??
      line.match(/export\s+const\s+(\w+)/);
    if (match) {
      symbols.push({ path, name: match[1], kind: line.includes("class") ? "class" : line.includes("const") ? "const" : "function", line: index + 1 });
    }
  });
  return symbols;
}
```

- [ ] **Step 3: Create `tests/repomap-lite.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildRepoMapLite } from "../src/repomap/repomap-lite.js";

test("builds a lightweight repo map", async () => {
  const map = await buildRepoMapLite("fixtures/sample-repo");
  assert.ok(map.configFiles.includes("package.json"));
  assert.ok(map.sourceFiles.includes("src/add.ts"));
  assert.ok(map.testFiles.includes("src/add.test.ts"));
  assert.ok(map.topLevelSymbols.some((symbol) => symbol.name === "add"));
});
```

- [ ] **Step 4: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/repomap tests/repomap-lite.test.ts fixtures
git commit -m "feat: add RepoMapLite"
```

## Task 5: Mock Provider

**Files:**

- Create: `src/providers/types.ts`
- Create: `src/providers/mock-provider.ts`
- Create: `tests/mock-provider.test.ts`

- [ ] **Step 1: Create provider types**

Create `src/providers/types.ts`:

```ts
export type ModelCapabilities = {
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  effectiveContextBudget?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
};

export type NormalizedMessage = {
  role: "user" | "assistant";
  content: string;
};

export type NormalizedRequest = {
  systemPrompt: string;
  messages: NormalizedMessage[];
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type NormalizedResponse = {
  text: string;
  toolCalls: ToolCall[];
};

export type ModelAdapter = {
  id: string;
  capabilities: ModelCapabilities;
  editFormatPreference: "structured_patch" | "unified_diff" | "search_replace" | "full_file";
  longContextStrategy: "expanded_context" | "trimmed_context";
  complete(request: NormalizedRequest): Promise<NormalizedResponse>;
};
```

- [ ] **Step 2: Create mock provider**

Create `src/providers/mock-provider.ts`:

```ts
import type { ModelAdapter, NormalizedRequest, NormalizedResponse } from "./types.js";

export class MockProvider implements ModelAdapter {
  id = "mock";
  capabilities = {
    provider: "mock",
    model: "mock-planner",
    inputTokenLimit: 32_000,
    outputTokenLimit: 4_000,
    supportsTools: false,
    supportsStreaming: false,
    supportsStructuredOutput: true,
    supportsVision: false
  };
  editFormatPreference = "structured_patch" as const;
  longContextStrategy = "trimmed_context" as const;

  async complete(request: NormalizedRequest): Promise<NormalizedResponse> {
    const last = request.messages.at(-1)?.content ?? "";
    return {
      text: `Plan:\n1. Inspect repository context.\n2. Prepare a safe patch for: ${last}\n3. Run verification.\n`,
      toolCalls: []
    };
  }
}
```

- [ ] **Step 3: Create `tests/mock-provider.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../src/providers/mock-provider.js";

test("mock provider returns a deterministic plan", async () => {
  const provider = new MockProvider();
  const response = await provider.complete({
    systemPrompt: "You are ALiX.",
    messages: [{ role: "user", content: "fix tests" }]
  });
  assert.match(response.text, /Plan:/);
  assert.match(response.text, /fix tests/);
  assert.deepEqual(response.toolCalls, []);
});
```

- [ ] **Step 4: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers tests/mock-provider.test.ts
git commit -m "feat: add mock provider adapter"
```

## Task 6: Policy Engine And Approvals

**Files:**

- Create: `src/policy/policy-engine.ts`
- Create: `src/policy/approvals.ts`
- Create: `tests/policy-engine.test.ts`

- [ ] **Step 1: Create policy engine**

Create `src/policy/policy-engine.ts`:

```ts
import type { AlixConfig, Decision } from "../config/schema.js";

export type ToolRequest = {
  toolCallId: string;
  capability: string;
  path?: string;
  command?: string;
};

export type PolicyDecision = {
  decision: Decision;
  reason: string;
};

export function decidePolicy(config: AlixConfig, request: ToolRequest): PolicyDecision {
  if (request.path && isProtectedPath(config.permissions.protectedPaths, request.path)) {
    return { decision: "deny", reason: `Path is protected: ${request.path}` };
  }

  if (request.command && config.permissions.denyCommands.includes(request.command)) {
    return { decision: "deny", reason: `Command is denied: ${request.command}` };
  }

  const toolDecision = config.permissions.tools[request.capability];
  if (toolDecision) {
    return { decision: toolDecision, reason: `Matched tool policy for ${request.capability}` };
  }

  return { decision: config.permissions.default, reason: "Matched default policy" };
}

function isProtectedPath(patterns: string[], path: string): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3));
    if (pattern.endsWith(".*")) return path === pattern.slice(0, -2) || path.startsWith(pattern.slice(0, -1));
    return path === pattern;
  });
}
```

- [ ] **Step 2: Create approvals queue**

Create `src/policy/approvals.ts`:

```ts
import { randomUUID } from "node:crypto";

export type ApprovalStatus = "pending" | "approved" | "denied";

export type Approval = {
  id: string;
  prompt: string;
  status: ApprovalStatus;
};

export class ApprovalQueue {
  private approvals = new Map<string, Approval>();

  request(prompt: string): Approval {
    const approval = { id: randomUUID(), prompt, status: "pending" as const };
    this.approvals.set(approval.id, approval);
    return approval;
  }

  resolve(id: string, status: Exclude<ApprovalStatus, "pending">): Approval {
    const approval = this.approvals.get(id);
    if (!approval) throw new Error(`Unknown approval: ${id}`);
    if (approval.status !== "pending") return approval;
    const resolved = { ...approval, status };
    this.approvals.set(id, resolved);
    return resolved;
  }

  pending(): Approval[] {
    return Array.from(this.approvals.values()).filter((approval) => approval.status === "pending");
  }
}
```

- [ ] **Step 3: Create policy tests**

Create `tests/policy-engine.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config/defaults.js";
import { decidePolicy } from "../src/policy/policy-engine.js";
import { ApprovalQueue } from "../src/policy/approvals.js";

test("allows configured read tool", () => {
  const decision = decidePolicy(DEFAULT_CONFIG, { toolCallId: "1", capability: "file.read", path: "src/a.ts" });
  assert.equal(decision.decision, "allow");
});

test("denies protected paths", () => {
  const decision = decidePolicy(DEFAULT_CONFIG, { toolCallId: "1", capability: "file.write", path: ".env" });
  assert.equal(decision.decision, "deny");
});

test("tracks pending approvals", () => {
  const queue = new ApprovalQueue();
  const approval = queue.request("Run npm test?");
  assert.equal(queue.pending().length, 1);
  queue.resolve(approval.id, "approved");
  assert.equal(queue.pending().length, 0);
});
```

- [ ] **Step 4: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/policy tests/policy-engine.test.ts
git commit -m "feat: add policy engine and approvals"
```

## Task 7: Patch Engine

**Files:**

- Create: `src/patch/edit-format-policy.ts`
- Create: `src/patch/search-replace.ts`
- Create: `src/patch/structured-patch.ts`
- Create: `src/patch/patch-engine.ts`
- Create: `tests/patch-engine.test.ts`

- [ ] **Step 1: Create edit format policy**

Create `src/patch/edit-format-policy.ts`:

```ts
export type EditFormat = "structured_patch" | "unified_diff" | "search_replace" | "full_file";

export type EditFormatPolicy = {
  provider: string;
  preferred: EditFormat;
  allowed: EditFormat[];
  fullFileRewrite: "deny" | "ask" | "allow_for_new_or_generated";
};

export function defaultEditFormatForProvider(provider: string): EditFormat {
  if (provider === "google" || provider === "local") return "search_replace";
  return "structured_patch";
}
```

- [ ] **Step 2: Create search/replace parser**

Create `src/patch/search-replace.ts`:

```ts
export type SearchReplaceBlock = {
  path: string;
  search: string;
  replace: string;
};

const BLOCK_RE = /<<<<<<< SEARCH path=(.+?)\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;

export function parseSearchReplace(input: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  for (const match of input.matchAll(BLOCK_RE)) {
    blocks.push({ path: match[1].trim(), search: match[2], replace: match[3] });
  }
  return blocks;
}

export function applySearchReplace(content: string, block: SearchReplaceBlock): string {
  const first = content.indexOf(block.search);
  if (first === -1) throw new Error(`Search block not found for ${block.path}`);
  const second = content.indexOf(block.search, first + block.search.length);
  if (second !== -1) throw new Error(`Search block is ambiguous for ${block.path}`);
  return content.slice(0, first) + block.replace + content.slice(first + block.search.length);
}
```

- [ ] **Step 3: Create structured patch types**

Create `src/patch/structured-patch.ts`:

```ts
export type StructuredPatch = {
  version: 1;
  files: StructuredPatchFile[];
};

export type StructuredPatchFile = {
  path: string;
  operation: "create" | "modify" | "delete";
  preimageHash?: string;
  content?: string;
};

export function parseStructuredPatch(input: string): StructuredPatch {
  const parsed = JSON.parse(input) as StructuredPatch;
  if (parsed.version !== 1) throw new Error("Unsupported structured patch version");
  if (!Array.isArray(parsed.files)) throw new Error("Structured patch requires files");
  return parsed;
}
```

- [ ] **Step 4: Create patch engine**

Create `src/patch/patch-engine.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseSearchReplace, applySearchReplace } from "./search-replace.js";
import { parseStructuredPatch } from "./structured-patch.js";
import type { EditFormat } from "./edit-format-policy.js";

export type PatchApplyResult = {
  status: "applied" | "invalid";
  changedFiles: string[];
};

export async function applyPatch(root: string, format: EditFormat, patchText: string): Promise<PatchApplyResult> {
  if (format === "search_replace") {
    const blocks = parseSearchReplace(patchText);
    const changedFiles: string[] = [];
    for (const block of blocks) {
      const path = `${root}/${block.path}`;
      const content = await readFile(path, "utf8");
      const next = applySearchReplace(content, block);
      await writeFile(path, next, "utf8");
      changedFiles.push(block.path);
    }
    return { status: "applied", changedFiles };
  }

  if (format === "structured_patch") {
    const patch = parseStructuredPatch(patchText);
    const changedFiles: string[] = [];
    for (const file of patch.files) {
      const path = `${root}/${file.path}`;
      if (file.operation === "modify") {
        const content = await readFile(path, "utf8");
        if (!file.preimageHash || sha256(content) !== file.preimageHash) {
          throw new Error(`Preimage validation failed for ${file.path}`);
        }
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
      if (file.operation === "create") {
        await writeFile(path, file.content ?? "", "utf8");
        changedFiles.push(file.path);
      }
    }
    return { status: "applied", changedFiles };
  }

  throw new Error(`Unsupported edit format: ${format}`);
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
```

- [ ] **Step 5: Create patch tests**

Create `tests/patch-engine.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatch, sha256 } from "../src/patch/patch-engine.js";
import { defaultEditFormatForProvider } from "../src/patch/edit-format-policy.js";

test("applies exact search replace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    await applyPatch(dir, "search_replace", "<<<<<<< SEARCH path=src/a.ts\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE");
    assert.equal(await readFile(join(dir, "src/a.ts"), "utf8"), "const a = 2;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects stale structured patch preimage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    const patch = JSON.stringify({
      version: 1,
      files: [{ path: "src/a.ts", operation: "modify", preimageHash: sha256("old"), content: "const a = 2;\n" }]
    });
    await assert.rejects(() => applyPatch(dir, "structured_patch", patch), /Preimage validation failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("google provider defaults to search replace", () => {
  assert.equal(defaultEditFormatForProvider("google"), "search_replace");
});
```

- [ ] **Step 6: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/patch tests/patch-engine.test.ts
git commit -m "feat: add patch engine primitives"
```

## Task 8: Checkpoints And Verifier

**Files:**

- Create: `src/checkpoints/checkpoint-manager.ts`
- Create: `src/verifier/verifier.ts`
- Create: `tests/verifier.test.ts`

- [ ] **Step 1: Create checkpoint manager**

Create `src/checkpoints/checkpoint-manager.ts`:

```ts
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type Checkpoint = {
  id: string;
  root: string;
  files: string[];
};

export async function createFileCheckpoint(root: string, files: string[]): Promise<Checkpoint> {
  const id = randomUUID();
  for (const file of files) {
    const target = join(root, ".alix", "checkpoints", id, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, file), target);
  }
  return { id, root, files };
}
```

- [ ] **Step 2: Create verifier**

Create `src/verifier/verifier.ts`:

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type VerificationCheck = {
  command: string;
  reason: string;
};

export type VerificationResult = {
  status: "passed" | "failed" | "not_run";
  command?: string;
  output?: string;
};

export async function discoverVerification(root: string): Promise<VerificationCheck[]> {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  if (pkg.scripts?.test) return [{ command: "npm test", reason: "package.json defines test script" }];
  return [];
}

export async function runVerification(root: string, check: VerificationCheck): Promise<VerificationResult> {
  return new Promise((resolve) => {
    const child = spawn(check.command, { cwd: root, shell: true });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      resolve({ status: code === 0 ? "passed" : "failed", command: check.command, output });
    });
  });
}
```

- [ ] **Step 3: Create verifier tests**

Create `tests/verifier.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { discoverVerification } from "../src/verifier/verifier.js";

test("discovers npm test script", async () => {
  const checks = await discoverVerification("fixtures/sample-repo");
  assert.equal(checks[0]?.command, "npm test");
});
```

- [ ] **Step 4: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/checkpoints src/verifier tests/verifier.test.ts
git commit -m "feat: add checkpoints and verification discovery"
```

## Task 9: CLI Run Flow

**Files:**

- Modify: `src/cli.ts`
- Create: `src/run.ts`
- Create: `tests/run-flow.test.ts`

- [ ] **Step 1: Create `src/run.ts`**

```ts
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config/loader.js";
import { EventLog } from "./events/event-log.js";
import { buildRepoMapLite } from "./repomap/repomap-lite.js";
import { MockProvider } from "./providers/mock-provider.js";

export type RunResult = {
  sessionId: string;
  summary: string;
};

export async function runTask(cwd: string, task: string): Promise<RunResult> {
  const sessionId = randomUUID();
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
  const log = new EventLog(sessionDir);
  await log.init();

  await log.append({ sessionId, actor: "system", type: "session.started", payload: { cwd, configHash: "mvp" } });
  await log.append({ sessionId, actor: "user", type: "user.message", payload: { text: task, attachments: [] } });

  const repoMap = config.context.repoMap ? await buildRepoMapLite(cwd) : undefined;
  await log.append({
    sessionId,
    actor: "system",
    type: "context.repo_map_lite_created",
    payload: {
      fileCount: repoMap?.files.length ?? 0,
      sourceCount: repoMap?.sourceFiles.length ?? 0,
      testCount: repoMap?.testFiles.length ?? 0
    }
  });

  const provider = new MockProvider();
  const response = await provider.complete({
    systemPrompt: "You are ALiX. Produce concise plans.",
    messages: [{ role: "user", content: task }]
  });

  await log.append({ sessionId, actor: "agent", type: "agent.plan_proposed", payload: { text: response.text } });
  await log.append({ sessionId, actor: "system", type: "session.ended", payload: { reason: "completed", summary: response.text } });

  return { sessionId, summary: response.text };
}
```

- [ ] **Step 2: Modify `src/cli.ts`**

Replace the file with:

```ts
#!/usr/bin/env node
import { ALIX_VERSION } from "./index.js";
import { loadConfig } from "./config/loader.js";
import { runTask } from "./run.js";

const [, , command, ...args] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`ALiX ${ALIX_VERSION}

Usage:
  alix run "<task>"
  alix serve
  alix config show
`);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(ALIX_VERSION);
  process.exit(0);
}

if (command === "config" && args[0] === "show") {
  console.log(JSON.stringify(await loadConfig(process.cwd()), null, 2));
  process.exit(0);
}

if (command === "run") {
  const task = args.join(" ").trim();
  if (!task) {
    console.error("Usage: alix run \"<task>\"");
    process.exit(1);
  }
  const result = await runTask(process.cwd(), task);
  console.log(result.summary);
  console.log(`Session: ${result.sessionId}`);
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
```

- [ ] **Step 3: Create `tests/run-flow.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTask } from "../src/run.js";

test("run task creates event log and returns mock plan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-run-"));
  try {
    const result = await runTask(dir, "fix tests");
    assert.match(result.summary, /Plan:/);
    const events = await readFile(join(dir, ".alix", "sessions", result.sessionId, "events.jsonl"), "utf8");
    assert.match(events, /session.started/);
    assert.match(events, /context.repo_map_lite_created/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/run.ts tests/run-flow.test.ts
git commit -m "feat: wire CLI run flow"
```

## Task 10: Local Server And Inspector UI

**Files:**

- Create: `src/server/server.ts`
- Create: `src/ui/index.html`
- Create: `src/ui/app.js`
- Create: `src/ui/styles.css`
- Modify: `src/cli.ts`
- Create: `tests/server.test.ts`

- [ ] **Step 1: Create `src/server/server.ts`**

```ts
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function startServer(root: string, port: number): Promise<{ close: () => Promise<void>; url: string }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(await readFile(join(root, "dist", "src", "ui", "index.html"), "utf8"));
      return;
    }
    if (url.pathname === "/app.js" || url.pathname === "/styles.css") {
      const file = join(root, "dist", "src", "ui", url.pathname.slice(1));
      res.setHeader("content-type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
      res.end(await readFile(file, "utf8"));
      return;
    }
    if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/events")) {
      const sessionId = url.pathname.split("/")[3];
      const eventsPath = join(root, ".alix", "sessions", sessionId, "events.jsonl");
      res.setHeader("content-type", "text/event-stream");
      if (!existsSync(eventsPath)) {
        res.end();
        return;
      }
      const text = await readFile(eventsPath, "utf8");
      for (const line of text.split("\n").filter(Boolean)) {
        const event = JSON.parse(line) as { seq: number };
        res.write(`event: alix\nid: ${event.seq}\ndata: ${line}\n\n`);
      }
      res.end();
      return;
    }
    res.statusCode = 404;
    res.end("Not found");
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}
```

- [ ] **Step 2: Create UI files**

Create `src/ui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>ALiX Inspector</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body>
    <main>
      <h1>ALiX Inspector</h1>
      <p>Session events appear here when connected.</p>
      <ol id="events"></ol>
    </main>
    <script src="/app.js"></script>
  </body>
</html>
```

Create `src/ui/app.js`:

```js
const events = document.querySelector("#events");

function addEvent(text) {
  const item = document.createElement("li");
  item.textContent = text;
  events.append(item);
}

addEvent("Inspector loaded");
```

Create `src/ui/styles.css`:

```css
body {
  margin: 0;
  background: #0d0f12;
  color: #f4f1e8;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

main {
  max-width: 920px;
  margin: 48px auto;
  padding: 0 24px;
}

h1 {
  font-size: 32px;
}
```

- [ ] **Step 3: Modify build script to copy UI assets**

Update `package.json` scripts:

```json
"scripts": {
  "build": "tsc -p tsconfig.json && mkdir -p dist/src/ui && cp src/ui/index.html src/ui/app.js src/ui/styles.css dist/src/ui/",
  "test": "node --test dist/tests/**/*.test.js",
  "check": "npm run build && npm test"
}
```

- [ ] **Step 4: Add serve command to `src/cli.ts`**

Add import:

```ts
import { startServer } from "./server/server.js";
```

Add before unknown command:

```ts
if (command === "serve") {
  const config = await loadConfig(process.cwd());
  const server = await startServer(process.cwd(), config.ui.port);
  console.log(`ALiX inspector running at ${server.url}`);
}
```

- [ ] **Step 5: Create `tests/server.test.ts`**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server/server.js";

test("serves inspector html", async () => {
  const server = await startServer(process.cwd(), 0);
  try {
    const response = await fetch(server.url);
    const text = await response.text();
    assert.match(text, /ALiX Inspector/);
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 6: Build and test**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json src/server src/ui src/cli.ts tests/server.test.ts
git commit -m "feat: add local inspector server"
```

## Task 11: Final MVP Verification

**Files:**

- Modify only if a previous task needs small fixes.

- [ ] **Step 1: Run full check**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH npm run check
```

Expected: build and tests pass.

- [ ] **Step 2: Run CLI help**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node dist/src/cli.js --help
```

Expected: output includes `alix run "<task>"`.

- [ ] **Step 3: Run a mock task**

Run:

```bash
PATH=/home/babasola/.nvm/versions/node/v24.13.0/bin:$PATH node dist/src/cli.js run "summarize this repo"
```

Expected: output includes `Plan:` and `Session:`.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: clean working tree.

## Self-Review Notes

Spec coverage:

- MVP product spec is covered by Tasks 1-11.
- Event kernel schema is covered by Task 3.
- Config format is covered by Task 2.
- RepoMapLite is covered by Task 4.
- Provider adapter interface is covered by Task 5.
- Patch protocol is covered by Task 7.
- Frontend transport is covered by Task 10.

Deferred by design:

- Real provider adapters.
- Full Tree-sitter repo map.
- MCP.
- Subagents.
- Browser automation.
- Docker/remote runtimes.

The plan contains concrete file paths, commands, expected outcomes, and code snippets for each implementation task.
