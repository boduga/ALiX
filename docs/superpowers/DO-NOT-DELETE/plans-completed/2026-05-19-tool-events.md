# Event Schema Alignment: Tool Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize tool events from `tool_call` to `tool.requested`/`tool.started`/`tool.output`/`tool.completed`/`tool.failed` per event-kernel-schema.md.

**Architecture:** Replace `tool_call` stream events with distinct lifecycle events. Tool execution becomes the authoritative source for `tool.completed`/`tool.failed`.

**Tech Stack:** TypeScript, existing tool executor, EventLog

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/events/types.ts` | Add tool event payload types |
| `src/providers/types.ts` | Standardize ToolCall type |
| `src/tools/executor.ts` | Emit tool lifecycle events |
| `src/run.ts` | Update stream handling |
| `tests/events/tool-events.test.ts` | Tool event tests |

---

## Task 1: Add Tool Event Payload Types

**Files:**
- Modify: `src/events/types.ts`
- Test: `tests/events/tool-events.test.ts`

- [ ] **Step 1: Add tool event payload types**

Replace/update `ToolEventPayload` in `src/events/types.ts` (around line 30):

```typescript
export type ToolRequestPayload = {
  toolCallId: string;
  toolName: string;
  capability: string;
  argsPreview: Record<string, unknown>;
};

export type ToolStartedPayload = {
  toolCallId: string;
  toolName: string;
};

export type ToolOutputPayload = {
  toolCallId: string;
  outputRef?: string;
  outputPreview?: string;
  outputSize: number;
};

export type ToolCompletedPayload = {
  toolCallId: string;
  toolName: string;
  status: "success" | "cancelled";
  durationMs: number;
};

export type ToolFailedPayload = {
  toolCallId: string;
  toolName: string;
  error: string;
  durationMs: number;
};

export const TOOL_EVENT_TYPES = {
  REQUESTED: "tool.requested",
  STARTED: "tool.started",
  OUTPUT: "tool.output",
  COMPLETED: "tool.completed",
  FAILED: "tool.failed",
} as const;
```

- [ ] **Step 2: Write tests for payload types**

Create `tests/events/tool-events.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import type {
  ToolRequestPayload,
  ToolCompletedPayload,
  ToolFailedPayload,
} from "../../src/events/types.js";

describe("Tool Event Payload Types", () => {
  it("ToolRequestPayload tracks tool call details", () => {
    const payload: ToolRequestPayload = {
      toolCallId: "call-123",
      toolName: "alix_file_read",
      capability: "file.read",
      argsPreview: { path: "src/index.ts" },
    };
    assert.equal(payload.toolCallId, "call-123");
    assert.equal(payload.capability, "file.read");
  });

  it("ToolCompletedPayload includes duration", () => {
    const payload: ToolCompletedPayload = {
      toolCallId: "call-123",
      toolName: "alix_file_read",
      status: "success",
      durationMs: 42,
    };
    assert.equal(payload.status, "success");
    assert.equal(payload.durationMs, 42);
  });

  it("ToolFailedPayload includes error details", () => {
    const payload: ToolFailedPayload = {
      toolCallId: "call-123",
      toolName: "alix_shell_run",
      error: "Command failed with exit code 1",
      durationMs: 150,
    };
    assert.ok(payload.error.includes("exit code 1"));
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/events/tool-events.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/events/types.ts tests/events/tool-events.test.ts
git commit -m "feat(events): add standardized tool event payload types"
```

---

## Task 2: Update ToolExecutor to Emit Lifecycle Events

**Files:**
- Modify: `src/tools/executor.ts`
- Test: `tests/tools/executor-events.test.ts`

- [ ] **Step 1: Read current executor implementation**

Check how tools are currently executed:
```bash
cat src/tools/executor.ts
```

- [ ] **Step 2: Add event emission to executor**

Modify `src/tools/executor.ts` to accept EventLog and emit lifecycle events:

```typescript
import type { EventLog } from "../events/event-log.js";
import { TOOL_EVENT_TYPES } from "../events/types.js";
import type { ToolRequestPayload, ToolCompletedPayload, ToolFailedPayload } from "../events/types.js";

export type ToolExecutorOptions = {
  eventLog?: EventLog;
  sessionId?: string;
};

export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  options: ToolExecutorOptions = {}
): Promise<{ success: boolean; result?: unknown; error?: string; durationMs: number }> {
  const { eventLog, sessionId } = options;
  const toolCallId = generateToolCallId();
  const startTime = Date.now();

  // Emit tool.requested
  if (eventLog && sessionId) {
    await eventLog.append({
      sessionId,
      actor: "agent",
      type: TOOL_EVENT_TYPES.REQUESTED,
      payload: {
        toolCallId,
        toolName,
        capability: inferCapability(toolName),
        argsPreview: sanitizeArgs(args),
      } as ToolRequestPayload,
    });
  }

  // Emit tool.started
  if (eventLog && sessionId) {
    await eventLog.append({
      sessionId,
      actor: "system",
      type: TOOL_EVENT_TYPES.STARTED,
      payload: { toolCallId, toolName } as ToolStartedPayload,
    });
  }

  try {
    const result = await executeToolImplementation(toolName, args);
    const durationMs = Date.now() - startTime;

    // Emit tool.output (for large outputs, write to file)
    const outputRef = result.outputSize > LARGE_OUTPUT_THRESHOLD
      ? await writeOutputToFile(result.value)
      : undefined;

    if (eventLog && sessionId) {
      await eventLog.append({
        sessionId,
        actor: "system",
        type: TOOL_EVENT_TYPES.OUTPUT,
        payload: {
          toolCallId,
          outputRef,
          outputPreview: truncateOutput(result.value),
          outputSize: result.outputSize,
        } as ToolOutputPayload,
      });
    }

    // Emit tool.completed
    if (eventLog && sessionId) {
      await eventLog.append({
        sessionId,
        actor: "system",
        type: TOOL_EVENT_TYPES.COMPLETED,
        payload: {
          toolCallId,
          toolName,
          status: "success",
          durationMs,
        } as ToolCompletedPayload,
      });
    }

    return { success: true, result: result.value, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Emit tool.failed
    if (eventLog && sessionId) {
      await eventLog.append({
        sessionId,
        actor: "system",
        type: TOOL_EVENT_TYPES.FAILED,
        payload: {
          toolCallId,
          toolName,
          error: errorMessage,
          durationMs,
        } as ToolFailedPayload,
      });
    }

    return { success: false, error: errorMessage, durationMs };
  }
}
```

Helper functions to add:
```typescript
const LARGE_OUTPUT_THRESHOLD = 10000; // bytes

function generateToolCallId(): string {
  return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function inferCapability(toolName: string): string {
  if (toolName.startsWith("alix_file_read")) return "file.read";
  if (toolName.startsWith("alix_file_write")) return "file.write";
  if (toolName.startsWith("alix_shell")) return "shell.run";
  if (toolName.startsWith("alix_git")) return "git.operate";
  return "tool.invoke";
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  // Remove sensitive values from preview
  const sensitive = ["password", "token", "secret", "key"];
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => [
      k,
      sensitive.some((s) => k.toLowerCase().includes(s)) ? "[REDACTED]" : v,
    ])
  );
}

function truncateOutput(output: unknown, maxLen = 500): string {
  const str = typeof output === "string" ? output : JSON.stringify(output);
  return str.length > maxLen ? str.slice(0, maxLen) + "..." : str;
}

async function writeOutputToFile(output: unknown): Promise<string> {
  // Write to .alix/sessions/<session>/artifacts/tool-output/<toolCallId>
  const content = typeof output === "string" ? output : JSON.stringify(output, null, 2);
  const path = join(artifactsDir, `${toolCallId}.txt`);
  await writeFile(path, content, "utf8");
  return path;
}
```

- [ ] **Step 3: Write executor event tests**

Create `tests/tools/executor-events.test.ts`:

```typescript
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { EventLog } from "../../src/events/event-log.js";
import { executeTool } from "../../src/tools/executor.js";

describe("Tool Executor Events", () => {
  const testDir = join(process.cwd(), ".test-tool-events");
  let eventLog: EventLog;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    eventLog = new EventLog(testDir);
    await eventLog.init();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("emits tool.requested with args preview", async () => {
    await executeTool("alix_file_read", { path: "src/index.ts" }, {
      eventLog,
      sessionId: "test-session",
    });

    const events = await eventLog.readAll();
    const requested = events.find((e) => e.type === "tool.requested");
    assert.ok(requested);
    const payload = requested.payload as any;
    assert.equal(payload.toolName, "alix_file_read");
    assert.equal(payload.capability, "file.read");
    assert.ok(payload.argsPreview.path);
  });

  it("emits tool.completed on success", async () => {
    await executeTool("alix_file_read", { path: "src/index.ts" }, {
      eventLog,
      sessionId: "test-session",
    });

    const events = await eventLog.readAll();
    const completed = events.find((e) => e.type === "tool.completed");
    assert.ok(completed);
    assert.equal((completed.payload as any).status, "success");
    assert.ok((completed.payload as any).durationMs > 0);
  });

  it("emits tool.failed on error", async () => {
    await executeTool("alix_nonexistent", {}, {
      eventLog,
      sessionId: "test-session",
    });

    const events = await eventLog.readAll();
    const failed = events.find((e) => e.type === "tool.failed");
    assert.ok(failed);
    assert.ok((failed.payload as any).error);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/tools/executor-events.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools/executor.ts tests/tools/executor-events.test.ts
git commit -m "feat(executor): emit standardized tool lifecycle events"
```

---

## Task 3: Update run.ts Stream Handling

**Files:**
- Modify: `src/run.ts`
- Test: `tests/run/tool-events-stream.test.ts`

- [ ] **Step 1: Find tool_call stream handler**

Search for where `tool_call` events are handled:
```bash
grep -n "type.*tool_call\|onStream.*tool" src/run.ts
```

- [ ] **Step 2: Remove tool_call stream event**

The `tool_call` stream event should be replaced by executor events. Remove from stream handling:

```typescript
// REMOVE or deprecate:
onStream?.({ type: "tool_call", toolCall: chunk.toolCall });
```

- [ ] **Step 3: Pass eventLog to executor**

Find where tools are executed in the agent loop and pass eventLog:

```typescript
import { executeTool } from "./tools/executor.js";

// In tool execution:
const result = await executeTool(toolName, args, {
  eventLog,
  sessionId,
});
```

- [ ] **Step 4: Update frontend transport**

If frontend uses SSE, ensure it can receive the new event types. Check `src/server/sse.ts`:

```typescript
// Update event type filter to include new tool events:
const TOOL_EVENT_FILTER = [
  "tool.requested",
  "tool.started",
  "tool.output",
  "tool.completed",
  "tool.failed",
];
```

- [ ] **Step 5: Write integration test**

Create `tests/run/tool-events-stream.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Tool Events in Event Log", () => {
  it("contains tool events in sequence", async () => {
    // Read from a recent session's events.jsonl
    // Verify tool.requested appears before tool.started
    // Verify tool.completed appears after tool.started
    // Verify tool.failed appears instead of tool.completed on error
  });
});
```

- [ ] **Step 6: Commit**

```bash
git add src/run.ts src/server/sse.ts
git commit -m "refactor(run): remove tool_call stream, use executor events"
```

---

## Task 4: Add Capability Inference Service

**Files:**
- Create: `src/tools/capability-map.ts`
- Test: `tests/tools/capability-map.test.ts`

- [ ] **Step 1: Create capability map**

Create `src/tools/capability-map.ts`:

```typescript
type Capability =
  | "file.read"
  | "file.write"
  | "file.delete"
  | "shell.run"
  | "shell.readonly"
  | "git.diff"
  | "git.commit"
  | "git.push"
  | "network.fetch"
  | "secret.read"
  | "browser.open"
  | "mcp.invoke"
  | "tool.invoke";

const TOOL_CAPABILITY_MAP: Record<string, Capability> = {
  "alix_file_read": "file.read",
  "alix_file_write": "file.write",
  "alix_file_create": "file.write",
  "alix_shell_run": "shell.run",
  "alix_shell_readonly": "shell.readonly",
  "alix_git_diff": "git.diff",
  "alix_git_commit": "git.commit",
  "alix_git_push": "git.push",
  "mcp_tool": "mcp.invoke",
};

export function inferCapability(toolName: string): Capability {
  return TOOL_CAPABILITY_MAP[toolName] ?? "tool.invoke";
}

export function isReadonlyCapability(capability: Capability): boolean {
  return (
    capability === "file.read" ||
    capability === "shell.readonly" ||
    capability === "git.diff"
  );
}

export function requiresApproval(capability: Capability, policy: PolicyConfig): "allow" | "ask" | "deny" {
  return policy.tools[capability] ?? policy.default;
}
```

- [ ] **Step 2: Write tests**

Create `tests/tools/capability-map.test.ts`:

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { inferCapability, isReadonlyCapability } from "../../src/tools/capability-map.js";

describe("Capability Map", () => {
  it("maps file tools to file.read", () => {
    assert.equal(inferCapability("alix_file_read"), "file.read");
  });

  it("maps shell tools to shell.run", () => {
    assert.equal(inferCapability("alix_shell_run"), "shell.run");
  });

  it("maps unknown tools to tool.invoke", () => {
    assert.equal(inferCapability("unknown_tool"), "tool.invoke");
  });

  it("identifies readonly capabilities", () => {
    assert.ok(isReadonlyCapability("file.read"));
    assert.ok(isReadonlyCapability("shell.readonly"));
    assert.ok(!isReadonlyCapability("shell.run"));
    assert.ok(!isReadonlyCapability("file.write"));
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm test -- tests/tools/capability-map.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/capability-map.ts tests/tools/capability-map.test.ts
git commit -m "feat(tools): add capability inference service"
```

---

## Verification

```bash
npm test -- tests/events/tool-events.test.ts tests/tools/executor-events.test.ts tests/tools/capability-map.test.ts
```

All tests should pass. Manual verification:
- [ ] Event log contains `tool.requested` with args preview
- [ ] Event log contains `tool.started` after request
- [ ] Event log contains `tool.output` with output ref (for large output) or preview
- [ ] Event log contains `tool.completed` or `tool.failed` as final state
- [ ] Subagents can read tool event sequence for coordination
- [ ] UI timeline shows tool lifecycle

---

## Summary

| Task | Focus | Risk |
|------|-------|------|
| 1 | Event payload types | Low |
| 2 | ToolExecutor events | Medium |
| 3 | run.ts integration | Medium |
| 4 | Capability map | Low |