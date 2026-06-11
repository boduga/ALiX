# M0.32: Runtime Trace Viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn raw runtime events into a unified, readable execution timeline — a single Trace panel in the TUI that stitches together `policy.*`, `approval.*`, `continuation.*`, `tool.*`, and `task.*` events.

**Architecture:** A normalizer (`src/runtime/trace-events.ts`) converts EventLog events and daemon events into a common `TraceEvent` shape. Events are stored in `TuiState.traceEvents[]` with a filter. The Trace panel renders them chronologically. Live daemon events bridge into the trace stream.

**Tech Stack:** TypeScript/ESM, Node >= 24, EventLog (existing), TuiStore (existing), RuntimeSnapshot (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/trace-events.ts` | Create | `TraceEvent` type, `toTraceEvent()`, `traceEventsFromLog()` |
| `src/tui/store.ts` | Modify | Add `traceEvents`, `traceFilter`, selectors, mutators |
| `src/tui/runtime-snapshot.ts` | Modify | Load + normalize trace events from session log |
| `src/tui/panel-renderer.ts` | Modify | Add Trace panel rendering with filter toggle |
| `src/tui/index.ts` | Modify (minor) | Add Trace panel to panel cycle if needed |
| `src/cli/commands/tui.ts` | Modify | Bridge live events into trace stream |
| `tests/runtime/trace-events.test.ts` | Create | Event normalization tests |
| `tests/tui/trace-panel.test.ts` | Create | Filtering + rendering tests |

---

### Task 1: Create trace-events.ts

**Files:**
- Create: `src/runtime/trace-events.ts`

**Types and functions:**

```typescript
export type TraceSourceType =
  | "policy"
  | "approval"
  | "continuation"
  | "tool"
  | "task"
  | "session"
  | "daemon"
  | "runtime";

export type TraceEventFilter = "all" | TraceSourceType;

export type TraceEvent = {
  id: string;
  timestamp: string;
  sourceType: TraceSourceType;
  eventType: string;
  label: string;
  status?: "pending" | "allowed" | "denied" | "running" | "success" | "failed" | "completed";
  detail?: string;
  sessionId?: string;
  taskId?: string;
  approvalId?: string;
  continuationId?: string;
  toolCallId?: string;
  capability?: string;
  toolName?: string;
};

/**
 * Normalize a raw API-style runtime event into a TraceEvent.
 * Returns null if the event type has no trace mapping.
 */
export function toTraceEvent(event: {
  type?: string;
  action?: string;
  timestamp?: string;
  id?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}): TraceEvent | null {
  const ts = event.timestamp || event.createdAt || new Date().toISOString();
  const id = event.id || `${event.type || event.action}_${Date.now()}`;
  const type = event.type || event.action || "";
  const payload = event.payload || {};

  // Policy
  if (type === "policy.decision") {
    const decision = (payload as any).decision;
    return {
      id, timestamp: ts,
      sourceType: "policy",
      eventType: type,
      label: `policy: ${(payload as any).capability || "?"}`,
      status: decision === "allow" ? "allowed" : decision === "deny" ? "denied" : "pending",
      detail: (payload as any).reason,
      sessionId: (payload as any).sessionId,
      capability: (payload as any).capability,
    };
  }

  // Approval lifecycle
  if (type.startsWith("approval.")) {
    const p = payload as any;
    const statusMap: Record<string, string> = {
      "approval.created": "pending",
      "approval.reused": "pending",
      "approval.resolved": p.status === "approved" ? "success" : "denied",
      "approval.resumed": "success",
      "approval.resume.failed": "failed",
    };
    const labelMap: Record<string, string> = {
      "approval.created": "approval created",
      "approval.reused": "approval reused",
      "approval.resolved": `approval ${p.status || "resolved"}`,
      "approval.resumed": "approval resumed",
      "approval.resume.failed": "approval resume failed",
    };
    return {
      id, timestamp: ts,
      sourceType: "approval",
      eventType: type,
      label: `${labelMap[type] || type}`,
      status: (statusMap[type] || "pending") as any,
      detail: p.reason || "",
      sessionId: p.sessionId,
      approvalId: p.approvalId,
      capability: p.capability,
      toolName: p.toolName,
    };
  }

  // Continuation lifecycle
  if (type.startsWith("continuation.")) {
    const p = payload as any;
    return {
      id, timestamp: ts,
      sourceType: "continuation",
      eventType: type,
      label: type === "continuation.created" ? "continuation created" : "continuation consumed",
      status: type === "continuation.created" ? "pending" : "success",
      detail: p.reason || "",
      sessionId: p.sessionId,
      approvalId: p.approvalId,
      continuationId: p.continuationId || p.approvalId,
      toolName: p.toolName,
    };
  }

  // Tool lifecycle
  if (type.startsWith("tool.")) {
    const p = payload as any;
    const statusMap: Record<string, string> = {
      "tool.requested": "pending",
      "tool.started": "running",
      "tool.completed": "success",
      "tool.failed": "failed",
      "tool.output": "running",
    };
    return {
      id, timestamp: ts,
      sourceType: "tool",
      eventType: type,
      label: `${p.toolName || "tool"} ${type.replace("tool.", "")}`,
      status: (statusMap[type] || "pending") as any,
      detail: p.error || p.outputPreview || "",
      sessionId: p.sessionId,
      toolCallId: p.toolCallId || p.toolCallId,
      toolName: p.toolName,
      capability: p.capability || p.canonicalCapability,
    };
  }

  // Task events (from daemon or runtime)
  if (type.startsWith("task.") || type === "task" || (event as any).source === "task") {
    const p = payload as any;
    return {
      id, timestamp: ts,
      sourceType: "task",
      eventType: type,
      label: (payload as any)?.task || (event as any)?.task || type,
      status: type.includes("completed") || type.includes("done") ? "completed" : "running",
      detail: (payload as any)?.error || "",
      sessionId: (payload as any)?.sessionId,
      taskId: (payload as any)?.id || (payload as any)?.taskId,
    };
  }

  return null;
}

/**
 * Convert an array of event-like objects into a sorted TraceEvent array.
 */
export function traceEventsFromLog(events: any[]): TraceEvent[] {
  const traces: TraceEvent[] = [];
  for (const e of events) {
    const t = toTraceEvent(e);
    if (t) traces.push(t);
  }
  // Sort chronologically (oldest first for display, newest first for store)
  return traces.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Format a TraceEvent into a single-line display string.
 */
export function formatTraceEvent(t: TraceEvent): string {
  const time = new Date(t.timestamp).toLocaleTimeString();
  const iconMap: Record<string, string> = {
    allowed: "●",
    denied: "✗",
    pending: "○",
    running: "▶",
    success: "✔",
    failed: "✗",
    completed: "✔",
  };
  const icon = t.status ? (iconMap[t.status] || " ") : " ";
  const src = t.sourceType.padEnd(14);
  const label = t.label.slice(0, 50);
  return `  ${time}  ${icon} ${src} ${label}`;
}

/**
 * Format a TraceEvent with full detail line.
 */
export function formatTraceEventVerbose(t: TraceEvent): string {
  let line = formatTraceEvent(t);
  if (t.detail) line += `\n  ${" ".repeat(24)}${t.detail.slice(0, 80)}`;
  return line;
}
```

- [ ] **Step 1: Write `src/runtime/trace-events.ts`** with the complete content above.

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/trace-events.ts
git commit -m "feat(runtime): add trace event normalization and formatting"
```

---

### Task 2: Add trace events to TuiState

**Files:**
- Modify: `src/tui/store.ts`

- [ ] **Step 1: Import TraceEvent and TraceEventFilter**

```typescript
import type { TraceEvent, TraceEventFilter } from "../runtime/trace-events.js";
```

- [ ] **Step 2: Add to TuiState**

```typescript
export interface TuiState {
  // ... existing fields ...
  traceEvents: TraceEvent[];
  traceFilter: TraceEventFilter;
}
```

- [ ] **Step 3: Add selectors and mutators**

```typescript
  // ── Trace event selectors/mutators ──

  getFilteredTraceEvents(): TraceEvent[] {
    if (this.state.traceFilter === "all") return this.state.traceEvents;
    return this.state.traceEvents.filter(e => e.sourceType === this.state.traceFilter);
  }

  getLatestTraceEvents(limit: number): TraceEvent[] {
    const events = this.getFilteredTraceEvents();
    return events.slice(-limit).reverse();
  }

  setTraceEvents(events: TraceEvent[]): void {
    this.state.traceEvents = events;
    this.notify();
  }

  appendTraceEvent(event: TraceEvent): void {
    this.state.traceEvents.push(event);
    this.notify();
  }

  setTraceFilter(filter: TraceEventFilter): void {
    this.state.traceFilter = filter;
    this.notify();
  }
```

- [ ] **Step 4: Initialize defaults**

In the constructor's initial state:
```typescript
traceEvents: initialState?.traceEvents ?? [],
traceFilter: initialState?.traceFilter ?? "all",
```

- [ ] **Step 5: Register trace in PANELS if not already**

Check `PANELS` — it likely already has `"trace"`. If not, add it:
```typescript
export const PANELS: TuiPanel[] = ["chat", "daemon", "approvals", "sops", "policy", "runtime", "trace"];
```

And add `"trace"` to the `TuiPanel` union type:
```typescript
export type TuiPanel = "chat" | "daemon" | "approvals" | "sops" | "policy" | "runtime" | "trace";
```

- [ ] **Step 6: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add src/tui/store.ts
git commit -m "feat(tui): add trace event state, selectors, and mutators to TuiState"
```

---

### Task 3: Extend RuntimeSnapshot with trace events

**Files:**
- Modify: `src/tui/runtime-snapshot.ts`

- [ ] **Step 1: Add trace event loading to buildRuntimeSnapshot**

After the existing runtime events block that reads `RuntimeIndex`, add:

```typescript
    // Trace events — normalize from runtime events
    const { traceEventsFromLog } = await import("../runtime/trace-events.js");
    const traceEvents = traceEventsFromLog(idx.events);
    snapshot.traceEvents = traceEvents;
    snapshot.traceEventCount = traceEvents.length;
```

- [ ] **Step 2: Add traceEvents fields to TuiRuntimeSnapshot**

```typescript
export interface TuiRuntimeSnapshot {
  // ... existing fields ...
  traceEvents: import("../runtime/trace-events.js").TraceEvent[];
  traceEventCount: number;
}
```

- [ ] **Step 3: Initialize defaults**

In the snapshot constructor:
```typescript
traceEvents: [],
traceEventCount: 0,
```

- [ ] **Step 4: Add to applySnapshotToStore**

```typescript
  store.setTraceEventCount(snapshot.traceEventCount);
  store.setTraceEvents(snapshot.traceEvents);
```

- [ ] **Step 5: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/tui/runtime-snapshot.ts
git commit -m "feat(runtime): include trace events in runtime snapshot"
```

---

### Task 4: Render Trace timeline panel

**Files:**
- Modify: `src/tui/panel-renderer.ts`

- [ ] **Step 1: Add Trace panel renderer**

Add a new branch in `renderPanelContent` after the existing `"runtime"` case:

```typescript
  } else if (s.activePanel === "trace") {
    const { formatTraceEvent, formatTraceEventVerbose } = require_or_import; // dynamic import
    const { formatTraceEvent, formatTraceEventVerbose } = await import("../runtime/trace-events.js");
    const filterLabel = s.traceFilter === "all" ? "all" : s.traceFilter;
    buf.push(`── Trace (filter: ${filterLabel}) ────────────────`);
    buf.push(`Events: ${s.traceEvents.length}`);
    if (s.traceEvents.length === 0) {
      buf.push("  No trace events. Run a task to populate the timeline.");
    } else {
      const filtered = s.traceFilter === "all"
        ? s.traceEvents
        : s.traceEvents.filter(e => e.sourceType === s.traceFilter);
      const display = filtered.slice(-20).reverse();
      for (const t of display) {
        buf.push(formatTraceEvent(t));
      }
    }
    buf.push(`  t=filter  r=refresh`);
```

Using dynamic import:

```typescript
  } else if (s.activePanel === "trace") {
    buf.push(`── Trace (filter: ${s.traceFilter}) ──────────────`);
    buf.push(`Events: ${s.traceEvents.length}`);
    if (s.traceEvents.length === 0) {
      buf.push("  No trace events. Run a task to populate the timeline.");
    } else {
      const filtered = s.traceFilter === "all"
        ? s.traceEvents
        : s.traceEvents.filter(e => e.sourceType === s.traceFilter);
      const display = filtered.slice(-20).reverse();
      for (const t of display) {
        const time = new Date(t.timestamp).toLocaleTimeString();
        const iconMap: Record<string, string> = {
          allowed: "●", denied: "✗", pending: "○",
          running: "▶", success: "✔", failed: "✗", completed: "✔",
        };
        const icon = t.status ? (iconMap[t.status] || " ") : " ";
        const src = t.sourceType.padEnd(12);
        const label = t.label.slice(0, 48);
        buf.push(`  ${time} ${icon} ${src} ${label}`);
      }
    }
    buf.push(`  t=filter  r=refresh`);
```

The inline format avoids the import for simplicity.

- [ ] **Step 2: Handle filter toggle**

In the main TUI loop, add `t` key to cycle trace filter. Add this after the existing `task === "r"` / refresh block:

```typescript
    if (task.toLowerCase() === "t" && store.getState().activePanel === "trace") {
      const filters: Array<"all" | "policy" | "approval" | "continuation" | "tool" | "task"> =
        ["all", "policy", "approval", "continuation", "tool", "task"];
      const current = store.getState().traceFilter;
      const idx = filters.indexOf(current);
      const next = filters[(idx + 1) % filters.length];
      store.setTraceFilter(next);
      tui.appendOutput(`Trace filter: ${next}\n`, false);
      continue;
    }
```

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/panel-renderer.ts src/cli/commands/tui.ts
git commit -m "feat(tui): render trace timeline panel with filter toggle"
```

---

### Task 5: Bridge live daemon events into trace stream

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add trace event bridging in daemon mode onEvent**

In the daemon mode submit block, find the `onEvent` callback. After formatting the event for display, add a trace event:

```typescript
// Convert daemon events to trace events
const { toTraceEvent } = await import("../../runtime/trace-events.js");
const traceEvent = toTraceEvent(event);
if (traceEvent) {
  store.appendTraceEvent(traceEvent);
}
```

The daemon mode block currently looks like:

```typescript
await submitTaskViaDaemon({
  cwd: activeCwd, task, route,
  onEvent: (event) => {
    const line = formatDaemonEvent(event);
    if (line) tui.appendOutput(line, false);
  },
  ...
});
```

Change to:

```typescript
await submitTaskViaDaemon({
  cwd: activeCwd, task, route,
  onEvent: (event) => {
    const line = formatDaemonEvent(event);
    if (line) tui.appendOutput(line, false);
    // Bridge into trace
    (async () => {
      const { toTraceEvent } = await import("../../runtime/trace-events.js");
      const traceEvent = toTraceEvent(event);
      if (traceEvent) store.appendTraceEvent(traceEvent);
    })().catch(() => {});
  },
  ...
});
```

For local (non-daemon) mode, the events flow through `executeRoute()` → `LocalRuntimeExecutor`. The executor already logs via `EventLog`. After `executeRoute` completes, reload trace events from the current log:

```typescript
// After executeRoute completes, refresh trace events
const { traceEventsFromLog } = await import("../../runtime/trace-events.js");
// Read recent events from the event log session dir
// (simplified: trace events are populated by the snapshot on refresh)
```

For M0.32, the snapshot path (Task 3) handles historical events. The daemon bridge handles live events. Local mode trace events are populated on the next refresh or snapshot load. This is sufficient for the first pass.

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): bridge live daemon events into trace stream"
```

---

### Task 6: Trace event normalization tests

**Files:**
- Create: `tests/runtime/trace-events.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toTraceEvent, traceEventsFromLog, formatTraceEvent } from "../../src/runtime/trace-events.js";

describe("toTraceEvent", () => {
  it("converts policy.decision allow event", () => {
    const t = toTraceEvent({
      type: "policy.decision",
      timestamp: "2026-06-11T12:00:00Z",
      id: "pol_1",
      payload: { capability: "file.read", decision: "allow", reason: "Allowed by tool policy" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "policy");
    assert.equal(t!.status, "allowed");
    assert.equal(t!.capability, "file.read");
  });

  it("converts policy.decision deny event", () => {
    const t = toTraceEvent({
      type: "policy.decision",
      timestamp: "2026-06-11T12:00:01Z",
      id: "pol_2",
      payload: { capability: "shell.run", decision: "deny", reason: "Command is denied" },
    });
    assert.ok(t);
    assert.equal(t!.status, "denied");
  });

  it("converts approval.created event", () => {
    const t = toTraceEvent({
      type: "approval.created",
      timestamp: "2026-06-11T12:00:02Z",
      id: "app_1",
      payload: { approvalId: "approval_001", capability: "shell.run", reason: "Requires approval" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "approval");
    assert.equal(t!.status, "pending");
    assert.equal(t!.approvalId, "approval_001");
  });

  it("converts approval.resolved approved event", () => {
    const t = toTraceEvent({
      type: "approval.resolved",
      id: "app_2",
      payload: { approvalId: "approval_001", status: "approved", capability: "shell.run" },
    });
    assert.ok(t);
    assert.equal(t!.status, "success");
  });

  it("converts approval.resolved denied event", () => {
    const t = toTraceEvent({
      type: "approval.resolved",
      id: "app_3",
      payload: { approvalId: "approval_002", status: "denied", capability: "file.write" },
    });
    assert.ok(t);
    assert.equal(t!.status, "denied");
  });

  it("converts approval.resumed event", () => {
    const t = toTraceEvent({
      type: "approval.resumed",
      id: "app_4",
      payload: { approvalId: "approval_001", toolName: "shell.run", status: "resumed" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "approval");
    assert.equal(t!.status, "success");
    assert.equal(t!.toolName, "shell.run");
  });

  it("converts approval.resume.failed event", () => {
    const t = toTraceEvent({
      type: "approval.resume.failed",
      id: "app_5",
      payload: { approvalId: "approval_003", reason: "Args hash mismatch" },
    });
    assert.ok(t);
    assert.equal(t!.status, "failed");
    assert.equal(t!.detail, "Args hash mismatch");
  });

  it("converts continuation.created event", () => {
    const t = toTraceEvent({
      type: "continuation.created",
      id: "cont_1",
      payload: { approvalId: "approval_001", toolName: "shell.run" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "continuation");
    assert.equal(t!.status, "pending");
  });

  it("converts continuation.consumed event", () => {
    const t = toTraceEvent({
      type: "continuation.consumed",
      id: "cont_2",
      payload: { approvalId: "approval_001", continuationId: "cont_2" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "continuation");
    assert.equal(t!.status, "success");
    assert.equal(t!.continuationId, "cont_2");
  });

  it("converts tool.started event", () => {
    const t = toTraceEvent({
      type: "tool.started",
      id: "tool_1",
      payload: { toolCallId: "tc_001", toolName: "shell.run", argumentHash: "abc" },
    });
    assert.ok(t);
    assert.equal(t!.sourceType, "tool");
    assert.equal(t!.status, "running");
    assert.equal(t!.toolName, "shell.run");
    assert.equal(t!.toolCallId, "tc_001");
  });

  it("converts tool.completed event", () => {
    const t = toTraceEvent({
      type: "tool.completed",
      id: "tool_2",
      payload: { toolCallId: "tc_001", toolName: "shell.run", status: "success" },
    });
    assert.ok(t);
    assert.equal(t!.status, "success");
  });

  it("converts tool.failed event", () => {
    const t = toTraceEvent({
      type: "tool.failed",
      id: "tool_3",
      payload: { toolCallId: "tc_002", toolName: "file.write", error: "Permission denied" },
    });
    assert.ok(t);
    assert.equal(t!.status, "failed");
    assert.equal(t!.detail, "Permission denied");
  });

  it("returns null for unknown event type", () => {
    const t = toTraceEvent({ type: "unknown.type", id: "x", payload: {} });
    assert.equal(t, null);
  });
});

describe("traceEventsFromLog", () => {
  it("sorts events chronologically", () => {
    const events = [
      { type: "policy.decision", id: "e1", timestamp: "2026-06-11T12:00:03Z", payload: { capability: "c", decision: "allow" } },
      { type: "tool.started", id: "e2", timestamp: "2026-06-11T12:00:01Z", payload: { toolName: "ls", toolCallId: "tc1" } },
      { type: "tool.completed", id: "e3", timestamp: "2026-06-11T12:00:02Z", payload: { toolName: "ls", toolCallId: "tc1", status: "success" } },
    ];
    const traces = traceEventsFromLog(events);
    assert.equal(traces.length, 3);
    // Oldest first
    assert.equal(traces[0].id, "e2");
    assert.equal(traces[2].id, "e1");
  });

  it("filters out unknown types", () => {
    const events = [
      { type: "policy.decision", id: "e1", payload: { capability: "c", decision: "allow" } },
      { type: "some.random.type", id: "e2", payload: {} },
    ];
    const traces = traceEventsFromLog(events);
    assert.equal(traces.length, 1);
  });
});

describe("formatTraceEvent", () => {
  it("produces a colored string with icon and label", () => {
    const t = toTraceEvent({
      type: "tool.started",
      id: "t1",
      timestamp: "2026-06-11T12:00:00Z",
      payload: { toolName: "shell.run", toolCallId: "tc1" },
    });
    const line = formatTraceEvent(t!);
    assert.ok(line.includes("▶"));
    assert.ok(line.includes("tool"));
  });
});
```

- [ ] **Step 1: Write tests file**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/trace-events.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/trace-events.test.ts
git commit -m "test(runtime): cover trace event normalization and formatting"
```

---

### Task 7: Trace panel rendering tests

**Files:**
- Create: `tests/tui/trace-panel.test.ts`

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TuiStore } from "../../src/tui/store.js";
import type { TraceEvent, TraceEventFilter } from "../../src/runtime/trace-events.js";

function makeTraceEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "t1",
    timestamp: new Date().toISOString(),
    sourceType: "tool",
    eventType: "tool.started",
    label: "shell.run started",
    status: "running",
    ...overrides,
  };
}

describe("Trace panel state", () => {
  let store: TuiStore;

  beforeEach(() => {
    store = new TuiStore();
  });

  it("starts with empty trace events", () => {
    const state = store.getState();
    assert.deepEqual(state.traceEvents, []);
    assert.equal(state.traceFilter, "all");
  });

  it("appends trace events", () => {
    store.appendTraceEvent(makeTraceEvent({ id: "e1" }));
    assert.equal(store.getState().traceEvents.length, 1);
  });

  it("sets trace events in bulk", () => {
    const events = [makeTraceEvent({ id: "e1" }), makeTraceEvent({ id: "e2" })];
    store.setTraceEvents(events);
    assert.equal(store.getState().traceEvents.length, 2);
  });

  it("getFilteredTraceEvents returns all when filter is all", () => {
    store.appendTraceEvent(makeTraceEvent({ id: "e1", sourceType: "tool" }));
    store.appendTraceEvent(makeTraceEvent({ id: "e2", sourceType: "policy" }));
    assert.equal(store.getFilteredTraceEvents().length, 2);
  });

  it("getFilteredTraceEvents filters by sourceType", () => {
    store.setTraceFilter("tool");
    store.appendTraceEvent(makeTraceEvent({ id: "e1", sourceType: "tool" }));
    store.appendTraceEvent(makeTraceEvent({ id: "e2", sourceType: "policy" }));
    assert.equal(store.getFilteredTraceEvents().length, 1);
  });

  it("getLatestTraceEvents returns most recent N reversed", () => {
    store.setTraceEvents([
      makeTraceEvent({ id: "e1", timestamp: "2026-06-11T12:00:01Z" }),
      makeTraceEvent({ id: "e2", timestamp: "2026-06-11T12:00:02Z" }),
      makeTraceEvent({ id: "e3", timestamp: "2026-06-11T12:00:03Z" }),
    ]);
    const latest = store.getLatestTraceEvents(2);
    assert.equal(latest.length, 2);
    assert.equal(latest[0].id, "e3"); // most recent first
  });

  it("sets trace filter", () => {
    store.setTraceFilter("approval");
    assert.equal(store.getState().traceFilter, "approval");
  });
});
```

- [ ] **Step 1: Write tests file**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/tui/trace-panel.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/trace-panel.test.ts
git commit -m "test(tui): cover trace panel state, filtering, and latest events"
```

---

### Task 8: Build, verify, tag

- [ ] **Step 1: Build and run full test suite**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/policy/*.test.js dist/tests/runtime/*.test.js dist/tests/daemon/*.test.js dist/tests/tui/*.test.js dist/tests/integration/smoke.test.js --test-concurrency=1 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: Commit docs**

```bash
git add docs/superpowers/specs/2026-06-11-m32-runtime-trace-viewer-design.md docs/superpowers/plans/2026-06-11-m32-runtime-trace-viewer.md
git commit -m "docs: add M0.32 runtime trace viewer spec and plan"
```

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.32-runtime-trace-viewer -m "M0.32 Runtime Trace Viewer: unified execution timeline normalizing policy, approval, continuation, and tool events into a single TUI trace panel with filtering"
git push origin m0.32-runtime-trace-viewer
```

---

## Self-review checklist

| Check | Task | Notes |
|-------|------|-------|
| TraceEvent type covers all 8 sourceTypes | Task 1 | `policy`, `approval`, `continuation`, `tool`, `task`, `session`, `daemon`, `runtime` |
| toTraceEvent maps all event families | Task 1 | policy.decision, approval.*, continuation.*, tool.*, task.* |
| traceEventsFromLog sorts chronologically | Task 1 | `.sort()` by timestamp |
| TuiState stores traceEvents + filter | Task 2 | Array + filter selector |
| Snapshot loads trace events | Task 3 | Normalizes from RuntimeIndex events |
| Trace panel renders with filter toggle | Task 4 | Panel branch + `t` key handler |
| Live daemon events bridge into trace | Task 5 | onEvent callback appends trace events |
| Normalization tests | Task 6 | 15 tests covering all event families |
| State/filter tests | Task 7 | 7 tests covering append, filter, latest |
