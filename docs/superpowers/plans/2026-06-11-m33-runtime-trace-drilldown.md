# M0.33: Runtime Trace Drilldown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each trace row inspectable — select an event, view structured fields, raw JSON payload, linked entity IDs, and chain context of related events.

**Architecture:** Extend `TraceEvent` with `rawEvent` and `sessionFilePath`. Add `traceSelection` state to `TuiState` with navigation mutators. Create `src/tui/trace-detail.ts` with four detail mode renderers. Wire keyboard controls (↑↓ enter j l c esc). Render split-view inside the Trace panel.

**Tech Stack:** TypeScript/ESM, Node >= 24, TuiStore (existing), panel-renderer (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/trace-events.ts` | Modify | Add `rawEvent`, `sessionFilePath` to `TraceEvent`; add `traceChainContext()` helper |
| `src/tui/store.ts` | Modify | Add `traceSelection` state, selectors, navigation mutators |
| `src/tui/trace-detail.ts` | Create | Detail renderers for summary/json/links/chain modes |
| `src/tui/panel-renderer.ts` | Modify | Render split-view Trace panel with selectable rows + detail section |
| `src/tui/dashboard-renderer.ts` | Modify | Pass `traceSelection` to snapshot bridge |
| `src/cli/commands/tui.ts` | Modify | Add keyboard handlers: ↑↓ enter j l c esc |
| `tests/runtime/trace-drilldown.test.ts` | Create | Chain context helper tests |
| `tests/tui/trace-detail-panel.test.ts` | Create | Selection state and detail rendering tests |

---

### TraceEvent extension

```typescript
// Add to TraceEvent type:
rawEvent?: unknown;          // full source event payload for JSON view
sessionFilePath?: string;    // path to session events.jsonl on disk
```

### Selection state

```typescript
export type TraceDetailMode = "summary" | "json" | "links" | "chain";

export type TraceSelectionState = {
  selectedIndex: number;     // -1 = nothing selected
  selectedTraceId?: string;
  detailOpen: boolean;
  detailMode: TraceDetailMode;
};
```

Default: `{ selectedIndex: -1, detailOpen: false, detailMode: "summary" }`.

### Chain context helper

```typescript
/**
 * Find events related to the given trace event by shared entity IDs.
 * Priority: toolCallId → approvalId → continuationId → sessionId window.
 */
function traceChainContext(
  allEvents: TraceEvent[],
  selected: TraceEvent,
  maxResults: number, // default 12
): TraceEvent[];
```

---

### Task 1: Extend TraceEvent and add chain context helper

**Files:**
- Modify: `src/runtime/trace-events.ts`

- [ ] **Step 1: Add `rawEvent` and `sessionFilePath` to `TraceEvent`**

Add two optional fields to the `TraceEvent` type:

```typescript
export type TraceEvent = {
  // ... existing fields ...
  rawEvent?: unknown;
  sessionFilePath?: string;
};
```

- [ ] **Step 2: Update `toTraceEvent()` to preserve raw event**

At the start of `toTraceEvent`, capture the full input:

```typescript
  const rawEvent = event;
```

Then add `rawEvent` to every returned `TraceEvent` object (all branches):

```typescript
      rawEvent,
```

- [ ] **Step 3: Update `traceEventsFromLog()` to accept and pass `sessionFilePath`**

Add an optional parameter:

```typescript
export function traceEventsFromLog(events: any[], sessionFilePath?: string): TraceEvent[] {
```

In the loop, pass `sessionFilePath`:

```typescript
    if (t) {
      t.sessionFilePath = sessionFilePath || t.sessionFilePath;
      traces.push(t);
    }
```

- [ ] **Step 4: Add `traceChainContext()` helper**

```typescript
export function traceChainContext(
  allEvents: TraceEvent[],
  selected: TraceEvent,
  maxResults = 12,
): TraceEvent[] {
  const related = new Map<string, TraceEvent>();
  const addIfMissing = (t: TraceEvent) => { if (!related.has(t.id)) related.set(t.id, t); };

  // Priority 1: same toolCallId
  if (selected.toolCallId) {
    for (const e of allEvents) {
      if (e.toolCallId === selected.toolCallId) addIfMissing(e);
    }
  }

  // Priority 2: same approvalId
  if (selected.approvalId && related.size < maxResults) {
    for (const e of allEvents) {
      if (e.approvalId === selected.approvalId) addIfMissing(e);
    }
  }

  // Priority 3: same continuationId
  if (selected.continuationId && related.size < maxResults) {
    for (const e of allEvents) {
      if (e.continuationId === selected.continuationId) addIfMissing(e);
    }
  }

  // Priority 4: same sessionId within ±5 minute window
  if (selected.sessionId && related.size < maxResults) {
    const selectedTime = new Date(selected.timestamp).getTime();
    for (const e of allEvents) {
      if (e.sessionId === selected.sessionId) {
        const eventTime = new Date(e.timestamp).getTime();
        if (Math.abs(eventTime - selectedTime) < 300_000) addIfMissing(e);
      }
    }
  }

  // Exclude self, sort chronologically
  related.delete(selected.id);
  return [...related.values()]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(0, maxResults);
}
```

- [ ] **Step 5: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/trace-events.ts
git commit -m "feat(runtime): preserve raw trace payloads, session file paths, and chain context helper"
```

---

### Task 2: Add trace selection state to TuiState

**Files:**
- Modify: `src/tui/store.ts`

- [ ] **Step 1: Import types and add to TuiState**

```typescript
import type { TraceSelectionState, TraceDetailMode } from "../runtime/trace-events.js";
```

Add to `TuiState`:

```typescript
  traceSelection: TraceSelectionState;
```

Initialize in constructor:

```typescript
      traceSelection: initialState?.traceSelection ?? { selectedIndex: -1, detailOpen: false, detailMode: "summary" },
```

- [ ] **Step 2: Export TraceSelectionState and TraceDetailMode from trace-events.ts**

They should be exported from there so the import exists.

- [ ] **Step 3: Add trace selection mutators**

```typescript
  getSelectedTraceEvent(): TraceEvent | undefined {
    const events = this.getFilteredTraceEvents();
    const idx = this.state.traceSelection.selectedIndex;
    if (idx < 0 || idx >= events.length) return undefined;
    return events[idx];
  }

  getVisibleTraceEvents(): TraceEvent[] {
    return this.getFilteredTraceEvents();
  }

  selectNextTraceEvent(): void {
    const events = this.getFilteredTraceEvents();
    if (events.length === 0) return;
    const current = this.state.traceSelection.selectedIndex;
    const next = Math.min(current + 1, events.length - 1);
    this.state.traceSelection.selectedIndex = next;
    this.state.traceSelection.selectedTraceId = events[next]?.id;
    this.notify();
  }

  selectPreviousTraceEvent(): void {
    const events = this.getFilteredTraceEvents();
    if (events.length === 0) return;
    const current = this.state.traceSelection.selectedIndex;
    const prev = Math.max(current - 1, 0);
    this.state.traceSelection.selectedIndex = prev;
    this.state.traceSelection.selectedTraceId = events[prev]?.id;
    this.notify();
  }

  toggleTraceDetail(): void {
    this.state.traceSelection.detailOpen = !this.state.traceSelection.detailOpen;
    this.notify();
  }

  closeTraceDetail(): void {
    this.state.traceSelection.detailOpen = false;
    this.notify();
  }

  setTraceDetailMode(mode: TraceDetailMode): void {
    this.state.traceSelection.detailMode = mode;
    this.notify();
  }

  getTraceDetailMode(): TraceDetailMode {
    return this.state.traceSelection.detailMode;
  }

  getTraceSelection(): TraceSelectionState {
    return this.state.traceSelection;
  }
```

- [ ] **Step 4: Sanitize selection on setTraceEvents**

When bulk-setting trace events (from snapshot refresh), preserve the selected event if its ID still exists:

```typescript
  setTraceEvents(events: TraceEvent[]): void {
    const prevSelectedId = this.state.traceSelection.selectedTraceId;
    this.state.traceEvents = events;
    this.state.traceEventCount = events.length;
    // Preserve selection if selected event still exists
    if (prevSelectedId) {
      const idx = events.findIndex(e => e.id === prevSelectedId);
      if (idx >= 0) {
        this.state.traceSelection.selectedIndex = idx;
      } else {
        this.state.traceSelection.selectedIndex = -1;
        this.state.traceSelection.selectedTraceId = undefined;
        this.state.traceSelection.detailOpen = false;
      }
    }
    this.notify();
  }
```

- [ ] **Step 5: Update setTraceFilter to reset selection**

```typescript
  setTraceFilter(filter: TraceEventFilter): void {
    this.state.traceFilter = filter;
    this.state.traceSelection.selectedIndex = -1;
    this.state.traceSelection.selectedTraceId = undefined;
    this.state.traceSelection.detailOpen = false;
    this.notify();
  }
```

- [ ] **Step 6: Build and verify**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/tui/trace-panel.test.js 2>&1 | tail -3
```

Expected: clean build, existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/tui/store.ts
git commit -m "feat(tui): add trace selection state, detail mode, and navigation mutators"
```

---

### Task 3: Create trace-detail.ts renderers

**Files:**
- Create: `src/tui/trace-detail.ts`

Four mode renderers that return strings for the detail panel.

```typescript
/**
 * trace-detail.ts — Detail panel renderers for the Trace drilldown.
 *
 * Four modes: summary, json, links, chain.
 * Each returns an array of lines to display in the detail section.
 */

import { TraceEvent, TraceDetailMode } from "../runtime/trace-events.js";

export function renderTraceSummary(event: TraceEvent): string[] {
  const lines: string[] = [];
  lines.push(`  Type:        ${event.eventType}`);
  if (event.status) lines.push(`  Status:      ${event.status}`);
  if (event.label) lines.push(`  Label:       ${event.label}`);
  if (event.toolName) lines.push(`  Tool:        ${event.toolName}`);
  if (event.toolCallId) lines.push(`  ToolCall:    ${event.toolCallId}`);
  if (event.capability) lines.push(`  Capability:  ${event.capability}`);
  if (event.approvalId) lines.push(`  Approval:    ${event.approvalId}`);
  if (event.continuationId) lines.push(`  Continuation: ${event.continuationId}`);
  if (event.taskId) lines.push(`  Task:        ${event.taskId}`);
  if (event.sessionId) lines.push(`  Session:     ${event.sessionId}`);
  if (event.sessionFilePath) lines.push(`  File:        ${event.sessionFilePath}`);
  if (event.detail) lines.push(`  Detail:      ${event.detail}`);
  return lines;
}

export function renderTraceJson(event: TraceEvent): string[] {
  const raw = event.rawEvent ?? event;
  return JSON.stringify(raw, null, 2).split("\n").slice(0, 30);
}

export function renderTraceLinks(event: TraceEvent): string[] {
  const lines: string[] = [];
  lines.push("  Entity IDs:");
  lines.push(`    Id:           ${event.id}`);
  if (event.sessionId) lines.push(`    SessionId:    ${event.sessionId}`);
  if (event.approvalId) lines.push(`    ApprovalId:   ${event.approvalId}`);
  if (event.continuationId) lines.push(`    Continuation: ${event.continuationId}`);
  if (event.toolCallId) lines.push(`    ToolCallId:   ${event.toolCallId}`);
  if (event.taskId) lines.push(`    TaskId:       ${event.taskId}`);
  if (event.capability) lines.push(`    Capability:   ${event.capability}`);
  if (event.toolName) lines.push(`    ToolName:     ${event.toolName}`);
  if (event.sessionFilePath) {
    lines.push("  Source:");
    lines.push(`    ${event.sessionFilePath}`);
  }
  return lines;
}

export function renderTraceChain(
  selected: TraceEvent,
  chainEvents: TraceEvent[],
): string[] {
  const lines: string[] = [];
  if (chainEvents.length === 0) {
    lines.push("  No related events found.");
    return lines;
  }
  lines.push(`  Chain context (${chainEvents.length} related):`);
  for (const e of chainEvents) {
    const time = new Date(e.timestamp).toLocaleTimeString();
    const marker = e.id === selected.id ? ">" : " ";
    const iconMap: Record<string, string> = {
      allowed: "●", denied: "✗", pending: "○",
      running: "▶", success: "✔", failed: "✗", completed: "✔",
    };
    const icon = e.status ? (iconMap[e.status] || " ") : " ";
    lines.push(`  ${marker} ${time} ${icon} ${e.sourceType.padEnd(12)} ${e.label.slice(0, 40)}`);
  }
  return lines;
}
```

- [ ] **Step 1: Write `src/tui/trace-detail.ts`**
- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/trace-detail.ts
git commit -m "feat(tui): add trace detail renderers for summary/json/links/chain modes"
```

---

### Task 4: Render split-view Trace panel

**Files:**
- Modify: `src/tui/panel-renderer.ts`

- [ ] **Step 1: Replace the Trace panel branch with split-view rendering**

The existing Trace panel block (lines ~85-97) becomes:

```typescript
  } else if (s.activePanel === "trace") {
    const filterLabel = s.traceFilter === "all" ? "all" : s.traceFilter;
    buf.push(`── Trace (filter: ${filterLabel}) ──────────────`);
    buf.push(`Events: ${s.traceEventCount ?? s.traceEvents.length}`);
    if (s.traceEvents.length === 0) {
      buf.push("  No trace events. Run a task to populate the timeline.");
    } else {
      const filtered = s.traceFilter === "all"
        ? s.traceEvents
        : s.traceEvents.filter(e => e.sourceType === s.traceFilter);
      const display = filtered.slice(-20).reverse();
      const selIdx = s.traceSelection.selectedIndex >= 0
        ? display.length - 1 - s.traceSelection.selectedIndex
        : -1;
      const selId = s.traceSelection.selectedTraceId;

      for (let i = 0; i < display.length; i++) {
        const t = display[i];
        const isSelected = selIdx >= 0 && selId === t.id;
        const marker = isSelected ? ">" : " ";
        const time = new Date(t.timestamp).toLocaleTimeString();
        const iconMap: Record<string, string> = {
          allowed: "●", denied: "✗", pending: "○",
          running: "▶", success: "✔", failed: "✗", completed: "✔",
        };
        const icon = t.status ? (iconMap[t.status] || " ") : " ";
        const src = t.sourceType.padEnd(12);
        const label = t.label.slice(0, 48);
        buf.push(`${marker} ${time} ${icon} ${src} ${label}`);
      }
    }

    // Detail panel
    if (s.traceSelection.detailOpen) {
      const selected = s.traceEvents.find(e => e.id === s.traceSelection.selectedTraceId) as any;
      if (selected) {
        buf.push("───────────────────────────────────────────────");
        const mode = s.traceSelection.detailMode;
        const { renderTraceSummary, renderTraceJson, renderTraceLinks, renderTraceChain } = await_import_trace_detail();
        const { traceChainContext } = await_import_trace_events();

        let detailLines: string[] = [];
        if (mode === "summary") detailLines = renderTraceSummary(selected);
        else if (mode === "json") detailLines = renderTraceJson(selected);
        else if (mode === "links") detailLines = renderTraceLinks(selected);
        else if (mode === "chain") {
          const chain = traceChainContext(s.traceEvents, selected);
          detailLines = renderTraceChain(selected, chain);
        }

        buf.push(`  Mode: ${mode}`);
        buf.push(...detailLines);
        buf.push("  Keys: j=json  l=links  c=chain  esc=close");
      }
    }
    buf.push(`  t=filter  r=refresh`);
  }
```

The imports need to be dynamic since we're in a function. Use:

```typescript
// At the top of the trace branch, after the filter/display section:
import fs from "node:fs"; // already available
```

Actually, the simplest approach is to import at function scope like the existing code does. Let me keep it clean — the dynamic imports go early in the `if` block.

Revised:

```typescript
  } else if (s.activePanel === "trace") {
    // Imports for detail rendering (loaded on first trace panel open)
    let detailRenderers: any;
    let chainHelper: any;
    // ... rest of trace rendering ...
```

Actually, static imports are cleaner for this file since it's imported by `tui.ts` which is async. Let me just add static imports at the top.

- [ ] **Step 2: Add static imports to panel-renderer.ts**

```typescript
import { renderTraceSummary, renderTraceJson, renderTraceLinks, renderTraceChain } from "./trace-detail.js";
import { traceChainContext } from "../runtime/trace-events.js";
```

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/tui/box.test.js 2>&1 | tail -3
```

- [ ] **Step 4: Commit**

```bash
git add src/tui/panel-renderer.ts
git commit -m "feat(tui): render split-view trace panel with selectable rows and detail section"
```

---

### Task 5: Wire keyboard controls

**Files:**
- Modify: `src/cli/commands/tui.ts`

- [ ] **Step 1: Add keyboard handlers for trace navigation**

After the existing single-key handlers (`r`, `t`, `d`, `tab`, `?`), add:

```typescript
    // Trace drilldown navigation
    if (store.getState().activePanel === "trace") {
      if (task === "[A" || task.toLowerCase() === "k") {  // Up arrow or k
        store.selectPreviousTraceEvent();
        renderPanelContent(store, tui);
        continue;
      }
      if (task === "[B" || task.toLowerCase() === "j") {  // Down arrow or j
        store.selectNextTraceEvent();
        renderPanelContent(store, tui);
        continue;
      }
      if (task === "" || task === "enter") {  // Enter
        store.toggleTraceDetail();
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "l" && store.getState().traceSelection.detailOpen) {
        store.setTraceDetailMode("links");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "c" && store.getState().traceSelection.detailOpen) {
        store.setTraceDetailMode("chain");
        renderPanelContent(store, tui);
        continue;
      }
      if (task.toLowerCase() === "j" && store.getState().traceSelection.detailOpen) {
        // j in detail mode switches to JSON; otherwise it's "down" (handled above)
        store.setTraceDetailMode("json");
        renderPanelContent(store, tui);
        continue;
      }
    }
```

Wait — `j` conflicts between "down" and "json mode". The spec says `j` in detail mode switches to JSON. The trick: when detail is open, `j` means JSON mode. When detail is closed, `j` means move down. Let me adjust:

```typescript
    if (store.getState().activePanel === "trace") {
      if (task === "[A" || task === "k") {  // Up
        store.selectPreviousTraceEvent();
        renderPanelContent(store, tui);
        continue;
      }
      if (task === "[B" || task.toLowerCase() === "j") {  // Down
        store.selectNextTraceEvent();
        renderPanelContent(store, tui);
        continue;
      }
      // Close detail on escape
      if (task === "" && store.getState().traceSelection.detailOpen) {
        store.closeTraceDetail();
        renderPanelContent(store, tui);
        continue;
      }
    }

    // Enter or empty line while trace is active
    if (task === "" && store.getState().activePanel === "trace") {
      store.toggleTraceDetail();
      renderPanelContent(store, tui);
      continue;
    }
```

Wait, `readLine()` converts empty string `""` to `""` (the `if (line === "")` returns `""` at line 32). So enter sends `""`. Let me check... actually at line 32: `if (line === "") { resolve(""); return; }`. So empty Enter resolves to `""`. Then the loop hits `if (!task.trim()) { ... }` at line 211 which renders panel content on empty enter for non-chat panels. So we need the trace detail toggle before the empty-enter handler, or change it.

The simplest approach: change the existing empty-enter handler to also trigger trace detail toggle when the active panel is "trace":

```typescript
    // Panel content rendering on empty Enter
    if (!task.trim()) {
      if (store.getState().activePanel === "trace") {
        store.toggleTraceDetail();
      } else if (store.getState().activePanel !== "chat") {
        renderPanelContent(store, tui);
      }
      continue;
    }
```

Hmm, but renderPanelContent is for the summary empty-enter view. For trace, empty enter toggles detail. Let me keep it simple:

```typescript
    // Panel content rendering on empty Enter
    if (!task.trim()) {
      if (store.getState().activePanel === "trace") {
        store.toggleTraceDetail();
        renderPanelContent(store, tui);
      } else if (store.getState().activePanel !== "chat") {
        renderPanelContent(store, tui);
      }
      continue;
    }
```

Wait, the existing code at line 212:
```typescript
    if (!task.trim()) {
      if (store.getState().activePanel !== "chat") {
        renderPanelContent(store, tui);
      }
      continue;
    }
```

For trace panel, we want empty Enter to toggle detail. So:

```typescript
    if (!task.trim()) {
      if (store.getState().activePanel === "trace") {
        store.toggleTraceDetail();
        renderPanelContent(store, tui);
      } else if (store.getState().activePanel !== "chat") {
        renderPanelContent(store, tui);
      }
      continue;
    }
```

- [ ] **Step 2: Add mode switching keys**

These should work when the trace panel is active AND the detail is open. Add after the existing single-key handlers but before the daemon/local dispatch:

```typescript
    // Trace detail mode switching (only when detail is open)
    if (store.getState().activePanel === "trace" && store.getState().traceSelection.detailOpen) {
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
    }
```

JSON mode via `j` is already the "json" in the `TraceDetailMode` union, but `j` conflicts with "down". The simplest resolution: in the empty-enter handler, the first render starts in summary mode. Then `l` and `c` switch. JSON can be reached from any mode by typing `j` when the detail is open.

Actually, let me just keep it simple: ↑↓ for selection, empty Enter to toggle detail, l/c/j for mode only when detail is open. Since the cursor keys and `jk` are the navigation, and `l/c/j` are single chars typed at the prompt:

```typescript
    // Trace detail mode switching via l/c/j when detail open
    if (store.getState().activePanel === "trace" && store.getState().traceSelection.detailOpen) {
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
      if (task.toLowerCase() === "j") {
        store.setTraceDetailMode("json");
        renderPanelContent(store, tui);
        continue;
      }
    }
```

Wait, but `j` is also used for "select down" in the navigation block. With detail open, the mode switch should take priority. The keyboard logic is:

1. ↑↓ / k j navigate (works when detail is closed or open)
2. l/c/j switch mode (works when detail is open — j no longer navigates)

Actually, this is getting complex. Let me simplify: The plan says `j` = JSON mode when detail is open. So the navigation block should only handle `k` (up) and omit `j` for down, using only the ↓ arrow key. Or keep both: `j` navigates + mode switches are `J` (shift-j). But shift is harder.

Simplest resolution for M0.33:
- ↑↓ navigate the trace list (arrow keys only)
- `k` = up, `j` = down (vim-style, always)
- When detail is open: `l` = links mode, `c` = chain mode, `s` = summary mode, `j` = json mode — NO, `j` can't be both.

Final resolution: Arrow keys always navigate. When detail is closed, `j`/`k` also navigate. When detail is open, `j` switches to JSON mode (not down).

```typescript
    // Trace navigation
    if (store.getState().activePanel === "trace") {
      if (task === "[A" || task === "k") {  // Up
        store.selectPreviousTraceEvent();
        renderPanelContent(store, tui);
        continue;
      }
      if (!store.getState().traceSelection.detailOpen) {
        if (task === "[B" || task.toLowerCase() === "j") {  // Down
          store.selectNextTraceEvent();
          renderPanelContent(store, tui);
          continue;
        }
      }
    }
```

And then mode switching trivially:

```typescript
    // Trace detail modes
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
    }
```

- [ ] **Step 3: Build and verify**

```bash
npm run build 2>&1 | tail -5
node --test dist/tests/integration/smoke.test.js 2>&1 | tail -3
```

Expected: clean build, tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/tui.ts
git commit -m "feat(tui): wire trace drilldown keyboard controls (↑↓ enter j l c s esc)"
```

---

### Task 6: Chain context tests

**Files:**
- Create: `tests/runtime/trace-drilldown.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { traceChainContext, type TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "test", status: "running",
    ...overrides,
  };
}

describe("traceChainContext", () => {
  it("returns empty array for event with no linked IDs", () => {
    const events = [makeEvent({ id: "e1" })];
    const result = traceChainContext(events, events[0]);
    assert.deepEqual(result, []);
  });

  it("finds related events by shared toolCallId", () => {
    const events = [
      makeEvent({ id: "e1", toolCallId: "tc_001", label: "started", status: "running" }),
      makeEvent({ id: "e2", toolCallId: "tc_001", label: "completed", status: "success", timestamp: "2026-06-11T12:00:01Z" }),
      makeEvent({ id: "e3", toolCallId: "tc_002", label: "other", status: "running" }),
    ];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e2");
  });

  it("excludes self from results", () => {
    const events = [makeEvent({ id: "e1", toolCallId: "tc_001" })];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 0);
  });

  it("finds by shared approvalId", () => {
    const events = [
      makeEvent({ id: "e1", sourceType: "approval", eventType: "approval.created", label: "created", status: "pending", approvalId: "app_1" }),
      makeEvent({ id: "e2", sourceType: "approval", eventType: "approval.resolved", label: "resolved", status: "success", approvalId: "app_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e2");
  });

  it("finds by shared continuationId", () => {
    const events = [
      makeEvent({ id: "e1", sourceType: "continuation", eventType: "continuation.created", label: "created", continuationId: "cont_1" }),
      makeEvent({ id: "e2", sourceType: "continuation", eventType: "continuation.consumed", label: "consumed", continuationId: "cont_1", timestamp: "2026-06-11T12:01:00Z" }),
    ];
    const result = traceChainContext(events, events[0]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "e2");
  });

  it("respected maxResults limit", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent({ id: `e${i}`, toolCallId: "tc_001", timestamp: `2026-06-11T12:00:${i.toString().padStart(2, "0")}Z` }),
    );
    const result = traceChainContext(events, events[0], 5);
    assert.equal(result.length, 5);
  });

  it("returns results sorted chronologically", () => {
    const events = [
      makeEvent({ id: "e3", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:03Z", label: "third" }),
      makeEvent({ id: "e1", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:01Z", label: "first" }),
      makeEvent({ id: "e2", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:02Z", label: "second" }),
      makeEvent({ id: "e_self", toolCallId: "tc_001", timestamp: "2026-06-11T12:00:00Z", label: "self" }),
    ];
    const result = traceChainContext(events, events[3]); // select self
    assert.equal(result.length, 3);
    assert.equal(result[0].label, "first");
    assert.equal(result[1].label, "second");
    assert.equal(result[2].label, "third");
  });
});
```

- [ ] **Step 1: Write test file**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/runtime/trace-drilldown.test.js 2>&1
```

Expected: all 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/runtime/trace-drilldown.test.ts
git commit -m "test(runtime): cover trace drilldown chain context helper"
```

---

### Task 7: Trace detail panel rendering tests

**Files:**
- Create: `tests/tui/trace-detail-panel.test.ts`

```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TuiStore } from "../../src/tui/store.js";
import { renderTraceSummary, renderTraceJson, renderTraceLinks, renderTraceChain } from "../../src/tui/trace-detail.js";
import { traceChainContext, type TraceEvent } from "../../src/runtime/trace-events.js";

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return {
    id: "e1", timestamp: "2026-06-11T12:00:00Z",
    sourceType: "tool", eventType: "tool.started",
    label: "shell.run started", status: "running",
    toolName: "shell.run", toolCallId: "tc_001",
    ...overrides,
  };
}

describe("traceDetailPanel", () => {
  let store: TuiStore;

  beforeEach(() => {
    store = new TuiStore();
    store.appendTraceEvent(makeEvent({ id: "e1", toolCallId: "tc_001", toolName: "shell.run" }));
    store.appendTraceEvent(makeEvent({ id: "e2", toolCallId: "tc_001", eventType: "tool.completed", status: "success", label: "shell.run completed", timestamp: "2026-06-11T12:01:00Z" }));
  });

  describe("selection state", () => {
    it("starts with no selection", () => {
      const sel = store.getTraceSelection();
      assert.equal(sel.selectedIndex, -1);
      assert.equal(sel.detailOpen, false);
    });

    it("selects next event", () => {
      store.selectNextTraceEvent();
      assert.equal(store.getTraceSelection().selectedIndex, 0);
    });

    it("selects previous event", () => {
      store.selectNextTraceEvent();
      store.selectNextTraceEvent();
      store.selectPreviousTraceEvent();
      assert.equal(store.getTraceSelection().selectedIndex, 0);
    });

    it("toggles detail open/close", () => {
      store.toggleTraceDetail();
      assert.equal(store.getTraceSelection().detailOpen, true);
      store.toggleTraceDetail();
      assert.equal(store.getTraceSelection().detailOpen, false);
    });

    it("closes detail", () => {
      store.toggleTraceDetail();
      store.closeTraceDetail();
      assert.equal(store.getTraceSelection().detailOpen, false);
    });
  });

  describe("detail mode switching", () => {
    it("defaults to summary mode", () => {
      assert.equal(store.getTraceDetailMode(), "summary");
    });

    it("switches to json", () => {
      store.setTraceDetailMode("json");
      assert.equal(store.getTraceDetailMode(), "json");
    });

    it("switches to links", () => {
      store.setTraceDetailMode("links");
      assert.equal(store.getTraceDetailMode(), "links");
    });

    it("switches to chain", () => {
      store.setTraceDetailMode("chain");
      assert.equal(store.getTraceDetailMode(), "chain");
    });
  });

  describe("renderTraceSummary", () => {
    it("includes event type and status", () => {
      const lines = renderTraceSummary(makeEvent({}));
      const joined = lines.join("\n");
      assert.ok(joined.includes("tool.started"));
      assert.ok(joined.includes("running"));
    });

    it("includes tool and toolCallId when present", () => {
      const lines = renderTraceSummary(makeEvent({}));
      const joined = lines.join("\n");
      assert.ok(joined.includes("shell.run"));
      assert.ok(joined.includes("tc_001"));
    });

    it("includes approvalId when present", () => {
      const e = makeEvent({ sourceType: "approval", approvalId: "app_001" });
      const lines = renderTraceSummary(e);
      assert.ok(lines.join("\n").includes("app_001"));
    });
  });

  describe("renderTraceJson", () => {
    it("includes event fields in JSON output", () => {
      const e = makeEvent({ rawEvent: { type: "tool.started", toolName: "shell.run" } });
      const lines = renderTraceJson(e);
      const joined = lines.join("\n");
      assert.ok(joined.includes("tool.started"));
      assert.ok(joined.includes("shell.run"));
    });

    it("falls back to the event itself when rawEvent is absent", () => {
      const e = makeEvent({ rawEvent: undefined });
      const lines = renderTraceJson(e);
      assert.ok(lines.length > 0);
    });
  });

  describe("renderTraceLinks", () => {
    it("shows entity IDs", () => {
      const e = makeEvent({ sessionId: "sess_1", approvalId: "app_1" });
      const lines = renderTraceLinks(e);
      const joined = lines.join("\n");
      assert.ok(joined.includes("sess_1"));
      assert.ok(joined.includes("app_1"));
    });
  });

  describe("renderTraceChain", () => {
    it("shows related events with labels", () => {
      const chain = [
        makeEvent({ id: "e_related", label: "prior event", toolCallId: "tc_001" }),
      ];
      const lines = renderTraceChain(makeEvent({ id: "e_main", toolCallId: "tc_001" }), chain);
      const joined = lines.join("\n");
      assert.ok(joined.includes("prior event"));
      assert.ok(joined.includes("1 related"));
    });

    it("shows no-related message when empty", () => {
      const lines = renderTraceChain(makeEvent({ id: "e_main" }), []);
      assert.ok(lines.join("\n").includes("No related"));
    });
  });
});
```

- [ ] **Step 1: Write test file**
- [ ] **Step 2: Build and run**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/tui/trace-detail-panel.test.js 2>&1
```

Expected: all 17 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/tui/trace-detail-panel.test.ts
git commit -m "test(tui): cover trace detail rendering, selection, and mode switching"
```

---

### Task 8: Update dashboard-renderer snapshot bridge

**Files:**
- Modify: `src/tui/dashboard-renderer.ts`

The `snapshotFromStore` function needs to include `traceSelection` to build a correct snapshot. Add:

```typescript
    traceSelection: s.traceSelection ?? { selectedIndex: -1, detailOpen: false, detailMode: "summary" },
```

- [ ] **Step 1: Edit `src/tui/dashboard-renderer.ts`**

Add the field to the returned object in `snapshotFromStore()`.

- [ ] **Step 2: Build and verify**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 3: Commit**

```bash
git add src/tui/dashboard-renderer.ts
git commit -m "fix(tui): add traceSelection to dashboard snapshot bridge"
```

---

### Task 9: Build, verify, tag

- [ ] **Step 1: Build and run full test suite**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/policy/*.test.js dist/tests/runtime/*.test.js dist/tests/daemon/*.test.js dist/tests/tui/*.test.js dist/tests/integration/smoke.test.js --test-concurrency=1 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 2: Commit docs**

```bash
git add docs/superpowers/plans/2026-06-11-m33-runtime-trace-drilldown.md
git commit -m "docs: add M0.33 runtime trace drilldown implementation plan"
```

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.33-runtime-trace-drilldown -m "M0.33 Runtime Trace Drilldown: selectable trace events with structured detail modes (summary/json/links/chain), keyboard navigation, and chain context by shared entity IDs"
git push origin m0.33-runtime-trace-drilldown
```

---

## Self-review checklist

| Check | Task | Notes |
|-------|------|-------|
| TraceEvent extended with rawEvent/sessionFilePath | Task 1 | Preserves full source payload |
| traceChainContext helper | Task 1 | Priority: toolCallId → approvalId → continuationId → sessionId window |
| Selection state in TuiState | Task 2 | selectedIndex, selectedTraceId, detailOpen, detailMode |
| Selection mutators | Task 2 | getSelectedTraceEvent, selectNext/Previous, toggle/close, setMode |
| Detailed renderers | Task 3 | 4 modes: summary/json/links/chain |
| Split-view Trace panel | Task 4 | Selected row marked with `>`, detail section below |
| Keyboard controls | Task 5 | ↑↓ navigate, enter toggle, j/l/c/s switch modes, esc close |
| Chain context tests | Task 6 | 7 tests: toolCallId, approvalId, continuationId, maxResults, sorting |
| Detail panel tests | Task 7 | 17 tests: selection, mode switching, all 4 renderers |
| Dashboard snapshot bridge | Task 8 | traceSelection included |
| Selection survives refresh | Task 2 | setTraceEvents preserves selection if ID exists |
| Filter resets selection | Task 2 | setTraceFilter clears selectedIndex |
