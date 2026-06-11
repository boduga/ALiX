# M0.32: Runtime Trace Viewer — Design Spec

**Status:** Draft
**Builds on:** M0.29–M0.31 (PolicyGate, Approval UX, Observability)

---

## Problem

ALiX now emits structured events across `policy.*`, `approval.*`, `continuation.*`, and `tool.*` — but these are scattered across separate dashboard panels and file-based event logs. There is no single place to see the full execution story:

- A policy decision leads to an approval which leads to a continuation which leads to a tool call — but you switch between 3 panels to trace it
- Live events during daemon execution arrive as text output but are not captured as structured trace entries
- The dashboard shows counters (pending approvals count, tool count) but no chronological timeline
- Debugging a session means grepping event log files

## Solution

A unified **Trace** panel that normalizes all runtime event types into a single chronological timeline, filterable by event family, and populated both from session snapshots and live daemon events.

## TraceEvent model

```typescript
type TraceEvent = {
  id: string;
  timestamp: string;
  sourceType:
    | "policy"
    | "approval"
    | "continuation"
    | "tool"
    | "task"
    | "session"
    | "daemon"
    | "runtime";
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
```

This shape lets the UI render all event families consistently without losing original linkage.

## Architecture

```
EventLog (on-disk)          Live daemon events
        │                           │
        ▼                           ▼
    trace-events.ts ←─── normalize ──┘
        │
        ▼
    TuiState.traceEvents[]
        │
        ▼
    Trace panel (renderFiltered)
```

### Normalizer (trace-events.ts)

A pure function `toTraceEvent(event)` that converts EventLog events and daemon events into the `TraceEvent` shape. A second function `traceEventsFromLog(eventLog)` reads and normalizes an entire session log.

**Mapping rules:**

| Event type | sourceType | label | status |
|-----------|------------|-------|--------|
| `policy.decision` | policy | `policy.decision` | `allowed` / `denied` / `pending` |
| `approval.created` | approval | `approval.created` | `pending` |
| `approval.reused` | approval | `approval.reused` | `pending` |
| `approval.resolved` | approval | `approval.resolved` | `approved` / `denied` |
| `approval.resumed` | approval | `approval.resumed` | `success` |
| `approval.resume.failed` | approval | `approval.resume.failed` | `failed` |
| `continuation.created` | continuation | `continuation.created` | `pending` |
| `continuation.consumed` | continuation | `continuation.consumed` | `success` |
| `tool.started` | tool | (tool name) | `running` |
| `tool.completed` | tool | (tool name) | `success` |
| `tool.failed` | tool | (tool name) | `failed` |
| `task.*` | task | (task summary) | `running`/`completed` |

### Store changes

```typescript
// Add to TuiState
traceEvents: TraceEvent[];
traceFilter: "all" | "policy" | "approval" | "continuation" | "tool" | "task";

// Selectors
getFilteredTraceEvents(): TraceEvent[];   // filtered by traceFilter
getLatestTraceEvents(limit): TraceEvent[]; // most recent N

// Mutators
setTraceEvents(events: TraceEvent[]): void;
appendTraceEvent(event: TraceEvent): void;
setTraceFilter(filter: TraceEventFilter): void;
```

### Snapshot integration

`buildRuntimeSnapshot()` already loads runtime events from `RuntimeIndex`. For M0.32, after loading the events, normalize them through `traceEventsFromLog()` and store the result in `TuiState.traceEvents`.

### Live bridge

During daemon-mode execution, incoming events pass through `formatDaemonEvent()` for display **and** through `toTraceEvent()` for the trace store. The TUI loop already has an `onEvent` callback — it appends to `store.appendTraceEvent()` after formatting.

For local (non-daemon) mode, the `LocalRuntimeExecutor` logs events through `EventLog`. The trace normalizer reads from the log after each task completes.

### Trace panel

A dedicated TUI panel (not a sub-panel), accessed via tab navigation alongside the existing `chat`, `daemon`, `approvals`, `sops`, `policy`, `runtime` panels.

```
Trace ───────────────────────────────────────────
Filter: all  [toggle with t]

12:41:09  ● policy      allow     shell.readonly
12:41:09  ▶ tool        running   shell.run ls -la
12:41:10  ✔ tool        success   shell.run completed
12:42:03  ○ approval    pending   approval_abc123 shell.mutating
12:42:11  ✔ approval    approved  approval_abc123
12:42:11  ▶ continuation resumed   shell.run

────────────────────────────────────────────────
Events: 6  space=page-down  t=filter  r=refresh
```

Compact symbols (first pass text-based, testable):
- `●` = allowed/approved/resumed
- `○` = pending
- `✗` = denied/failed
- `▶` = running
- `✔` = success/completed

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/trace-events.ts` | Create | `TraceEvent` type, `toTraceEvent()`, `traceEventsFromLog()` |
| `src/tui/store.ts` | Modify | Add `traceEvents`, `traceFilter`, selectors, mutators |
| `src/tui/runtime-snapshot.ts` | Modify | Load + normalize trace events from session log |
| `src/tui/panel-renderer.ts` | Modify | Add Trace panel rendering |
| `src/tui/index.ts` | Modify (minor) | Register Trace panel in cycle |
| `src/cli/commands/tui.ts` | Modify | Bridge live events into trace stream |
| `src/tui/dashboard-renderer.ts` | Modify (minor) | Update snapshot type if needed |
| `tests/runtime/trace-events.test.ts` | Create | Event normalization tests |
| `tests/tui/trace-panel.test.ts` | Create | Filtering + rendering tests |

## Acceptance criteria

1. `policy.decision` appears in trace
2. `approval.*` events appear in trace
3. `continuation.*` events appear in trace
4. `tool.*` events appear in trace
5. Timeline sorts chronologically
6. Trace panel renders live events during daemon mode
7. Trace panel renders snapshot events after refresh
8. Filter by event family works
9. No graph visualization — this milestone is text-based timeline only
