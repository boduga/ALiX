# M0.24: Task Router — Core Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** M0.21 hardcoded `daemonShellAlias()` in `daemon-server.ts`
**Spec:** `docs/superpowers/specs/2026-06-10-daemon-intent-router-design.md`

**Goal:** Create a shared `taskRouter()` in `src/runtime/` that classifies tasks into four execution paths (tool, chat, grounded_chat, agent), then wire both TUI modes (no-daemon and daemon) through it. Remove `daemonShellAlias()`.

**Design at a glance:**
- `src/runtime/task-router.ts` — pure classification, no side effects, no daemon dependency
- `src/runtime/route-executor.ts` — `executeRoute()` dispatch + `RuntimeExecutor` interface
- No-daemon TUI: `taskRouter()` → `executeRoute()` locally
- Daemon TUI: `taskRouter()` first, then send the classified route to daemon
- Daemon receives pre-classified route, executes with its own executor

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/task-router.ts` | **Create** | `taskRouter()`, `TaskRoute` type, grounded_chat detection |
| `src/runtime/route-executor.ts` | **Create** | `executeRoute()` dispatch, `RuntimeExecutor` interface, local executor |
| `src/cli/commands/tui.ts` | **Modify** | Route through taskRouter() for both daemon and no-daemon paths |
| `src/daemon/daemon-server.ts` | **Modify** | Remove `daemonShellAlias()`, handle pre-classified routes |
| `src/daemon/daemon-types.ts` | **Modify** | Add route-based command type |
| `src/daemon/daemon-router.ts` | **Delete** | Merged into shared `src/runtime/task-router.ts` |
| `tests/runtime/task-router.test.ts` | **Create** | Route classification unit tests |
| `tests/runtime/route-executor.test.ts` | **Create** | Route execution tests |
| `tests/daemon/daemon-server.test.ts` | **Create** | Route-based daemon integration tests |

---

### Task 1: Create shared task-router.ts

**Files:**
- Create: `src/runtime/task-router.ts`

- [ ] **Step 1: Write the shared router module**

```typescript
/**
 * task-router.ts — Shared task intent routing for ALiX.
 *
 * Classifies incoming tasks and returns an execution route.
 * Pure classification — no side effects, no execution.
 *
 * Both TUI modes (daemon and no-daemon) call this same router.
 */

import { isShellTask, classifyTask } from "../task-classifier.js";

export type TaskRouteKind = "tool" | "chat" | "grounded_chat" | "agent";

export type TaskRoute =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "chat"; prompt: string }
  | { kind: "grounded_chat"; prompt: string; allowedTools: string[] }
  | { kind: "agent"; task: string };

/**
 * Detection signals for grounded_chat — tasks that need current or
 * external information the model's training data cannot provide.
 */
const GROUNDED_CHAT_PATTERNS = [
  /\blatest\b/i, /\bcurrent\b/i, /\btoday\b/i, /\brecent\b/i,
  /\bnews\b/i, /\bsearch\b/i, /\blook up\b/i, /\bweb\b/i,
  /\bprice\b/i, /\bversion\b/i, /\brelease\b/i, /\bschedule\b/i,
  /\bcompare current\b/i,
];

/** Returns true if the task likely needs current or web-sourced information. */
export function isGroundedChatTask(task: string): boolean {
  return GROUNDED_CHAT_PATTERNS.some((p) => p.test(task));
}

/**
 * Classify a task and return the appropriate execution route.
 *
 * Classification priority:
 * 1. Shell commands (bare commands like "ls", "cat", "pwd") → tool via shell.run
 * 2. Grounded questions (current events, web search, versions) → grounded_chat
 * 3. Research/docs tasks → chat (direct model, no tools)
 * 4. Everything else (feature, bugfix, refactor, unknown) → full agent loop
 */
export function taskRouter(task: string): TaskRoute {
  // 1. Shell tasks — route to shell.run tool
  if (isShellTask(task)) {
    return {
      kind: "tool",
      tool: "shell.run",
      args: { command: task },
    };
  }

  // 2. Grounded questions — route to model + read-only tools
  if (isGroundedChatTask(task)) {
    return {
      kind: "grounded_chat",
      prompt: task,
      allowedTools: ["web.search", "web_fetch"],
    };
  }

  // 3. Research/doc tasks — route to direct chat
  const taskType = classifyTask(task);
  if (taskType === "research" || taskType === "docs") {
    return {
      kind: "chat",
      prompt: task,
    };
  }

  // 4. Everything else — full agent loop
  return {
    kind: "agent",
    task,
  };
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors (pure functional module, no unusual imports).

- [ ] **Step 3: Commit**

```bash
git add src/runtime/task-router.ts
git commit -m "feat(runtime): add shared task router with tool/chat/grounded_chat/agent classification"
```

---

### Task 2: Create route-executor.ts

**Files:**
- Create: `src/runtime/route-executor.ts`

- [ ] **Step 1: Write the executor interface and dispatch**

```typescript
/**
 * route-executor.ts — Task route execution dispatcher.
 *
 * Defines the RuntimeExecutor interface and the executeRoute() dispatcher.
 * Two implementations exist: local (same process) and daemon (Unix socket).
 */

import type { TaskRoute } from "./task-router.js";
import type { ToolResult } from "../tools/types.js";

/** Context shared by all route executors. */
export interface RuntimeContext {
  cwd: string;
  sessionId: string;
  sessionDir: string;
  eventLog: any; // EventLog
  config: any;   // AlixConfig
  onStream?: (chunk: any) => void;
}

/** Interface each execution backend must implement. */
export interface RuntimeExecutor {
  executeTool(route: TaskRoute & { kind: "tool" }, ctx: RuntimeContext): Promise<string>;
  executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string>;
  executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string>;
  executeAgent(route: TaskRoute & { kind: "agent" }, ctx: RuntimeContext): Promise<string>;
}

/** Dispatch a TaskRoute to the correct executor method. */
export async function executeRoute(
  route: TaskRoute,
  ctx: RuntimeContext,
  executor: RuntimeExecutor,
): Promise<string> {
  switch (route.kind) {
    case "tool":
      return executor.executeTool(route, ctx);
    case "chat":
      return executor.executeChat(route, ctx);
    case "grounded_chat":
      return executor.executeGroundedChat(route, ctx);
    case "agent":
      return executor.executeAgent(route, ctx);
  }
}
```

- [ ] **Step 2: Write the LocalRuntimeExecutor**

Append to the same file:

```typescript
/** Local (same-process) executor — used by no-daemon TUI and CLI commands. */
export class LocalRuntimeExecutor implements RuntimeExecutor {
  async executeTool(route: TaskRoute & { kind: "tool" }, ctx: RuntimeContext): Promise<string> {
    const { ToolExecutor } = await import("../tools/executor.js");
    const { randomBytes } = await import("node:crypto");

    const executor = new ToolExecutor(ctx.config, ctx.eventLog, ctx.cwd);
    const toolCallId = `local_${Date.now()}_${randomBytes(4).toString("hex")}`;

    const result = await executor.execute({
      toolCallId,
      name: route.tool,
      args: route.args,
    });

    if (result.kind === "success") {
      return result.output ?? result.content ?? "(tool completed)";
    } else if (result.kind === "denied") {
      return `Blocked by policy: ${result.reason}`;
    } else {
      return `Tool error: ${result.message}`;
    }
  }

  async executeChat(route: TaskRoute & { kind: "chat" }, ctx: RuntimeContext): Promise<string> {
    const { initProvider } = await import("../providers/init.js");
    const provider = initProvider(ctx.config.model.provider, ctx.config.model.name, ctx.config.apiKeys);
    const response = await provider.complete({
      systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
      messages: [{ role: "user", content: route.prompt }],
    });
    return response.text || "(no response)";
  }

  async executeGroundedChat(route: TaskRoute & { kind: "grounded_chat" }, ctx: RuntimeContext): Promise<string> {
    const { initProvider } = await import("../providers/init.js");
    const { ToolExecutor } = await import("../tools/executor.js");
    const { randomBytes } = await import("node:crypto");

    const provider = initProvider(ctx.config.model.provider, ctx.config.model.name, ctx.config.apiKeys);
    const executor = new ToolExecutor(ctx.config, ctx.eventLog, ctx.cwd);

    // First call: model may issue a tool call for fresh information
    const response = await provider.complete({
      systemPrompt: "You are ALiX, a helpful AI assistant. If you need current information, use the available tools to search. Answer concisely.",
      messages: [{ role: "user", content: route.prompt }],
    });

    if (response.toolCalls.length > 0 && response.toolCalls.length <= 1) {
      const tc = response.toolCalls[0];
      const toolResult = await executor.execute({
        toolCallId: `local_${Date.now()}_${randomBytes(4).toString("hex")}`,
        name: tc.name,
        args: tc.args,
      });

      const toolContent = toolResult.kind === "success"
        ? (toolResult.output || toolResult.content || "(no output)")
        : `Error: ${toolResult.message}`;

      // Second call: model synthesizes answer from tool result
      const finalResponse = await provider.complete({
        systemPrompt: "Answer the user's question based on the tool result.",
        messages: [
          { role: "user", content: route.prompt },
          { role: "assistant", content: response.text || "" },
          { role: "tool", content: toolContent },
        ],
      });
      return finalResponse.text || "(no response)";
    }

    // No tool call — model answered directly
    return response.text || "(no response)";
  }

  async executeAgent(route: TaskRoute & { kind: "agent" }, ctx: RuntimeContext): Promise<string> {
    const { runTask } = await import("../agent/agent-loop.js");
    const result = await runTask(ctx.cwd, route.task, {
      sharedSession: {
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        eventLog: ctx.eventLog,
      },
      planMode: false,
      streaming: !!ctx.onStream,
    }, ctx.onStream);
    return result.summary || "(task completed)";
  }
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/runtime/route-executor.ts
git commit -m "feat(runtime): add route executor interface and local implementation"
```

---

### Task 3: Wire no-daemon TUI through taskRouter

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add imports**

At the top, add:

```typescript
import { taskRouter } from "../../runtime/task-router.js";
import { executeRoute, LocalRuntimeExecutor, type RuntimeContext } from "../../runtime/route-executor.js";
```

- [ ] **Step 2: Replace the no-daemon execution block**

Find the no-daemon path inside `runTui()` — the block starting with:

```typescript
      } else {
        const msgsPath = join(sessionDir, "messages.jsonl");
        const { isShellTask } = await import("../../task-classifier.js");
        const isShell = isShellTask(task);
        ...
```

Replace it with:

```typescript
      } else {
        // Route through the shared task router
        const route = taskRouter(task);
        const ctx: RuntimeContext = {
          cwd, sessionId, sessionDir,
          eventLog: tuiLog,
          config,
          onStream: (chunk) => {
            if (chunk.type === "text" && typeof chunk.text === "string") {
              tui.appendOutput(chunk.text, true);
            }
          },
        };
        const text = await executeRoute(route, ctx, new LocalRuntimeExecutor());
        if (text) tui.appendOutput(text, false);
      }
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): wire no-daemon TUI through shared task router"
```

---

### Task 4: Update daemon-side to handle pre-classified routes

**Files:**
- Modify: `src/daemon/daemon-server.ts`
- Modify: `src/daemon/daemon-types.ts`
- Delete: `src/daemon/daemon-router.ts`

- [ ] **Step 1: Add route-aware command type to daemon-types.ts**

Add to the DaemonCommand union:

```typescript
import type { TaskRoute } from "../runtime/task-router.js";

// In the DaemonCommand type, replace the old "run" shape:
| { command: "run"; task: string; route?: TaskRoute; sessionMode?: string; planMode?: boolean }
```

- [ ] **Step 2: Remove daemonShellAlias() from daemon-server.ts**

Delete lines 173–178 (the `daemonShellAlias` function).

- [ ] **Step 3: Update handleRun to use the router**

Replace the top of `handleRun()` — instead of calling `daemonShellAlias(task)`, classify the task:

```typescript
  // Classify task — either from pre-classified route or from scratch
  let route: TaskRoute;
  if (cmd.route) {
    route = cmd.route;
  } else {
    // Backward-compatible: daemon classifies raw tasks itself
    const { taskRouter } = await import("../runtime/task-router.js");
    route = taskRouter(task);
  }

  // Route execution
  switch (route.kind) {
    case "tool": {
      await executeToolRoute(route, taskId, sessionId, cwd, client, eventLog);
      break;
    }
    case "chat": {
      await executeChatRoute(route, taskId, sessionId, cwd, client, eventLog);
      break;
    }
    case "grounded_chat": {
      await executeGroundedChatRoute(route, sessionId, cwd, client, eventLog);
      break;
    }
    case "agent":
      // Fall through to existing runTask() path below
      break;
  }

  // Non-agent routes complete here; agent routes fall through
  if (route.kind !== "agent") {
    currentSessionId = undefined;
    registry.update(taskId, { status: "completed", completedAt: new Date().toISOString() });
    safeWrite(client, { type: "task.completed" as const, sessionId, status: "completed" });
    client.write(JSON.stringify({ type: "session.ended", sessionId } satisfies DaemonResponse) + "\n");
    await eventLog.append({ actor: "system", type: "session.ended", sessionId, payload: {} });
    return;
  }
```

- [ ] **Step 4: Add daemon-side tool and chat executors**

These mirror the local executor but write results to the socket instead of returning strings:

```typescript
/** Execute a tool route in the daemon process. */
async function executeToolRoute(
  route: TaskRoute & { kind: "tool" },
  taskId: string, sessionId: string,
  cwd: string, client: Socket, eventLog: EventLog,
): Promise<void> {
  const { loadConfig } = await import("../config/loader.js");
  const config = await loadConfig(cwd);
  const { ToolExecutor } = await import("../tools/executor.js");
  const { randomBytes } = await import("node:crypto");

  const executor = new ToolExecutor(config, eventLog, cwd);
  const toolCallId = `daemon_${Date.now()}_${randomBytes(4).toString("hex")}`;

  safeWrite(client, { type: "assistant.text" as const, sessionId, text: `→ ${route.tool} ${JSON.stringify(route.args)}\n` });

  const result = await executor.execute({ toolCallId, name: route.tool, args: route.args });

  if (result.kind === "success") {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: result.output ?? result.content ?? "(tool completed)" });
  } else if (result.kind === "denied") {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: `Blocked by policy: ${result.reason}` });
  } else {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: `Tool error: ${result.message}` });
  }
}

/** Execute a chat route in the daemon process. */
async function executeChatRoute(
  route: TaskRoute & { kind: "chat" },
  taskId: string, sessionId: string,
  cwd: string, client: Socket, eventLog: EventLog,
): Promise<void> {
  const { loadConfig } = await import("../config/loader.js");
  const config = await loadConfig(cwd);
  const { initProvider } = await import("../providers/init.js");

  const provider = initProvider(config.model.provider, config.model.name, config.apiKeys);
  const response = await provider.complete({
    systemPrompt: "You are ALiX, a helpful AI assistant. Answer concisely.",
    messages: [{ role: "user", content: route.prompt }],
  });

  safeWrite(client, { type: "assistant.text" as const, sessionId, text: response.text || "(no response)" });
}
```

- [ ] **Step 5: Add executeGroundedChatRoute for the daemon**

```typescript
/** Execute a grounded_chat route in the daemon process. */
async function executeGroundedChatRoute(
  route: TaskRoute & { kind: "grounded_chat" },
  sessionId: string, cwd: string, client: Socket, eventLog: EventLog,
): Promise<void> {
  const { loadConfig } = await import("../config/loader.js");
  const config = await loadConfig(cwd);
  const { initProvider } = await import("../providers/init.js");
  const { ToolExecutor } = await import("../tools/executor.js");
  const { randomBytes } = await import("node:crypto");

  const provider = initProvider(config.model.provider, config.model.name, config.apiKeys);
  const executor = new ToolExecutor(config, eventLog, cwd);

  const response = await provider.complete({
    systemPrompt: "You are ALiX, a helpful AI assistant. If you need current information, use the available tools to search. Answer concisely.",
    messages: [{ role: "user", content: route.prompt }],
  });

  if (response.toolCalls.length > 0 && response.toolCalls.length <= 1) {
    const tc = response.toolCalls[0];
    const toolResult = await executor.execute({
      toolCallId: `daemon_${Date.now()}_${randomBytes(4).toString("hex")}`,
      name: tc.name,
      args: tc.args,
    });

    const toolContent = toolResult.kind === "success"
      ? (toolResult.output || toolResult.content || "(no output)")
      : `Error: ${toolResult.message}`;

    const finalResponse = await provider.complete({
      systemPrompt: "Answer the user's question based on the tool result.",
      messages: [
        { role: "user", content: route.prompt },
        { role: "assistant", content: response.text || "" },
        { role: "tool", content: toolContent },
      ],
    });
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: finalResponse.text || "(no response)" });
  } else {
    safeWrite(client, { type: "assistant.text" as const, sessionId, text: response.text || "(no response)" });
  }
}
```

- [ ] **Step 6: Remove daemon-router.ts**

```bash
git rm src/daemon/daemon-router.ts
```

- [ ] **Step 7: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/daemon/daemon-server.ts src/daemon/daemon-types.ts
git commit -m "feat(daemon): handle pre-classified routes, remove daemonShellAlias() and daemon-router.ts"
```

---

### Task 5: Update TUI daemon path to send classified route

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Replace the daemon-mode execution block**

In `runTui()`, find the daemon path (`if (daemonMode) { ... }`). Change it to classify first, then send the route:

```typescript
      if (daemonMode) {
        // Classify locally, send the route to the daemon
        const route = taskRouter(task);
        await submitTaskViaDaemon({
          cwd, task,
          route, // new field — the daemon receives this instead of re-classifying
          onEvent: (event) => { const line = formatDaemonEvent(event); if (line) tui.appendOutput(line, false); },
          onError: (err) => tui.appendOutput(`Error: ${err}`, false),
          onDone: async () => { const fresh = await buildRuntimeSnapshot(cwd); if (fresh) applySnapshotToStore(tuiStore, fresh); },
        });
      }
```

- [ ] **Step 2: Update submitTaskViaDaemon to accept and send route**

In `src/tui/daemon-client.ts`, update the options type and the socket write:

```typescript
export interface DaemonClientOptions {
  cwd: string;
  task: string;
  route?: import("../runtime/task-router.js").TaskRoute;
  onEvent: (event: DaemonResponse & { raw?: string }) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

// In submitTaskViaDaemon, change the socket write:
client.write(JSON.stringify({
  command: "run",
  task: opts.task,
  route: opts.route,
}) + "\n");
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/tui.ts src/tui/daemon-client.ts
git commit -m "feat(tui): classify task locally before sending route to daemon"
```

---

### Task 6: Router unit tests

**Files:**
- Create: `tests/runtime/task-router.test.ts`

- [ ] **Step 1: Write classification tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter, isGroundedChatTask } from "../../src/runtime/task-router.js";

describe("taskRouter", () => {
  // ── Tool routes (shell commands) ──
  it("routes 'ls' to tool.shell.run", () => {
    const r = taskRouter("ls");
    assert.equal(r.kind, "tool");
    if (r.kind === "tool") {
      assert.equal(r.tool, "shell.run");
      assert.equal(r.args.command, "ls");
    }
  });

  it("routes 'ls -la' to tool.shell.run", () => {
    const r = taskRouter("ls -la");
    assert.equal(r.kind, "tool");
  });

  it("routes 'pwd' to tool.shell.run", () => {
    const r = taskRouter("pwd");
    assert.equal(r.kind, "tool");
  });

  it("routes 'cat package.json' to tool.shell.run", () => {
    const r = taskRouter("cat package.json");
    assert.equal(r.kind, "tool");
  });

  it("routes 'grep -r foo src/' to tool.shell.run", () => {
    const r = taskRouter("grep -r foo src/");
    assert.equal(r.kind, "tool");
  });

  // ── Grounded chat routes (freshness signals) ──
  it("routes 'latest Node.js LTS' to grounded_chat", () => {
    const r = taskRouter("latest Node.js LTS version");
    assert.equal(r.kind, "grounded_chat");
    if (r.kind === "grounded_chat") {
      assert.ok(r.allowedTools.includes("web.search"), "should include web.search");
      assert.equal(r.prompt, "latest Node.js LTS version");
    }
  });

  it("routes 'search the web' to grounded_chat", () => {
    const r = taskRouter("search the web for alix frameworks");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'what's the news today' to grounded_chat", () => {
    const r = taskRouter("what's the news today");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'current Python 3 version' to grounded_chat", () => {
    const r = taskRouter("current Python 3 version");
    assert.equal(r.kind, "grounded_chat");
  });

  it("routes 'look up security advisories' to grounded_chat", () => {
    const r = taskRouter("look up security advisories");
    assert.equal(r.kind, "grounded_chat");
  });

  // ── Chat routes (research/docs — no freshness signal) ──
  it("routes 'what is a closure' to chat", () => {
    const r = taskRouter("what is a closure");
    assert.equal(r.kind, "chat");
    if (r.kind === "chat") assert.equal(r.prompt, "what is a closure");
  });

  it("routes 'explain OOP principles' to chat", () => {
    const r = taskRouter("explain OOP principles");
    assert.equal(r.kind, "chat");
  });

  it("routes 'write a story about AI' to chat", () => {
    const r = taskRouter("write a story about AI");
    assert.equal(r.kind, "chat");
  });

  it("routes 'research quantum computing' to chat", () => {
    const r = taskRouter("research quantum computing");
    assert.equal(r.kind, "chat");
  });

  // ── Agent routes (feature/bugfix/refactor/unknown) ──
  it("routes 'refactor the auth module' to agent", () => {
    const r = taskRouter("refactor the auth module");
    assert.equal(r.kind, "agent");
  });

  it("routes 'implement login feature' to agent", () => {
    const r = taskRouter("implement login feature");
    assert.equal(r.kind, "agent");
  });

  it("routes 'fix the null pointer bug' to agent", () => {
    const r = taskRouter("fix the null pointer bug");
    assert.equal(r.kind, "agent");
  });

  it("routes 'add a button' to agent", () => {
    const r = taskRouter("add a new button to the dashboard");
    assert.equal(r.kind, "agent");
  });

  it("routes 'unknown gibberish' to agent (fallthrough)", () => {
    const r = taskRouter("flargle bargle wargle");
    assert.equal(r.kind, "agent");
  });
});

describe("isGroundedChatTask", () => {
  it("detects 'latest' keyword", () => {
    assert.ok(isGroundedChatTask("latest node version"));
  });
  it("detects 'search web'", () => {
    assert.ok(isGroundedChatTask("search the web for docs"));
  });
  it("rejects plain research", () => {
    assert.ok(!isGroundedChatTask("explain quantum computing"));
  });
});
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/runtime/task-router.test.js 2>&1
```

Expected: all 20+ tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/task-router.test.ts
git commit -m "test(runtime): add task router classification unit tests"
```

---

### Task 7: Route executor tests

**Files:**
- Create: `tests/runtime/route-executor.test.ts`

- [ ] **Step 1: Write executor dispatch tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeRoute, type RuntimeContext, type RuntimeExecutor } from "../../src/runtime/route-executor.js";

describe("executeRoute dispatch", () => {
  const mockCtx: RuntimeContext = {
    cwd: "/tmp",
    sessionId: "test",
    sessionDir: "/tmp/.alix/sessions/test",
    eventLog: {} as any,
    config: {} as any,
  };

  const mockExecutor: RuntimeExecutor = {
    executeTool: async (r) => `tool:${r.tool}:${JSON.stringify(r.args)}`,
    executeChat: async (r) => `chat:${r.prompt}`,
    executeGroundedChat: async (r) => `grounded:${r.prompt}:${r.allowedTools.join(",")}`,
    executeAgent: async (r) => `agent:${r.task}`,
  };

  it("dispatches tool route to executeTool", async () => {
    const result = await executeRoute(
      { kind: "tool", tool: "shell.run", args: { command: "ls" } },
      mockCtx, mockExecutor,
    );
    assert.equal(result, 'tool:shell.run:{"command":"ls"}');
  });

  it("dispatches chat route to executeChat", async () => {
    const result = await executeRoute(
      { kind: "chat", prompt: "hello" },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "chat:hello");
  });

  it("dispatches grounded_chat route to executeGroundedChat", async () => {
    const result = await executeRoute(
      { kind: "grounded_chat", prompt: "latest news", allowedTools: ["web.search"] },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "grounded:latest news:web.search");
  });

  it("dispatches agent route to executeAgent", async () => {
    const result = await executeRoute(
      { kind: "agent", task: "fix bugs" },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "agent:fix bugs");
  });
});
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/runtime/route-executor.test.js 2>&1
```

Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/route-executor.test.ts
git commit -m "test(runtime): add route executor dispatch tests"
```

---

### Task 8: Daemon integration tests

**Files:**
- Create: `tests/daemon/daemon-server.test.ts`

- [ ] **Step 1: Write daemon server integration tests**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Integration test for the daemon server.
 * Tests that each route kind (tool, chat, grounded_chat, agent)
 * produces the expected event stream over the socket.
 */
describe("Daemon server route execution", { timeout: 30000 }, () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "daemon-srv-test-"));
  const socketPath = join(tmpDir, "test.sock");
  const cwd = tmpDir;
  let serverProcess: any = null;

  before(() => {
    mkdirSync(join(tmpDir, ".alix"), { recursive: true });
    mkdirSync(join(tmpDir, ".alix", "sessions"), { recursive: true });
    writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
      model: { provider: "mock", name: "mock" },
    }));
  });

  after(() => {
    if (serverProcess) try { serverProcess.kill(); } catch { /* ignore */ }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function startDaemon(): Promise<void> {
    return new Promise((resolve, reject) => {
      const serverJs = join(__dirname, "..", "..", "src", "daemon", "daemon-server.js");
      serverProcess = spawn(process.execPath, [serverJs, "--socket", socketPath, "--cwd", cwd], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverProcess.stderr.on("data", (data: Buffer) => {
        if (data.toString().includes("listening")) resolve();
      });
      serverProcess.on("error", reject);
      setTimeout(() => reject(new Error("Daemon did not start within 5s")), 5000);
    });
  }

  function submitWithRoute(route: any): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const messages: string[] = [];
      const client = connect(socketPath, () => {
        client.write(JSON.stringify({ command: "run", task: "test", route }) + "\n");
      });
      client.on("data", (data: Buffer) => {
        for (const line of data.toString().trim().split("\n")) {
          if (!line.trim()) continue;
          messages.push(line);
          const msg = JSON.parse(line);
          if (msg.type === "session.ended") client.end();
        }
      });
      client.on("error", reject);
      client.on("close", () => resolve(messages));
    });
  }

  it("executes tool route via daemon", async () => {
    await startDaemon();
    const messages = await submitWithRoute({
      kind: "tool", tool: "shell.run", args: { command: "echo hello" },
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
    assert.ok(messages.some(m => m.includes("session.ended")), "expected session.ended");
  });

  it("executes chat route via daemon", async () => {
    const messages = await submitWithRoute({
      kind: "chat", prompt: "say hello",
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
  });

  it("executes grounded_chat route via daemon", async () => {
    const messages = await submitWithRoute({
      kind: "grounded_chat", prompt: "latest Node.js version", allowedTools: ["web.search"],
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
  });

  it("executes agent route (falls through to runTask) via daemon", async () => {
    const messages = await submitWithRoute({
      kind: "agent", task: "count files in current directory",
    });
    assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text");
    assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
  });

  it("backward compatible: raw task without route is classified server-side", async () => {
    const messages: string[] = [];
    const client = connect(socketPath, () => {
      client.write(JSON.stringify({ command: "run", task: "pwd" }) + "\n");
    });
    client.on("data", (data: Buffer) => {
      for (const line of data.toString().trim().split("\n")) {
        if (!line.trim()) continue;
        messages.push(line);
        const msg = JSON.parse(line);
        if (msg.type === "session.ended") client.end();
      }
    });
    client.on("close", () => {
      assert.ok(messages.some(m => m.includes("assistant.text")), "expected assistant.text for backward-compat task");
      assert.ok(messages.some(m => m.includes("task.completed")), "expected task.completed");
    });
  });
});
```

- [ ] **Step 2: Build and run integration tests**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/daemon/daemon-server.test.js 2>&1
```

Expected: 5 integration tests pass (4 route kinds + backward compat).

- [ ] **Step 3: Run full daemon test suite**

```bash
node --test dist/tests/daemon/*.test.js 2>&1
```

Expected: all daemon tests pass (manager, protocol, server).

- [ ] **Step 4: Commit**

```bash
git add tests/daemon/daemon-server.test.ts
git commit -m "test(daemon): add route-based daemon server integration tests"
```

---

### Task 9: Full build, push, tag

- [ ] **Step 1: Build and run all tests**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/*.test.js 2>&1
node --test dist/tests/daemon/*.test.js 2>&1
node --test dist/tests/kernel/graph-executor.test.js 2>&1 | tail -5
```

- [ ] **Step 2: Verify detect_changes shows expected files only**

```bash
git diff --stat HEAD
git log --oneline HEAD~5..HEAD
```

Expected files:
- `src/runtime/task-router.ts` (new)
- `src/runtime/route-executor.ts` (new)
- `src/cli/commands/tui.ts` (modified)
- `src/tui/daemon-client.ts` (modified)
- `src/daemon/daemon-server.ts` (modified)
- `src/daemon/daemon-types.ts` (modified)
- `src/daemon/daemon-router.ts` (deleted)
- `tests/runtime/task-router.test.ts` (new)
- `tests/runtime/route-executor.test.ts` (new)
- `tests/daemon/daemon-server.test.ts` (new)

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.24-task-router -m "M0.24 shared task router: tool/chat/grounded_chat/agent routing for TUI and daemon"
git push origin m0.24-task-router
```

---

## Verification checklist

| Check | Command | Expected |
|-------|---------|----------|
| Router unit tests pass | `node --test dist/tests/runtime/task-router.test.js` | 20+ tests green |
| Executor dispatch tests pass | `node --test dist/tests/runtime/route-executor.test.js` | 4 tests green |
| Daemon integration tests pass | `node --test dist/tests/daemon/daemon-server.test.js` | 5 tests green |
| All tests green | `npm run test:node` | All passing |
| No-daemon "pwd" returns cwd | `node dist/src/cli.js tui --mode bypass` | tool: shell.run output |
| Daemon "pwd" returns cwd | `node dist/src/cli.js tui --daemon --mode bypass` | tool: shell.run output |
| No-daemon "latest Node.js" responds | `node dist/src/cli.js tui --mode bypass` | grounded_chat response |
| Daemon "latest Node.js" responds | `node dist/src/cli.js tui --daemon --mode bypass` | grounded_chat response |
| Same task, same route (both modes) | Both TUI modes on `"explain OOP"` | Both return chat response |
| `daemonShellAlias()` is gone | `grep -rn daemonShellAlias src/` | no matches |
| `daemon-router.ts` is gone | `ls src/daemon/daemon-router.ts 2>&1` | "No such file" |
| `taskRouter()` is in src/runtime/ | `grep -n "export function taskRouter" src/runtime/task-router.ts` | line found |
