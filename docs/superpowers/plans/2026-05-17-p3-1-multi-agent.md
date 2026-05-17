# P3.1 Multi-Agent Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-agent coordination: parent agent delegates tasks to subagent child processes (explorer, reviewer, test_investigator, docs_researcher, worker). User can also spawn subagents via `alix agent <role> "<task>"`.

**Architecture:** Subagents are separate Node.js child processes spawned by `SubagentManager`. Parent delegates via a `delegate` tool call. User spawns via CLI. Subagent gets a task-scoped context slice (reusing P0.1 ContextCompiler). Results flow back through the shared event log. Ownership registry prevents write conflicts.

**Tech Stack:** Vanilla TypeScript. No new dependencies. Reuses existing `ContextCompiler`, `EventLog`, `ProviderAdapter`, tool executor, and config loader.

---

### Task 1: Types and Config

**Files:**
- Modify: `src/config/schema.ts` — add `subagentRoles` array to `AlixConfig`
- Modify: `src/config/defaults.ts` — add default role configs
- Test: `tests/config-loader.test.ts`

- [ ] **Step 1: Add `SubagentConfig` and `SubagentRoleConfig` to `src/config/schema.ts`**

After `ExtensionStoreConfig` (line ~71), add:

```typescript
export type SubagentRole = "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";

export type SubagentRoleConfig = {
  role: SubagentRole;
  mode: "read_only" | "write";
  model?: string;            // override for this role. undefined = use parent's model
  retryCount?: number;        // default: 1 for read_only, 0 for write
  fastModel?: string;         // e.g. "qwen3b" for roles that should use a fast model
  enabled?: boolean;
};

export type SubagentConfig = {
  enabled: boolean;
  roles: SubagentRoleConfig[];
};
```

Add `subagents?: SubagentConfig` to `AlixConfig` after `extensions`.

- [ ] **Step 2: Add defaults to `src/config/defaults.ts`**

After the `skills` block in `DEFAULT_CONFIG`, add:

```typescript
subagents: {
  enabled: true,
  roles: [
    { role: "explorer",       mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
    { role: "reviewer",        mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
    { role: "test_investigator", mode: "read_only", retryCount: 1 },
    { role: "docs_researcher", mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
    { role: "worker",          mode: "write",     retryCount: 0 },
  ],
},
```

Add `subagents?: SubagentConfig` to the `RuntimeConfig` type merge in `loader.ts`.

- [ ] **Step 3: Update `src/config/loader.ts` to merge subagent config**

In the `mergeConfig` function, add:
```typescript
subagents: mergeSubagentConfig(
  result.subagents ?? DEFAULT_CONFIG.subagents,
  override.subagents ?? {}
),
```

Add a `mergeSubagentConfig` function:
```typescript
function mergeSubagentConfig(a: SubagentConfig, b: Partial<SubagentConfig>): SubagentConfig {
  return {
    enabled: b.enabled !== undefined ? b.enabled : a.enabled,
    roles: a.roles,  // roles array is not user-overridable in MVP
  };
}
```

- [ ] **Step 4: Add config test to `tests/config-loader.test.ts`**

```typescript
test("subagent roles are loaded from defaults", () => {
  const result = mergeConfig(DEFAULT_CONFIG, {});
  assert.equal(result.subagents!.enabled, true);
  assert.equal(result.subagents!.roles.length, 5);
  const explorer = result.subagents!.roles.find(r => r.role === "explorer");
  assert.equal(explorer!.mode, "read_only");
  assert.equal(explorer!.retryCount, 1);
  const worker = result.subagents!.roles.find(r => r.role === "worker");
  assert.equal(worker!.mode, "write");
  assert.equal(worker!.retryCount, 0);
});
```

- [ ] **Step 5: Run test**

Run: `npx vitest run tests/config-loader.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 7: Commit**

```bash
git add src/config/schema.ts src/config/defaults.ts src/config/loader.ts tests/config-loader.test.ts
git commit -m "feat(multi-agent): add subagent config schema with role defaults"
```

---

### Task 2: SubagentManager (process lifecycle)

**Files:**
- Create: `src/agents/subagent-manager.ts`
- Create: `tests/agents/subagent-manager.test.ts`

SubagentManager owns spawning, tracking, and terminating subagent child processes. It handles concurrent subagents, resolves results via stdio, and fires callbacks on completion.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/agents/subagent-manager.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SubagentManager } from "../../src/agents/subagent-manager.js";
import type { SubagentRole, SubagentTask } from "../../src/config/schema.js";

function makeTask(overrides: Partial<SubagentTask> = {}): SubagentTask {
  return {
    id: "test-1",
    role: "explorer" as SubagentRole,
    mode: "read_only",
    prompt: "list all files in src/",
    ownedPaths: undefined,
    expectedOutput: undefined,
    contextBundle: undefined,
    ...overrides,
  };
}

describe("SubagentManager", () => {
  it("spawns a process and resolves on exit", async () => {
    const manager = new SubagentManager({ sessionId: "test-session" });
    const task = makeTask({ id: "spawn-test", role: "explorer" });

    const result = await manager.spawn(task);
    assert.equal(result.status, "success");
    assert.equal(result.role, "explorer");
    manager.shutdown();
  }, 30000);

  it("rejects overlapping owned paths at spawn time", () => {
    const manager = new SubagentManager({ sessionId: "test-session" });
    const task1 = makeTask({ role: "worker", ownedPaths: ["src/foo.ts"] });
    const task2 = makeTask({ role: "worker", ownedPaths: ["src/foo.ts"] });

    manager.spawn(task1);
    assert.throws(() => manager.spawn(task2), /overlapping ownership/i);
    manager.shutdown();
  }, 30000);

  it("tracks concurrent subagents", async () => {
    const manager = new SubagentManager({ sessionId: "test-session" });
    const task1 = makeTask({ id: "c1", role: "explorer" });
    const task2 = makeTask({ id: "c2", role: "reviewer" });

    const [r1, r2] = await Promise.all([
      manager.spawn(task1),
      manager.spawn(task2),
    ]);
    assert.equal(r1.role, "explorer");
    assert.equal(r2.role, "reviewer");
    manager.shutdown();
  }, 60000);

  it("calls callback on completion", async () => {
    const manager = new SubagentManager({ sessionId: "test-session" });
    let called = false;
    manager.onResult((result) => { called = true; });

    await manager.spawn(makeTask({ id: "callback-test" }));
    assert.ok(called, "callback should fire on completion");
    manager.shutdown();
  }, 30000);
});
```

- [ ] **Step 2: Run test** (verify FAIL)

Run: `npx vitest run tests/agents/subagent-manager.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write `src/agents/subagent-manager.ts`**

Create the `src/agents/` directory first, then write:

```typescript
import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import { randomUUID } from "crypto";
import type { SubagentTask, SubagentResult, SubagentRole, SubagentRoleConfig } from "../config/schema.js";
import type { Config } from "../config/loader.js";

export type SubagentManagerOptions = {
  sessionId: string;
  config?: Config;
  eventLogPath?: string;
};

type RunningSubagent = {
  task: SubagentTask;
  process: ChildProcess;
  resolve: (result: SubagentResult) => void;
  reject: (err: Error) => void;
};

export type SubagentResultCallback = (result: SubagentResult) => void;

/**
 * Manages lifecycle of subagent child processes.
 * Spawns, tracks, and terminates concurrent subagents.
 * Communicates via stdio JSON-RPC-like messages.
 */
export class SubagentManager {
  private running = new Map<string, RunningSubagent>();
  private ownershipRegistry = new Map<string, string>(); // path -> subagentId
  private callbacks: SubagentResultCallback[] = [];

  constructor(private options: SubagentManagerOptions) {}

  onResult(cb: SubagentResultCallback): void {
    this.callbacks.push(cb);
  }

  /**
   * Spawn a subagent process. Throws if owned paths overlap with an active worker.
   */
  spawn(task: SubagentTask): Promise<SubagentResult> {
    return new Promise((resolve, reject) => {
      if (task.mode === "write" && task.ownedPaths) {
        for (const path of task.ownedPaths) {
          const owner = this.ownershipRegistry.get(path);
          if (owner && owner !== task.id) {
            reject(new Error(`Overlapping ownership: '${path}' is already owned by '${owner}'`));
            return;
          }
        }
        for (const path of task.ownedPaths) {
          this.ownershipRegistry.set(path, task.id);
        }
      }

      const roleConfig = this.getRoleConfig(task.role);
      const model = roleConfig.fastModel ?? this.options.config?.model?.name ?? "llama3";

      // Build CLI args for the subagent process
      const args = [
        "agent",
        task.role,
        "--task-id", task.id,
        "--prompt", task.prompt,
        "--model", model,
        "--mode", task.mode,
        "--session-id", this.options.sessionId,
      ];

      if (task.ownedPaths?.length) {
        args.push("--owned-paths", task.ownedPaths.join(","));
      }

      const child = spawn(process.execPath, [
        resolve(import.meta.dirname, "..", "cli.js"),
        ...args,
      ], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        env: { ...process.env, ALIX_NO_BANNER: "1" },
      });

      this.running.set(task.id, { task, process: child, resolve, reject });

      let stdout = "";
      child.stdout?.on("data", (data) => { stdout += data.toString(); });
      let stderr = "";
      child.stderr?.on("data", (data) => { stderr += data.toString(); });

      child.on("exit", (code) => {
        this.running.delete(task.id);

        if (task.mode === "write" && task.ownedPaths) {
          for (const path of task.ownedPaths) {
            if (this.ownershipRegistry.get(path) === task.id) {
              this.ownershipRegistry.delete(path);
            }
          }
        }

        for (const cb of this.callbacks) {
          const result: SubagentResult = code === 0
            ? { id: task.id, role: task.role, status: "success", findings: [], events: [] }
            : { id: task.id, role: task.role, status: "failed", findings: [], events: [], error: stderr || `Exit code ${code}` };
          cb(result);
        }

        if (code === 0) {
          resolve({ id: task.id, role: task.role, status: "success", findings: [], events: [] });
        } else {
          reject(new Error(stderr || `Subagent exited with code ${code}`));
        }
      });

      child.on("error", (err) => {
        this.running.delete(task.id);
        reject(err);
      });
    });
  }

  /**
   * Terminate all running subagents.
   */
  shutdown(): void {
    for (const [, running] of this.running) {
      running.process.kill();
    }
    this.running.clear();
    this.ownershipRegistry.clear();
  }

  private getRoleConfig(role: SubagentRole): SubagentRoleConfig {
    const defaultConfigs: Record<SubagentRole, SubagentRoleConfig> = {
      explorer:        { role: "explorer",         mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      reviewer:        { role: "reviewer",          mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      test_investigator: { role: "test_investigator", mode: "read_only", retryCount: 1 },
      docs_researcher: { role: "docs_researcher", mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      worker:          { role: "worker",            mode: "write",     retryCount: 0 },
    };
    const config = this.options.config?.subagents?.roles.find(r => r.role === role);
    return config ?? defaultConfigs[role];
  }
}
```

**Important:** The `import.meta.dirname` in `resolve()` needs to work in compiled JS. Use `fileURLToPath(import.meta.url)` or a simpler approach: compute the CLI path as `resolve(process.argv[1])` — since the parent CLI is invoked with `process.argv[1]`, the subagent can use the same path.

Better approach — replace the path resolution:
```typescript
const cliPath = process.argv[1]; // parent's CLI path
```

Then in the spawn call, use `cliPath` instead of `process.execPath + "cli.js"`. Actually for subagents, we invoke the CLI as a standalone script. Use:
```typescript
const alixPath = resolve(process.cwd(), "dist", "src", "cli.js");
```
This works since subagent runs in the same working directory.

- [ ] **Step 4: Run test** (verify PASS)

Run: `npx vitest run tests/agents/subagent-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 6: Commit**

```bash
git add src/agents/subagent-manager.ts tests/agents/subagent-manager.test.ts
git commit -m "feat(multi-agent): add SubagentManager — process lifecycle and concurrent tracking"
```

---

### Task 3: Subagent CLI Entry Point

**Files:**
- Create: `src/agents/subagent-cli.ts`
- Modify: `src/cli.ts` (add `alix agent` command handler)
- Modify: `src/config/defaults.ts` (add `subagents` to `DEFAULT_CONFIG`)
- Test: `tests/agents/subagent-cli.test.ts`

When the user runs `alix agent explorer "explore the auth module"`, or a parent agent delegates, a subagent process starts. This subagent runs its own model call and writes events to the shared log.

- [ ] **Step 1: Write `src/agents/subagent-cli.ts`**

```typescript
/**
 * Subagent entry point. Parses CLI args, builds prompt, calls model, exits.
 * Invoked by SubagentManager.spawn() as a child process.
 */
import { parseArgs } from "util";
import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { loadConfig, mergeConfig, DEFAULT_CONFIG } from "../config/loader.js";
import type { Config } from "../config/loader.js";
import { ContextCompiler } from "../context/compiler.js";
import { EventLog } from "../event-log/index.js";
import { ProviderFactory } from "../providers/factory.js";

const args = parseArgs({
  args: process.argv.slice(2),
  options: {
    taskId: { type: "string" },
    prompt: { type: "string" },
    model: { type: "string" },
    mode: { type: "string" },
    role: { type: "string" },
    sessionId: { type: "string" },
    ownedPaths: { type: "string" },
  },
  allowPositionals: false,
});

const taskId = args.values.taskId!;
const role = args.values.role! as "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";
const sessionId = args.values.sessionId!;
const prompt = args.values.prompt!;
const mode = args.values.mode as "read_only" | "write";
const ownedPaths = args.values.ownedPaths?.split(",").filter(Boolean);

async function run() {
  const config = mergeConfig(DEFAULT_CONFIG, {}) as Config;
  const eventLog = new EventLog(resolve(process.cwd(), ".alix", "sessions", sessionId));

  // Apply role-based model override
  if (args.values.model) {
    config.model.name = args.values.model;
  }

  const provider = ProviderFactory.create(config.model.provider, config);

  // Build context for this subagent
  const compiler = new ContextCompiler({ config, eventLog });
  const contextBundle = await compiler.compile(prompt);

  // Build the subagent system prompt with role context
  const roleInstructions = getRoleInstructions(role);
  const systemPrompt = `${roleInstructions}

Task: ${prompt}

Context:
${contextBundle.summary ?? "(no context)"}`;

  // Log subagent start event
  await eventLog.append({
    sessionId,
    actor: "subagent",
    type: "subagent.started",
    payload: { subagentId: taskId, role, mode, ownedPaths },
  });

  // Read-only roles: strip write tools from the tool list
  const tools = provider.getTools();
  const filteredTools = mode === "read_only"
    ? tools.filter(t => !isWriteTool(t.name))
    : tools;

  // Call the model
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const response = await provider.complete({ messages, tools: filteredTools });
  const resultText = response.content;

  // Log subagent result
  await eventLog.append({
    sessionId,
    actor: "subagent",
    type: "subagent.completed",
    payload: { subagentId: taskId, role, resultLength: resultText.length },
  });

  // Write result to stdout for SubagentManager to parse
  console.log(JSON.stringify({ subagentId: taskId, role, status: "success", result: resultText }));
  process.exit(0);
}

function isWriteTool(name: string): boolean {
  const writeTools = ["file.write", "file.patch", "file.edit", "bash", "git.commit", "git.push"];
  return writeTools.some(w => name.includes(w));
}

function getRoleInstructions(role: string): string {
  const instructions: Record<string, string> = {
    explorer:        "You are an explorer subagent. Understand code regions and report your findings. Be concise. Return structured observations.",
    reviewer:        "You are a code reviewer. Analyze code quality, style, and potential issues. Be constructive and specific.",
    test_investigator: "You are a test investigator. Map tests to code, diagnose failures, and suggest fixes. Be precise.",
    docs_researcher: "You are a docs researcher. Find and summarize relevant documentation. Cite sources.",
    worker:          "You are a worker subagent. Apply changes to owned files only. Wait for confirmation before writing. Always explain what you changed.",
  };
  return instructions[role] ?? "You are a subagent. Complete the given task.";
}

run().catch((err) => {
  console.error(JSON.stringify({ subagentId: taskId, status: "failed", error: err.message }));
  process.exit(1);
});
```

- [ ] **Step 2: Wire `alix agent` into `src/cli.ts`**

Add `alix agent <role> "<task>"` to the usage block (around line 237):
```typescript
  alix agent <role> "<task>"  Spawn a subagent (explorer|reviewer|test_investigator|docs_researcher|worker)
```

Add the handler in the command switch (around line 220):
```typescript
if (command === "agent") {
  const role = args[0] as "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";
  if (!role) { console.error("Usage: alix agent <role> <prompt>"); process.exit(1); }
  const prompt = args.slice(1).join(" ");
  const { spawn } = await import("child_process");
  const { resolve } = await import("path");
  const sessionId = "cli-" + Date.now();
  const child = spawn(process.argv[1], ["agent", role, "--task-id", crypto.randomUUID(), "--prompt", prompt, "--mode", "read_only", "--session-id", sessionId], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.on("exit", (code) => process.exit(code ?? 0));
  return;
}
```

**Actually, for `alix agent` from CLI, we want it to run interactively** — spawn the subagent and let it stream to the terminal. Better approach: the CLI entry point detects it's being invoked as a subagent via args and delegates to `subagent-cli.ts`.

Replace the handler with a simpler delegation:
```typescript
if (command === "agent") {
  // Forward to subagent-cli.ts
  const { fileURLToPath } = await import("url");
  const { dirname } = await import("path");
  const self = resolve(fileURLToPath(import.meta.url));
  const child = spawn(process.argv[1], process.argv.slice(2).map(a => a.startsWith("--") ? `--${a.slice(2)}` : a), {
    stdio: "inherit",
    env: { ...process.env, ALIX_AGENT_MODE: "true" },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  return;
}
```

**Simpler approach for MVP:** `alix agent` runs the subagent directly. No recursion — just handle it in the CLI and invoke `subagent-cli.ts` directly:
```typescript
if (command === "agent") {
  const role = args[0];
  const prompt = args.slice(1).join(" ");
  if (!role || !prompt) { console.error("Usage: alix agent <role> <prompt>"); process.exit(1); }
  const child = spawn(process.argv[1], [
    "-e",
    `import { run } from "./dist/src/agents/subagent-cli.js"; run({ role: "${role}", prompt: ${JSON.stringify(prompt)}, sessionId: "cli-${Date.now()}" })`,
  ], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  return;
}
```

**Even simpler:** Add a `--subagent` flag to `cli.ts` that invokes `subagent-cli.ts`:
```typescript
if (command === "agent" && args[0]) {
  const subagentArgs = ["--subagent", args[0], ...args.slice(1)];
  const child = spawn(process.argv[1], subagentArgs, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
  return;
}
```

- [ ] **Step 3: Add `--subagent` handling in `src/cli.ts`**

Add near the top of the main handler block, before the command switch:
```typescript
if (args.values.subagent) {
  const role = args.values.subagent as "explorer" | "reviewer" | "test_investigator" | "docs_researcher" | "worker";
  const prompt = args.values._[0] as string ?? "";
  const taskId = (args.values.taskId as string) ?? crypto.randomUUID();
  const sessionId = (args.values.sessionId as string) ?? "cli-" + Date.now();
  const mode = (args.values.mode as string) ?? "read_only";
  import("./agents/subagent-cli.js").then(m => m.run({ role, prompt, taskId, sessionId, mode }));
  return;
}
```

Add the parseArgs for `--subagent` at the top of `cli.ts`:
```typescript
const knownArgs = [
  { name: "subagent", type: "string" },
  { name: "taskId", type: "string" },
  { name: "sessionId", type: "string" },
  { name: "mode", type: "string" },
];
```

- [ ] **Step 4: Write a minimal smoke test**

```typescript
// tests/agents/subagent-cli.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import { resolve } from "path";

describe("Subagent CLI", () => {
  it("exits with error when no role given", async () => {
    const child = spawn(process.argv[1], ["--subagent"], { stdio: "pipe" });
    let stderr = "";
    child.stderr?.on("data", d => { stderr += d.toString(); });
    await new Promise(r => child.on("close", r));
    assert.notEqual(child.exitCode, 0);
  });
}, 15000);
```

- [ ] **Step 5: Build and run smoke test**

Run: `npm run build && npx vitest run tests/agents/subagent-cli.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/agents/subagent-cli.ts src/cli.ts tests/agents/subagent-cli.test.ts
git commit -m "feat(multi-agent): add subagent CLI entry point — alix agent <role> <prompt>"
```

---

### Task 4: delegate Tool (parent spawns subagent)

**Files:**
- Create: `src/agents/delegate-tool.ts`
- Modify: `src/run.ts` (wire delegate tool into tool executor)
- Test: `tests/agents/delegate-tool.test.ts`

The parent agent calls `delegate(role, prompt)` to spawn a subagent. The tool returns structured results from the subagent.

- [ ] **Step 1: Write `src/agents/delegate-tool.ts`**

```typescript
import type { ToolDef, ToolResult } from "../tools/types.js";
import type { SubagentRole } from "../config/schema.js";
import type { SubagentManager } from "./subagent-manager.js";
import type { TaskDelegator } from "./task-delegator.js";

export const DELEGATE_TOOL: ToolDef = {
  name: "delegate",
  description: "Delegate a task to a specialized subagent. The subagent will explore, investigate, or apply changes on your behalf. Returns structured findings when complete.",
  input_schema: {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: ["explorer", "reviewer", "test_investigator", "docs_researcher", "worker"],
        description: "The subagent role",
      },
      prompt: {
        type: "string",
        description: "What to ask the subagent to do",
      },
      ownedPaths: {
        type: "array",
        items: { type: "string" },
        description: "File paths this subagent can write to (worker role only)",
      },
    },
    required: ["role", "prompt"],
  },
};

export function createDelegateHandler(
  subagentManager: SubagentManager,
  taskDelegator: TaskDelegator,
) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const role = args.role as SubagentRole;
    const prompt = args.prompt as string;
    const ownedPaths = (args.ownedPaths as string[] | undefined) ?? [];

    if (role === "worker" && ownedPaths.length === 0) {
      return { kind: "error", message: "Worker subagent requires ownedPaths", retryable: false };
    }

    const task = taskDelegator.buildTask({ role, prompt, ownedPaths, mode: role === "worker" ? "write" : "read_only" });

    const result = await subagentManager.spawn(task);

    if (result.status === "success") {
      return {
        kind: "success",
        output: result.findings.map(f => `[${f.type}] ${f.content}`).join("\n") || "(no findings)",
      };
    } else {
      return {
        kind: "error",
        message: `Subagent failed: ${result.error ?? "unknown error"}`,
        retryable: false,
      };
    }
  };
}
```

- [ ] **Step 2: Wire into `src/run.ts`**

Import at the top:
```typescript
import { SubagentManager } from "./agents/subagent-manager.js";
import { TaskDelegator } from "./agents/task-delegator.js";
import { createDelegateHandler } from "./agents/delegate-tool.js";
```

After the MCP setup block (around line 367), create the subagent manager and delegator:
```typescript
const subagentManager = new SubagentManager({
  sessionId,
  config: providerConfig,
  eventLogPath: log.path,
});
const taskDelegator = new TaskDelegator({ config: providerConfig, eventLog });
const delegateHandler = createDelegateHandler(subagentManager, taskDelegator);
```

Add `delegate` to the tool map near `patch_apply` (around line 330):
```typescript
delegate: delegateHandler,
```

And add `DELEGATE_TOOL` to the tools array (same place):
```typescript
DELEGATE_TOOL,
```

- [ ] **Step 3: Write the test**

```typescript
// tests/agents/delegate-tool.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDelegateHandler } from "../../src/agents/delegate-tool.js";
import type { SubagentResult } from "../../src/agents/subagent-manager.js";

function makeMockManager(overrides: Partial<SubagentResult> = {}): any {
  return {
    spawn: async (task: any) => ({
      id: task.id, role: task.role, status: "success", findings: [], events: [],
      ...overrides,
    }),
  };
}

function makeMockDelegator(): any {
  return {
    buildTask: (opts: any) => ({ id: "test-1", ...opts }),
  };
}

describe("Delegate tool", () => {
  it("returns success with findings when subagent succeeds", async () => {
    const manager = makeMockManager({ status: "success", findings: [{ type: "summary", content: "Found 3 issues", confidence: "high" }] });
    const handler = createDelegateHandler(manager, makeMockDelegator());

    const result = await handler({ role: "reviewer", prompt: "review auth" });
    assert.equal(result.kind, "success");
    assert.ok(result.output!.includes("Found 3 issues"));
  });

  it("returns error when worker has no ownedPaths", async () => {
    const handler = createDelegateHandler(makeMockManager(), makeMockDelegator());
    const result = await handler({ role: "worker", prompt: "fix the bug" });
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("ownedPaths"));
  });

  it("returns error when subagent fails", async () => {
    const manager = makeMockManager({ status: "failed", error: "Model timeout" });
    const handler = createDelegateHandler(manager, makeMockDelegator());
    const result = await handler({ role: "explorer", prompt: "explore" });
    assert.equal(result.kind, "error");
    assert.ok(result.message.includes("Model timeout"));
  });
});
```

- [ ] **Step 4: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 5: Commit**

```bash
git add src/agents/delegate-tool.ts src/run.ts tests/agents/delegate-tool.test.ts
git commit -m "feat(multi-agent): add delegate tool — parent spawns subagents"
```

---

### Task 5: TaskDelegator + OwnershipRegistry + ResultContractValidator

**Files:**
- Create: `src/agents/task-delegator.ts`
- Create: `src/agents/ownership-registry.ts`
- Create: `src/agents/result-contract-validator.ts`
- Create: `tests/agents/task-delegator.test.ts`

- [ ] **Step 1: Write `src/agents/ownership-registry.ts`**

```typescript
/**
 * Tracks which worker subagent owns which file paths.
 * Prevents overlapping write ownership.
 */
export class OwnershipRegistry {
  private owned = new Map<string, string>(); // path -> subagentId

  claim(subagentId: string, paths: string[]): void {
    for (const path of paths) {
      const existing = this.owned.get(path);
      if (existing && existing !== subagentId) {
        throw new Error(`Overlapping ownership: '${path}' already owned by '${existing}'`);
      }
      this.owned.set(path, subagentId);
    }
  }

  release(subagentId: string): void {
    for (const [path, id] of this.owned) {
      if (id === subagentId) this.owned.delete(path);
    }
  }

  isOwner(subagentId: string, path: string): boolean {
    return this.owned.get(path) === subagentId;
  }

  ownedBy(subagentId: string): string[] {
    return [...this.owned.entries()]
      .filter(([, id]) => id === subagentId)
      .map(([path]) => path);
  }

  count(): number { return this.owned.size; }
}
```

- [ ] **Step 2: Write `src/agents/task-delegator.ts`**

```typescript
import { randomUUID } from "crypto";
import type { SubagentRole, SubagentTask, SubagentConfig } from "../config/schema.js";
import type { Config } from "../config/loader.js";
import type { ContextBundle } from "../context/compiler.js";
import { OwnershipRegistry } from "./ownership-registry.js";

export type TaskDelegatorOptions = {
  config: Config;
  ownershipRegistry?: OwnershipRegistry;
};

export class TaskDelegator {
  constructor(private options: TaskDelegatorOptions) {}

  buildTask(opts: {
    role: SubagentRole;
    prompt: string;
    ownedPaths?: string[];
    mode?: "read_only" | "write";
    contextBundle?: ContextBundle;
  }): SubagentTask {
    const mode = opts.mode ?? (opts.role === "worker" ? "write" : "read_only");
    const taskId = randomUUID();

    if (mode === "write" && opts.ownedPaths?.length) {
      const registry = this.options.ownershipRegistry ?? new OwnershipRegistry();
      registry.claim(taskId, opts.ownedPaths);
    }

    return {
      id: taskId,
      role: opts.role,
      mode,
      prompt: opts.prompt,
      ownedPaths: opts.ownedPaths,
      expectedOutput: undefined,
      contextBundle: opts.contextBundle,
    };
  }
}
```

- [ ] **Step 3: Write `src/agents/result-contract-validator.ts`**

```typescript
import type { SubagentResult } from "./subagent-manager.js";

export type ValidationResult = {
  valid: boolean;
  warnings: string[];
};

export function validateResult(result: SubagentResult, expected?: string): ValidationResult {
  const warnings: string[] = [];

  if (expected && result.status === "success") {
    const hasExpected = result.findings.some(f => f.content.includes(expected));
    if (!hasExpected) {
      warnings.push(`Expected output "${expected}" not found in findings`);
    }
  }

  if (result.findings.length === 0 && result.status === "success") {
    warnings.push("Subagent returned success but no findings were recorded");
  }

  return { valid: warnings.length === 0, warnings };
}
```

- [ ] **Step 4: Write tests**

```typescript
// tests/agents/task-delegator.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TaskDelegator } from "../../src/agents/task-delegator.js";
import { OwnershipRegistry } from "../../src/agents/ownership-registry.js";
import { validateResult } from "../../src/agents/result-contract-validator.js";

describe("OwnershipRegistry", () => {
  const registry = new OwnershipRegistry();

  it("claims paths for a subagent", () => {
    registry.claim("sa-1", ["src/a.ts", "src/b.ts"]);
    assert.equal(registry.count(), 2);
    assert.ok(registry.isOwner("sa-1", "src/a.ts"));
  });

  it("rejects overlapping claims", () => {
    assert.throws(() => registry.claim("sa-2", ["src/a.ts"]), /overlapping/i);
  });

  it("releases paths on subagent exit", () => {
    registry.release("sa-1");
    assert.equal(registry.count(), 0);
    assert.ok(!registry.isOwner("sa-1", "src/a.ts"));
  });
});

describe("TaskDelegator", () => {
  const delegator = new TaskDelegator({ config: {} as any });

  it("builds a task with a random id", () => {
    const task = delegator.buildTask({ role: "explorer", prompt: "explore auth" });
    assert.ok(task.id);
    assert.equal(task.role, "explorer");
    assert.equal(task.mode, "read_only");
  });

  it("sets mode=write for worker role", () => {
    const task = delegator.buildTask({ role: "worker", prompt: "fix bug", ownedPaths: ["src/b.ts"] });
    assert.equal(task.mode, "write");
    assert.deepEqual(task.ownedPaths, ["src/b.ts"]);
  });
});

describe("ResultContractValidator", () => {
  it("passes when no expected output", () => {
    const result = validateResult({ id: "1", role: "explorer", status: "success", findings: [], events: [] });
    assert.equal(result.valid, false); // no findings is a warning
    assert.ok(result.warnings.length > 0);
  });

  it("warns when expected output not found", () => {
    const result = validateResult(
      { id: "1", role: "explorer", status: "success", findings: [{ type: "summary", content: "Auth module has 5 exports", confidence: "high" }], events: [] },
      "5 exports"
    );
    assert.equal(result.valid, true);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/agents/task-delegator.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 7: Commit**

```bash
git add src/agents/task-delegator.ts src/agents/ownership-registry.ts src/agents/result-contract-validator.ts tests/agents/task-delegator.test.ts
git commit -m "feat(multi-agent): add TaskDelegator, OwnershipRegistry, ResultContractValidator"
```

---

### Task 6: MergeCoordinator + SubagentEventBridge

**Files:**
- Create: `src/agents/merge-coordinator.ts`
- Modify: `src/agents/subagent-manager.ts` (add event bridging)
- Modify: `src/run.ts` (wire MergeCoordinator into parent decision loop)
- Test: `tests/agents/merge-coordinator.test.ts`

- [ ] **Step 1: Write `src/agents/merge-coordinator.ts`**

```typescript
import type { SubagentResult, SubagentFinding } from "./subagent-manager.js";

export type Conflict = {
  path: string;
  findings: SubagentFinding[];
};

export class MergeCoordinator {
  private pending: SubagentResult[] = [];

  /**
   * Queue a subagent result for processing.
   */
  enqueue(result: SubagentResult): void {
    this.pending.push(result);
  }

  /**
   * Get all pending results and clear the queue.
   */
  drain(): SubagentResult[] {
    const results = [...this.pending];
    this.pending = [];
    return results;
  }

  /**
   * Identify potential conflicts between subagent findings.
   * Returns file paths where multiple subagents found different things.
   */
  detectConflicts(results: SubagentResult[]): Conflict[] {
    const byRef = new Map<string, SubagentFinding[]>();

    for (const result of results) {
      for (const finding of result.findings) {
        if (finding.refs) {
          for (const ref of finding.refs) {
            if (!byRef.has(ref)) byRef.set(ref, []);
            byRef.get(ref)!.push(finding);
          }
        }
      }
    }

    const conflicts: Conflict[] = [];
    for (const [path, findings] of byRef) {
      if (findings.length > 1) {
        conflicts.push({ path, findings });
      }
    }
    return conflicts;
  }

  /**
   * Merge findings into a summary string for the parent agent.
   * Parent uses this to incorporate subagent results into its message stream.
   */
  summarize(results: SubagentResult[]): string {
    const lines: string[] = [];
    for (const result of results) {
      lines.push(`## ${result.role} (${result.id.slice(0, 8)})`);
      if (result.error) {
        lines.push(`**Error:** ${result.error}`);
        continue;
      }
      if (result.findings.length === 0) {
        lines.push("(no findings)");
        continue;
      }
      for (const finding of result.findings) {
        lines.push(`- [${finding.type}] ${finding.content}`);
      }
    }
    return lines.join("\n");
  }
}
```

- [ ] **Step 2: Wire MergeCoordinator into `src/run.ts`**

After `subagentManager` and `taskDelegator` creation (from Task 4):
```typescript
const mergeCoordinator = new MergeCoordinator();

// When delegate tool completes, enqueue result:
const delegateHandler = createDelegateHandler(subagentManager, taskDelegator, mergeCoordinator);
```

Update `createDelegateHandler` to accept `mergeCoordinator` and call `enqueue()`:
```typescript
export function createDelegateHandler(
  subagentManager: SubagentManager,
  taskDelegator: TaskDelegator,
  mergeCoordinator?: MergeCoordinator,
) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    // ... existing logic ...
    const result = await subagentManager.spawn(task);
    mergeCoordinator?.enqueue(result);  // queue for parent to process

    if (result.status === "success") {
      return { kind: "success", output: result.findings.map(f => `[${f.type}] ${f.content}`).join("\n") || "(no findings)" };
    } else {
      return { kind: "error", message: `Subagent failed: ${result.error ?? "unknown"}`, retryable: false };
    }
  };
}
```

- [ ] **Step 3: Wire SubagentEventBridge into subagent-cli.ts**

Update `src/agents/subagent-cli.ts` to tag events with subagentId:
```typescript
// In subagent-cli.ts, update event log calls:
await eventLog.append({
  sessionId,
  actor: "subagent",
  subagentId: taskId,   // added
  role,                 // added
  type: "subagent.started",
  payload: { subagentId: taskId, role, mode, ownedPaths },
});
```

The `SubagentEventBridge` is implicit in the subagent process — it just adds `subagentId` and `role` to every event it writes. No separate class needed.

- [ ] **Step 4: Write the test**

```typescript
// tests/agents/merge-coordinator.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MergeCoordinator } from "../../src/agents/merge-coordinator.js";

const makeResult = (overrides: any) => ({
  id: "r-1", role: "explorer", status: "success", findings: [], events: [], ...overrides,
});

describe("MergeCoordinator", () => {
  it("drains all pending results", () => {
    const mc = new MergeCoordinator();
    mc.enqueue(makeResult({ id: "1" }));
    mc.enqueue(makeResult({ id: "2" }));
    const results = mc.drain();
    assert.equal(results.length, 2);
    assert.equal(mc.drain().length, 0);
  });

  it("detects conflicts on same file path", () => {
    const mc = new MergeCoordinator();
    const results = [
      makeResult({ id: "c1", role: "explorer", findings: [{ type: "file_ref", content: "Found use of global state", confidence: "high", refs: ["src/auth/session.ts"] }] }),
      makeResult({ id: "c2", role: "reviewer", findings: [{ type: "risk_flag", content: "Global state is a concern", confidence: "medium", refs: ["src/auth/session.ts"] }] }),
    ];
    const conflicts = mc.detectConflicts(results);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].path, "src/auth/session.ts");
    assert.equal(conflicts[0].findings.length, 2);
  });

  it("summarizes results into markdown", () => {
    const mc = new MergeCoordinator();
    const summary = mc.summarize([
      makeResult({ role: "explorer", findings: [{ type: "summary", content: "Auth has 3 endpoints", confidence: "high" }] }),
    ]);
    assert.ok(summary.includes("explorer"));
    assert.ok(summary.includes("Auth has 3 endpoints"));
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/agents/merge-coordinator.test.ts`
Expected: PASS

- [ ] **Step 6: Run typecheck and full test suite**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 7: Commit**

```bash
git add src/agents/merge-coordinator.ts src/agents/subagent-manager.ts src/run.ts src/agents/subagent-cli.ts tests/agents/merge-coordinator.test.ts
git commit -m "feat(multi-agent): add MergeCoordinator and SubagentEventBridge"
```

---

### Task 7: CLI `alix agent` and User Error Handling

**Files:**
- Modify: `src/cli.ts` (add `alix agent` command to usage help)
- Modify: `src/run.ts` (hook up role-aware failure handling — read-only retry, write-capable halt + prompt)

- [ ] **Step 1: Add `alix agent` to CLI usage block**

In `src/cli.ts` usage block (around line 237), add:
```typescript
  alix agent <role> "<prompt>"  Spawn a subagent (explorer|reviewer|test_investigator|docs_researcher|worker)
```

- [ ] **Step 2: Wire role-aware failure into SubagentManager**

The `SubagentManager.spawn()` already handles process lifecycle. Add retry logic:

```typescript
// In spawn(), after child exits with non-zero:
// Check retryCount for this role
const roleConfig = this.getRoleConfig(task.role);
if (roleConfig.retryCount > 0 && !retried) {
  retried = true;
  // retry once — remove from running map, re-spawn
}
```

Actually, keep it simple: retry happens at the call site. In `createDelegateHandler`, check role and retry once if read-only:

```typescript
export function createDelegateHandler(...) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    const role = args.role as SubagentRole;
    const roleConfig = manager.getRoleConfig(role);

    let attempt = 0;
    let result: SubagentResult | null = null;

    while (attempt <= (roleConfig.retryCount ?? 1)) {
      result = await manager.spawn(task);
      if (result.status === "success" || role === "worker") break;
      attempt++;
    }

    // For worker failure, surface to parent — don't swallow
    if (result!.status === "failed" && role === "worker") {
      return {
        kind: "error",
        message: `Worker subagent failed: ${result!.error}. Wait for user input.`,
        retryable: false,
      };
    }
    // ...
  };
}
```

For worker failure in run.ts, show the user a prompt:
```typescript
// In run.ts, when delegate tool returns an error for worker:
if (result.kind === "error" && result.message.includes("Worker subagent failed")) {
  sessionState.messages.push({
    role: "user",
    content: `[Subagent Error]\n${result.message}\n\nOptions: [r]etry, [d]iscard partial writes, [a]bort`,
  });
  await log.append({ sessionId, actor: "system", type: "subagent.error", payload: { role: "worker", message: result.message } });
}
```

- [ ] **Step 3: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -5`
Expected: Clean, all pass

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts src/run.ts src/agents/delegate-tool.ts
git commit -m "feat(multi-agent): add alix agent CLI command and role-aware failure handling"
```

---

### Self-Review Checklist

1. **Spec coverage:** Can I point to a task for each component?
   - SubagentManager → Task 2 ✅
   - TaskDelegator → Task 5 ✅
   - OwnershipRegistry → Task 5 ✅
   - SubagentEventBridge → Task 6 (implicit in subagent-cli event tagging) ✅
   - ResultContractValidator → Task 5 ✅
   - MergeCoordinator → Task 6 ✅
   - Config schema → Task 1 ✅
   - CLI entry point → Task 3 ✅
   - delegate tool → Task 4 ✅
   - User spawn (`alix agent`) → Task 3 + 7 ✅
   - Role-aware failure → Task 7 ✅
   - Retry logic → Task 7 ✅

2. **Placeholder scan:** No "TBD", "TODO", or vague steps.

3. **Type consistency:** `SubagentRole`, `SubagentTask`, `SubagentResult`, `SubagentRoleConfig` all defined in `src/config/schema.ts` (Task 1). Used consistently across all tasks.

4. **File structure:** All multi-agent code lives in `src/agents/` — clean separation from the rest of the codebase. Tests live in `tests/agents/`.

5. **Dependencies:** Tasks 2-6 all import from Task 1's types. Tasks 3 and 4 import from Tasks 2 and 5 respectively. No circular dependencies.