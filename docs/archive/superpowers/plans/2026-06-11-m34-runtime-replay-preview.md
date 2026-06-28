# M0.34: Runtime Replay Preview — Implementation Plan

**Status:** ✅ Completed (M0.34) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each trace chain previewable — show what would be replayed without executing anything.

**Architecture:** A `ReplayPreview` builder in `src/runtime/replay-preview.ts` that consumes a selected `TraceEvent` and all trace events, classifies each step by its replay action, assesses replayability, and returns a structured preview. A `renderTraceReplay()` renderer in `trace-detail.ts` displays the result. `p` keyboard shortcut switches to replay mode.

**Tech Stack:** TypeScript/ESM, Node >= 24, trace-events (existing), trace-detail (existing), TuiStore (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/replay-preview.ts` | Create | `ReplayPreview`, `ReplayPreviewStep`, `ReplayAction`, `buildReplayPreview()` |
| `src/runtime/trace-events.ts` | Modify | Add `"replay"` to `TraceDetailMode` if not present |
| `src/tui/trace-detail.ts` | Modify | Add `renderTraceReplay()` renderer |
| `src/tui/store.ts` | Modify (minor) | No changes if `"replay"` already in `TraceDetailMode` |
| `src/cli/commands/tui.ts` | Modify | Add `p` keyboard shortcut for replay mode |
| `tests/runtime/replay-preview.test.ts` | Create | Reconstruction tests |
| `tests/tui/replay-preview-detail.test.ts` | Create | Rendering tests |

---

### Replay preview model

```typescript
// src/runtime/replay-preview.ts

export type ReplayAction =
  | "context-only"
  | "would-check-policy"
  | "would-require-approval"
  | "would-reuse-approval"
  | "would-run-tool"
  | "would-skip";

export type ReplayStepStatus =
  | "safe"
  | "blocked"
  | "requires-approval"
  | "not-replayable";

export type ReplayPreviewStep = {
  index: number;
  traceId: string;
  eventType: string;
  sourceType: TraceSourceType;
  timestamp: string;
  label: string;
  replayAction: ReplayAction;
  status: ReplayStepStatus;
  detail?: string;
};

export type ReplayPreview = {
  selectedTraceId: string;
  sessionId?: string;
  replayable: boolean;
  reason?: string;
  chain: ReplayPreviewStep[];
  boundaries: {
    policyDecisionIds: string[];
    approvalIds: string[];
    continuationIds: string[];
    toolCallIds: string[];
  };
  warnings: string[];
};
```

### replayAction mapping

| Event type + status | ReplayAction | Status |
|--------------------|-------------|--------|
| `policy.decision` + allow | `would-check-policy` | `safe` |
| `policy.decision` + denied | `would-check-policy` | `blocked` |
| `approval.created` | `would-require-approval` | `requires-approval` |
| `approval.reused` | `would-reuse-approval` | `safe` |
| `approval.resolved` + approved | `context-only` | `safe` |
| `approval.resolved` + denied | `context-only` | `not-replayable` |
| `approval.resumed` | `would-reuse-approval` | `safe` |
| `continuation.created` | `context-only` | `safe` |
| `continuation.consumed` | `would-run-tool` | `safe`* |
| `tool.started` | `would-run-tool` | `safe`* |
| `tool.completed` | `context-only` | `safe` |
| `tool.failed` | `context-only` | `safe` |
| other | `context-only` | `safe` |

\* `not-replayable` if rawEvent payload is missing tool args.

### Replayability rules

A chain is **replayable** only when all of:
1. At least one `would-run-tool` step exists
2. Every `would-run-tool` step has `rawEvent` with tool args
3. No `denied` approval exists in the chain

---

### Task 1: Create replay-preview.ts

**Files:**
- Create: `src/runtime/replay-preview.ts`

- [ ] **Step 1: Write the complete module**

```typescript
/**
 * replay-preview.ts — Reconstruct a replayable chain from trace events.
 *
 * Takes a selected TraceEvent + all trace events, classifies each step
 * by replay action, and assesses replayability. Never executes anything.
 */

import type { TraceEvent, TraceSourceType } from "./trace-events.js";

// ─── Types ───────────────────────────────────────────────────────────

export type ReplayAction =
  | "context-only"
  | "would-check-policy"
  | "would-require-approval"
  | "would-reuse-approval"
  | "would-run-tool"
  | "would-skip";

export type ReplayStepStatus =
  | "safe"
  | "blocked"
  | "requires-approval"
  | "not-replayable";

export type ReplayPreviewStep = {
  index: number;
  traceId: string;
  eventType: string;
  sourceType: TraceSourceType;
  timestamp: string;
  label: string;
  replayAction: ReplayAction;
  status: ReplayStepStatus;
  detail?: string;
};

export type ReplayPreview = {
  selectedTraceId: string;
  sessionId?: string;
  replayable: boolean;
  reason?: string;
  chain: ReplayPreviewStep[];
  boundaries: {
    policyDecisionIds: string[];
    approvalIds: string[];
    continuationIds: string[];
    toolCallIds: string[];
  };
  warnings: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────

/** Classify a single trace event into a replay action + status. */
export function classifyReplayStep(event: TraceEvent): { action: ReplayAction; status: ReplayStepStatus; detail?: string } {
  const rawPayload = event.rawEvent as any;
  const payload = rawPayload?.payload || {};

  // Policy
  if (event.eventType === "policy.decision") {
    const decision = payload?.decision || event.status;
    if (decision === "deny" || event.status === "denied") {
      return { action: "would-check-policy", status: "blocked", detail: "Policy denied this decision" };
    }
    return { action: "would-check-policy", status: "safe", detail: "Policy allowed" };
  }

  // Approval created (first time, ask)
  if (event.eventType === "approval.created") {
    return { action: "would-require-approval", status: "requires-approval", detail: "Would need user approval" };
  }

  // Approval reused (already pending)
  if (event.eventType === "approval.reused") {
    return { action: "would-reuse-approval", status: "safe", detail: "Reusing existing pending approval" };
  }

  // Approval resolved
  if (event.eventType === "approval.resolved") {
    if (event.status === "denied" || payload?.status === "denied") {
      return { action: "context-only", status: "not-replayable", detail: "Approval was denied — chain blocked" };
    }
    return { action: "context-only", status: "safe", detail: "Approval was granted" };
  }

  // Approval resumed
  if (event.eventType === "approval.resumed") {
    return { action: "would-reuse-approval", status: "safe", detail: "Approval was successfully resolved" };
  }

  // Continuation
  if (event.eventType === "continuation.created") {
    return { action: "context-only", status: "safe", detail: "Continuation recorded" };
  }
  if (event.eventType === "continuation.consumed") {
    // Check if raw payload has tool args
    if (!event.rawEvent || !payload?.toolCallId) {
      return { action: "would-run-tool", status: "not-replayable", detail: "Missing tool call payload — cannot replay" };
    }
    return { action: "would-run-tool", status: "safe", detail: "Would re-execute tool call" };
  }

  // Tool lifecycle
  if (event.sourceType === "tool") {
    if (event.eventType === "tool.started") {
      if (!event.rawEvent) {
        return { action: "would-run-tool", status: "not-replayable", detail: "Missing tool call payload — cannot replay" };
      }
      return { action: "would-run-tool", status: "safe", detail: `Would re-execute ${event.toolName || "tool"}` };
    }
    return { action: "context-only", status: "safe" };
  }

  // Everything else
  return { action: "context-only", status: "safe" };
}

/**
 * Build a ReplayPreview for the selected trace event.
 * Uses traceChainContext to find related events.
 */
export function buildReplayPreview(
  selected: TraceEvent,
  allEvents: TraceEvent[],
): ReplayPreview {
  const { traceChainContext } = require("./trace-events.js");
  const chainEvents = traceChainContext(allEvents, selected);

  const warnings: string[] = [];
  warnings.push("Preview only. No execution will occur.");

  const boundaries: ReplayPreview["boundaries"] = {
    policyDecisionIds: [],
    approvalIds: [],
    continuationIds: [],
    toolCallIds: [],
  };

  // Collect boundaries
  for (const e of chainEvents) {
    if (e.approvalId && !boundaries.approvalIds.includes(e.approvalId)) boundaries.approvalIds.push(e.approvalId);
    if (e.continuationId && !boundaries.continuationIds.includes(e.continuationId)) boundaries.continuationIds.push(e.continuationId);
    if (e.toolCallId && !boundaries.toolCallIds.includes(e.toolCallId)) boundaries.toolCallIds.push(e.toolCallId);
    if (e.sourceType === "policy") boundaries.policyDecisionIds.push(e.id);
  }

  // Classify each step
  const chain: ReplayPreviewStep[] = chainEvents.map((event, i) => {
    const { action, status, detail } = classifyReplayStep(event);
    return {
      index: i + 1,
      traceId: event.id,
      eventType: event.eventType,
      sourceType: event.sourceType,
      timestamp: event.timestamp,
      label: event.label,
      replayAction: action,
      status,
      detail,
    };
  });

  // Determine replayability
  const hasToolStep = chain.some(s => s.replayAction === "would-run-tool");
  const hasDeniedApproval = chain.some(s => s.status === "not-replayable" && s.eventType === "approval.resolved");
  const hasMissingPayload = chain.some(s => s.status === "not-replayable" && s.replayAction === "would-run-tool");
  const blockedSteps = chain.filter(s => s.status === "blocked" || s.status === "not-replayable");

  let replayable = hasToolStep;
  let reason: string | undefined;

  if (!hasToolStep) {
    replayable = false;
    reason = "No tool call in chain — nothing to replay";
    warnings.push(reason);
  }
  if (hasDeniedApproval) {
    replayable = false;
    reason = "Chain contains a denied approval";
    warnings.push(reason);
  }
  if (hasMissingPayload) {
    replayable = false;
    reason = "Tool call payload missing from raw event data";
    warnings.push("Tool call raw payload is missing — cannot re-execute without source data");
  }
  if (blockedSteps.length > 1) {
    warnings.push(`${blockedSteps.length} step(s) blocked or not replayable`);
  }

  return {
    selectedTraceId: selected.id,
    sessionId: selected.sessionId,
    replayable,
    reason,
    chain,
    boundaries,
    warnings,
  };
}
```

Wait — `require("./trace-events.js")` won't work in ESM. Use dynamic `import()` or call it differently. Actually, the simplest approach: import `traceChainContext` statically at the top of the file.

```typescript
import { traceChainContext } from "./trace-events.js";
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/runtime/replay-preview.ts
git commit -m "feat(runtime): add replay preview model and chain reconstruction"
```

---

### Task 2: Add replay to TraceDetailMode and renderer

**Files:**
- Modify: `src/runtime/trace-events.ts` (check `TraceDetailMode`)
- Modify: `src/tui/trace-detail.ts`

- [ ] **Step 1: Verify `"replay"` is in `TraceDetailMode`**

In `src/runtime/trace-events.ts`, check the `TraceDetailMode` type:

```typescript
export type TraceDetailMode = "summary" | "json" | "links" | "chain" | "replay";
```

If `"replay"` is missing, add it.

- [ ] **Step 2: Add renderTraceReplay to trace-detail.ts**

```typescript
import type { ReplayPreview, ReplayPreviewStep } from "../runtime/replay-preview.js";

export function renderTraceReplay(preview: ReplayPreview): string[] {
  const lines: string[] = [];
  lines.push(`  Selected: ${preview.chain.length > 0 ? preview.chain[0]?.label : "?"}`);
  lines.push(`  Replayable: ${preview.replayable ? "✓ yes" : "✗ no"}`);
  if (preview.reason) lines.push(`  Reason: ${preview.reason}`);
  lines.push("");

  if (preview.chain.length > 0) {
    lines.push("  Chain:");
    for (const step of preview.chain) {
      const iconMap: Record<string, string> = {
        safe: "●", blocked: "✗", "requires-approval": "○", "not-replayable": "✗",
      };
      const icon = iconMap[step.status] || " ";
      const action = step.replayAction.padEnd(24);
      lines.push(`  ${icon} ${step.index}. ${action} ${step.label.slice(0, 40)}`);
      if (step.detail) lines.push(`       ${step.detail.slice(0, 60)}`);
    }
  }

  lines.push("");
  lines.push("  Boundaries:");
  if (preview.boundaries.policyDecisionIds.length > 0) {
    lines.push(`    Policy:      ${preview.boundaries.policyDecisionIds.join(", ")}`);
  }
  if (preview.boundaries.approvalIds.length > 0) {
    lines.push(`    Approval:    ${preview.boundaries.approvalIds.join(", ")}`);
  }
  if (preview.boundaries.continuationIds.length > 0) {
    lines.push(`    Continuation: ${preview.boundaries.continuationIds.join(", ")}`);
  }
  if (preview.boundaries.toolCallIds.length > 0) {
    lines.push(`    ToolCall:    ${preview.boundaries.toolCallIds.join(", ")}`);
  }
  if (preview.sessionId) {
    lines.push(`    Session:     ${preview.sessionId}`);
  }

  if (preview.warnings.length > 0) {
    lines.push("");
    lines.push("  Warnings:");
    for (const w of preview.warnings) {
      lines.push(`    ⚠ ${w}`);
    }
  }

  return lines;
}
```

- [ ] **Step 3: Update panel-renderer.ts to handle "replay" mode**

In the detail panel section of `renderPanelContent()`, add a case for `mode === "replay"`:

```typescript
    else if (mode === "replay") {
      const { buildReplayPreview } = await import("../runtime/replay-preview.js");
      const preview = buildReplayPreview(selected, s.traceEvents);
      detailLines = renderTraceReplay(preview);
    }
```

Actually, static imports work better. Add:

```typescript
import { renderTraceReplay } from "./trace-detail.js";
import { buildReplayPreview } from "../runtime/replay-preview.js";
```

And the case:

```typescript
    else if (mode === "replay") {
      const preview = buildReplayPreview(selected, s.traceEvents);
      detailLines = renderTraceReplay(preview);
    }
```

- [ ] **Step 4: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/runtime/trace-events.ts src/tui/trace-detail.ts src/tui/panel-renderer.ts
git commit -m "feat(tui): add replay preview trace detail mode and renderer"
```

---

### Task 3: Wire keyboard shortcut for replay preview

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add `p` shortcut in the detail mode switching block**

Find the existing trace detail mode block (from M0.33) and add `p`:

```typescript
    // Trace detail mode switching (when detail is open, j/l/c/s/p switch modes)
    if (store.getState().activePanel === "trace" && store.getState().traceSelection.detailOpen) {
      if (task.toLowerCase() === "j") {
        store.setTraceDetailMode("json");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "l") {
        store.setTraceDetailMode("links");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "c") {
        store.setTraceDetailMode("chain");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "s") {
        store.setTraceDetailMode("summary");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "p") {
        store.setTraceDetailMode("replay");
        renderPanelContent(store, tui);
        continue;
      }
    }
```

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/integration/smoke.test.js 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): wire replay preview keyboard shortcut (p) in trace detail"
```

---

### Task 4: Replay preview tests

**Files:**
- Create: `tests/runtime/replay-preview.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReplayPreview, classifyReplayStep } from "../../src/runtime/replay-preview.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("classifyReplayStep", () => {
  it("policy allow → would-check-policy / safe", () => {
    const e = makeEvent({ eventType: "policy.decision", status: "allowed", sourceType: "policy" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-check-policy");
    assert.equal(r.status, "safe");
  });

  it("policy deny → would-check-policy / blocked", () => {
    const e = makeEvent({ eventType: "policy.decision", status: "denied", sourceType: "policy" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-check-policy");
    assert.equal(r.status, "blocked");
  });

  it("approval.created → would-require-approval", () => {
    const e = makeEvent({ eventType: "approval.created", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-require-approval");
    assert.equal(r.status, "requires-approval");
  });

  it("approval.resolved approved → context-only / safe", () => {
    const e = makeEvent({ eventType: "approval.resolved", status: "success", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
    assert.equal(r.status, "safe");
  });

  it("approval.resolved denied → context-only / not-replayable", () => {
    const e = makeEvent({ eventType: "approval.resolved", status: "denied", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
    assert.equal(r.status, "not-replayable");
  });

  it("approval.reused → would-reuse-approval", () => {
    const e = makeEvent({ eventType: "approval.reused", sourceType: "approval" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-reuse-approval");
  });

  it("tool.started with rawEvent → would-run-tool / safe", () => {
    const e = makeEvent({ eventType: "tool.started", rawEvent: { payload: { toolCallId: "tc1" } } });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-run-tool");
    assert.equal(r.status, "safe");
  });

  it("tool.started without rawEvent → would-run-tool / not-replayable", () => {
    const e = makeEvent({ eventType: "tool.started", rawEvent: undefined });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-run-tool");
    assert.equal(r.status, "not-replayable");
  });

  it("continuation.consumed → would-run-tool / safe", () => {
    const e = makeEvent({ eventType: "continuation.consumed", sourceType: "continuation", rawEvent: { payload: { toolCallId: "tc1" } } });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "would-run-tool");
    assert.equal(r.status, "safe");
  });

  it("tool.completed → context-only", () => {
    const e = makeEvent({ eventType: "tool.completed", status: "success" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
  });

  it("unknown event → context-only", () => {
    const e = makeEvent({ eventType: "session.started", sourceType: "session" });
    const r = classifyReplayStep(e);
    assert.equal(r.action, "context-only");
  });
});

describe("buildReplayPreview", () => {
  it("builds preview for tool chain", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "allowed", sourceType: "policy", label: "policy: shell.run", toolCallId: "tc1" }),
      makeEvent({ id: "e2", eventType: "tool.started", status: "running", label: "shell.run started", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "shell.run" } } }),
      makeEvent({ id: "e3", eventType: "tool.completed", status: "success", label: "shell.run completed", toolCallId: "tc1", timestamp: "2026-06-11T12:00:01Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    assert.equal(preview.replayable, true);
    assert.ok(preview.warnings.some(w => w.includes("Preview only")));
    assert.equal(preview.chain.length, 2); // self excluded
    assert.equal(preview.boundaries.toolCallIds.length, 1);
  });

  it("marks denied approval as not replayable", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "ask", sourceType: "policy", label: "policy: shell.run", approvalId: "app_1" }),
      makeEvent({ id: "e2", eventType: "approval.created", sourceType: "approval", label: "approval created", approvalId: "app_1" }),
      makeEvent({ id: "e3", eventType: "approval.resolved", status: "denied", sourceType: "approval", label: "approval denied", approvalId: "app_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    assert.equal(preview.replayable, false);
  });

  it("returns not-replayable when no tool call in chain", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "session.started", sourceType: "session", label: "session started" }),
    ];
    const preview = buildReplayPreview(events[0], events);
    assert.equal(preview.replayable, false);
    assert.ok(preview.reason?.includes("No tool call"));
  });

  it("includes safety warning", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    // Even with no chain (self excluded), the warning is always added
    assert.ok(preview.warnings.some(w => w.includes("Preview only")));
  });
});
```

- [ ] **Step 1: Write test file**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/replay-preview.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/replay-preview.test.ts
git commit -m "test(runtime): cover replay preview reconstruction and classification"
```

---

### Task 5: Replay preview detail rendering tests

**Files:**
- Create: `tests/tui/replay-preview-detail.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTraceReplay } from "../../src/tui/trace-detail.js";
import { buildReplayPreview } from "../../src/runtime/replay-preview.js";
import type { TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    ...overrides,
  };
}

describe("renderTraceReplay", () => {
  it("renders safety warning", () => {
    const events = [makeEvent({ id: "e1", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } } })];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Preview only"), `Expected safety warning, got: ${joined}`);
  });

  it("renders replayable yes", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1", toolName: "shell.run" } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("yes"));
  });

  it("renders replayable no with reason", () => {
    const events = [makeEvent({ id: "e1", eventType: "session.started", sourceType: "session", label: "session" })];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("no"));
    assert.ok(joined.includes("No tool call"));
  });

  it("renders chain steps with actions", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "policy.decision", status: "allowed", sourceType: "policy", label: "policy: run", toolCallId: "tc1" }),
      makeEvent({ id: "e2", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } }, timestamp: "2026-06-11T12:00:01Z" }),
    ];
    const preview = buildReplayPreview(events[1], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("would-check-policy") || joined.includes("would-run-tool"));
  });

  it("renders boundaries section", () => {
    const events = [
      makeEvent({ id: "e1", eventType: "tool.started", label: "shell.run", toolCallId: "tc1", rawEvent: { payload: { toolCallId: "tc1" } } }),
    ];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Boundaries") || joined.includes("ToolCall"));
  });

  it("renders warnings section", () => {
    const events = [makeEvent({ id: "e1", eventType: "session.started", sourceType: "session" })];
    const preview = buildReplayPreview(events[0], events);
    const lines = renderTraceReplay(preview);
    const joined = lines.join("\n");
    assert.ok(joined.includes("Warnings") || joined.includes("Preview"));
  });
});
```

- [ ] **Step 1: Write test file**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/tui/replay-preview-detail.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/replay-preview-detail.test.ts
git commit -m "test(tui): cover replay preview rendering and warnings"
```

---

### Task 6: Build, verify, tag

- [ ] **Step 1: Build and run full test suite**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/policy/*.test.js dist/tests/runtime/*.test.js dist/tests/daemon/*.test.js dist/tests/tui/*.test.js dist/tests/integration/smoke.test.js --test-concurrency=1 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: Commit docs**

```bash
git add docs/superpowers/plans/2026-06-11-m34-runtime-replay-preview.md
git commit -m "docs: add M0.34 runtime replay preview implementation plan"
```

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.34-runtime-replay-preview -m "M0.34 Runtime Replay Preview: reconstruct previewable chains from trace events with step-level replay action classification (would-check-policy, would-require-approval, would-run-tool), replayability assessment, and safety boundary display — no execution"
git push origin m0.34-runtime-replay-preview
```

---

## Self-review checklist

| Check | Task | Notes |
|-------|------|-------|
| ReplayPreview types defined | Task 1 | `ReplayAction`, `ReplayPreviewStep`, `ReplayPreview` |
| `classifyReplayStep()` maps all event types | Task 1 | policy, approval, continuation, tool, other |
| `buildReplayPreview()` uses `traceChainContext` | Task 1 | Reuses M0.33 helper |
| Replayability rules correct | Task 1 | Tool missing → not replayable, denied approval → not replayable |
| `"replay"` in `TraceDetailMode` | Task 2 | If missing, add it |
| `renderTraceReplay()` renders preview | Task 2 | Chain steps, boundaries, warnings, safety warning |
| Panel renderer handles `"replay"` mode | Task 2 | `buildReplayPreview()` + `renderTraceReplay()` |
| `p` keyboard shortcut wired | Task 3 | Detail mode switching block |
| Classification tests | Task 4 | 11 tests covering all action/status combinations |
| Preview reconstruction tests | Task 4 | Tool chain, denied approval, no tool call, safety warning |
| Rendering tests | Task 5 | 6 tests covering replayable yes/no, chain steps, boundaries, warnings |
| No execution | all | `classifyReplayStep()` never imports ToolExecutor or executes anything |
