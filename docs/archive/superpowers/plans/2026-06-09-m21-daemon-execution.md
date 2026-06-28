# M0.21: Daemon-Backed Task Execution

**Status:** ✅ Completed (M0.21) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the daemon's `run` command to execute real tasks through `runTask()`, streaming model/tool events back through the Unix socket.

**Architecture:** The daemon process imports `runTask()` from the existing ALiX runtime and calls it for each submitted task. Events are streamed back to the client as JSON-line messages and simultaneously written to `.alix/sessions/` for RuntimeIndex compatibility. A simple task queue manages concurrency.

**Tech Stack:** TypeScript, `node:net` (Unix socket), existing `src/run.ts` runtime.

---

## Key Design Decisions

- **Protocol types:** Formalize the daemon command/response protocol as shared types that both `daemon-server.ts` and `cli.ts` (submit handler) consume
- **Streaming:** `runTask()` already supports streaming via `AlixEvent` emission. The daemon taps into the event log and forwards each line to the socket client
- **Task queue:** Simple FIFO queue in the daemon process. One task runs at a time; additional tasks are queued and processed sequentially
- **Config reuse:** Daemon loads the same config as CLI (`loadConfig(cwd)`), so provider keys, models, and permissions work identically
- **Error isolation:** A crashing task doesn't crash the daemon

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/daemon/daemon-types.ts` | **Create** | Shared command/response protocol types |
| `src/daemon/daemon-server.ts` | **Modify** | Replace lifecycle-only `run` with real `runTask()` execution + streaming |
| `src/cli.ts` | **Modify** | Update `submit` handler for streaming multi-line responses |
| `tests/daemon/daemon-protocol.test.ts` | **Create** | Protocol type tests |

---

### Task 1: Protocol types

**Files:**
- Create: `src/daemon/daemon-types.ts`

- [ ] **Step 1: Define the daemon protocol types**

```typescript
/**
 * daemon-types.ts — Shared protocol types for daemon client/server communication.
 *
 * Commands are JSON-line messages sent from client to server.
 * Responses are JSON-line messages sent from server to client.
 */

/** Commands a client can send to the daemon. */
export type DaemonCommand =
  | { command: "run"; task: string; sessionMode?: string; planMode?: boolean }
  | { command: "ping" }
  | { command: "status" }
  | { command: "cancel"; sessionId: string };

/** Response events the daemon sends back. */
export type DaemonResponse =
  | { type: "session.started"; sessionId: string }
  | { type: "task.accepted"; sessionId: string; task: string }
  | { type: "task.completed"; sessionId: string; status: string }
  | { type: "task.failed"; sessionId: string; error: string }
  | { type: "task.progress"; sessionId: string; message: string }
  | { type: "tool.event"; sessionId: string; toolName?: string; status?: string; outputPreview?: string }
  | { type: "session.ended"; sessionId: string }
  | { type: "queue.position"; position: number }
  | { type: "error"; message: string }
  | { type: "pong"; sessionId?: string }
  | { type: "cancelled"; sessionId: string };
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon/daemon-types.ts
git commit -m "feat(daemon): add shared command/response protocol types"
```

---

### Task 2: Wire daemon run command to runTask()

**Files:**
- Modify: `src/daemon/daemon-server.ts`

- [ ] **Step 1: Import runTask and protocol types**

Replace the current `handleCommand` with one that calls `runTask()` for `run` commands, emits real events, and streams them back to the client.

The key changes:

**Imports:**
```typescript
import type { DaemonCommand, DaemonResponse } from "./daemon-types.js";
```

**EventLog integration:** Create a pass-through EventLog that writes events to the session file AND forwards them to the socket client:

```typescript
function createDaemonEventLog(sessionId: string, client: Socket): EventLog {
  const events: any[] = [];
  return {
    append: async (event: any) => {
      events.push(event);
      const line = JSON.stringify({ ...event, seq: events.length });
      // Write to session file
      const sessionDir = join(cwd, ".alix", "sessions", sessionId);
      if (!existsSync(sessionDir)) await mkdir(sessionDir, { recursive: true });
      await appendFile(join(sessionDir, "events.jsonl"), line + "\n", "utf-8");
      // Forward tool events to client
      if (event.type?.startsWith("tool.") || event.type === "policy.decision" || event.type === "session.started" || event.type === "session.ended") {
        client.write(line + "\n");
      }
    },
  };
}
```

**Updated run handler:**
```typescript
async function handleRun(task: string, client: Socket): Promise<void> {
  const sessionId = `daemon_${Date.now()}_${randomUUID().slice(0, 8)}`;
  currentSessionId = sessionId;

  // Emit session.started
  client.write(JSON.stringify({ type: "session.started", sessionId } satisfies DaemonResponse) + "\n");
  const eventLog = createDaemonEventLog(sessionId, client);

  await eventLog.append({
    sessionId, actor: "system", type: "session.started",
    payload: { task, source: "daemon" },
  });

  try {
    // Load config and call runTask
    const { loadConfig } = await import("../config/loader.js");
    const config = await loadConfig(cwd);
    const { runTask } = await import("../run.js");

    const result = await runTask(cwd, task, {
      planMode: false,
      config,
      eventLog,
      sessionId,
    });

    currentSessionId = undefined;

    if (result.status === "completed" || result.status === "done") {
      client.write(JSON.stringify({ type: "task.completed", sessionId, status: result.status } satisfies DaemonResponse) + "\n");
    } else {
      client.write(JSON.stringify({ type: "task.failed", sessionId, error: result.reason || "Unknown error" } satisfies DaemonResponse) + "\n");
    }
  } catch (err: any) {
    currentSessionId = undefined;
    client.write(JSON.stringify({ type: "task.failed", sessionId, error: err.message } satisfies DaemonResponse) + "\n");
  }

  await eventLog.append({ sessionId, actor: "system", type: "session.ended" });
  client.write(JSON.stringify({ type: "session.ended", sessionId } satisfies DaemonResponse) + "\n");
}
```

**Update handleCommand to dispatch to handleRun:**
```typescript
async function handleCommand(cmd: Record<string, unknown>, client: Socket): Promise<void> {
  if (cmd.command === "run") {
    await handleRun(String(cmd.task || ""), client);
    return;
  }
  if (cmd.command === "ping") {
    client.write(JSON.stringify({ type: "pong", sessionId: currentSessionId } satisfies DaemonResponse) + "\n");
    return;
  }
  client.write(JSON.stringify({ type: "error", message: `Unknown command: ${cmd.command}` } satisfies DaemonResponse) + "\n");
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/daemon-server.ts
git commit -m "feat(daemon): wire daemon run command to runTask with event streaming"
```

---

### Task 3: Task queue

**Files:**
- Modify: `src/daemon/daemon-server.ts`

- [ ] **Step 1: Add a task queue**

Add before the server creation:

```typescript
const taskQueue: Array<{ task: string; client: Socket }> = [];
let taskRunning = false;

async function processQueue(): Promise<void> {
  if (taskRunning || taskQueue.length === 0) return;
  taskRunning = true;
  const { task, client } = taskQueue.shift()!;
  try {
    await handleRun(task, client);
  } finally {
    taskRunning = false;
    processQueue(); // process next
  }
}
```

Update the `run` handler in `handleCommand` to queue instead of executing directly:

```typescript
if (cmd.command === "run") {
  taskQueue.push({ task: String(cmd.task || ""), client });
  if (taskQueue.length === 1) {
    processQueue();
  } else {
    client.write(JSON.stringify({ type: "queue.position", position: taskQueue.length } satisfies DaemonResponse) + "\n");
  }
  return;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/daemon-server.ts
git commit -m "feat(daemon): add task queue with sequential execution"
```

---

### Task 4: Update submit CLI for streaming

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Update the submit handler**

Find the existing `submit` handler (around line 1891). Replace it with a streaming-aware version that handles multi-line responses, tool events, and completion:

```typescript
if (command === "submit") {
  const task = args.join(" ").replace(/^["']|["']$/g, "");
  if (!task) { console.error("Usage: alix submit \"<task>\""); process.exit(1); }
  const { DaemonManager } = await import("./daemon/daemon-manager.js");
  const mgr = new DaemonManager(process.cwd());
  const running = await mgr.isRunning();
  if (!running) { console.error("Daemon is not running. Start it with: alix daemon start"); process.exit(1); }

  const status = await mgr.status();
  const socketPath = status?.socketPath;
  if (!socketPath) { console.error("No socket path found in daemon status."); process.exit(1); }

  const { connect } = await import("node:net");
  const client = connect(socketPath, () => {
    client.write(JSON.stringify({ command: "run", task }) + "\n");
  });

  let done = false;

  client.on("data", (data: Buffer) => {
    for (const line of data.toString().trim().split("\n")) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "session.started") console.log(`Session: ${msg.sessionId}`);
        else if (msg.type === "task.accepted") console.log(`Task accepted: ${msg.task}`);
        else if (msg.type === "queue.position") console.log(`Queue position: ${msg.position}`);
        else if (msg.type === "tool.started") console.log(`  → ${msg.toolName || "tool"} started`);
        else if (msg.type === "tool.completed") console.log(`  ✓ ${msg.toolName || "tool"} completed${msg.durationMs ? ` (${msg.durationMs}ms)` : ""}`);
        else if (msg.type === "tool.failed") console.log(`  ✗ ${msg.toolName || "tool"} failed${msg.error ? ": " + msg.error.slice(0, 60) : ""}`);
        else if (msg.type === "task.completed") {
          console.log(`\nTask completed: ${msg.status}`);
          done = true;
          client.end();
        } else if (msg.type === "task.failed") {
          console.error(`\nTask failed: ${msg.error}`);
          done = true;
          client.end();
        } else if (msg.type === "session.ended") {
          if (!done) client.end();
        }
      } catch {
        console.log(line);
      }
    }
  });

  client.on("error", (err: Error) => {
    console.error(`Connection error: ${err.message}`);
    process.exit(1);
  });

  client.on("close", () => process.exit(0));
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): update submit handler for streaming daemon events"
```

---

### Task 5: Protocol tests

**Files:**
- Create: `tests/daemon/daemon-protocol.test.ts`

- [ ] **Step 1: Test protocol type parsing**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Daemon protocol", () => {
  it("parses a run command", () => {
    const raw = JSON.stringify({ command: "run", task: "write a story" });
    const cmd = JSON.parse(raw);
    assert.equal(cmd.command, "run");
    assert.equal(cmd.task, "write a story");
  });

  it("parses a ping command", () => {
    const raw = JSON.stringify({ command: "ping" });
    const cmd = JSON.parse(raw);
    assert.equal(cmd.command, "ping");
  });

  it("formats a session.started response", () => {
    const msg = { type: "session.started" as const, sessionId: "sess_123" };
    const raw = JSON.stringify(msg);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.type, "session.started");
    assert.equal(parsed.sessionId, "sess_123");
  });

  it("formats a tool.event response", () => {
    const msg = { type: "tool.event" as const, sessionId: "sess_1", toolName: "file.create", status: "completed" };
    const raw = JSON.stringify(msg);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.toolName, "file.create");
  });

  it("formats a queue.position response", () => {
    const msg = { type: "queue.position" as const, position: 3 };
    const raw = JSON.stringify(msg);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.position, 3);
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/daemon/daemon-protocol.test.js dist/tests/daemon/daemon-manager.test.js 2>&1
```

Expected: 9 tests pass (5 protocol + 4 manager).

- [ ] **Step 3: Commit**

```bash
git add tests/daemon/daemon-protocol.test.ts
git commit -m "test(daemon): add daemon protocol type parsing tests"
```

---

### Task 6: Full build, tag, push

- [ ] **Step 1: Build and run all daemon tests**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/daemon/*.test.js 2>&1
```

- [ ] **Step 2: Push and tag**

```bash
git push
git tag -a m0.21-daemon-execution-baseline -m "M0.21 daemon-backed task execution baseline"
git push origin m0.21-daemon-execution-baseline
```
