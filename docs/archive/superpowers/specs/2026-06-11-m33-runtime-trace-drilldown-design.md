# M0.33: Runtime Trace Drilldown — Design Spec

**Status:** ✅ Completed (M0.33)
**Builds on:** M0.32 (Runtime Trace Viewer)

---

## Problem

M0.32 unified runtime events into a single chronological trace. Each row answers *what happened* — but a user cannot inspect the raw event, its linked approval/tool/continuation/task context, or the source session file.

The Trace panel currently shows:
```
12:41:09  ✔ tool  shell.run completed
```

M0.33 should let the user select that row and see:
- Full event payload (raw JSON)
- Linked entities: `approvalId`, `toolCallId`, `continuationId`, `sessionId`
- Source file: `.alix/sessions/<id>/events.jsonl`
- Chain context: events sharing the same `toolCallId` or `approvalId` nearby

## Goals

1. Select a trace event via arrow keys
2. Show raw event payload in a detail panel
3. Show linked entity IDs with labels
4. Show source session file path
5. Show nearby chain context (events sharing the same IDs)
6. Preserve keyboard-first TUI workflow

## Non-goals

- No event editing
- No replay of tool calls or continuations
- No graph visualization
- No web dashboard

## TraceEvent model extension

Extend `TraceEvent` with raw payload and source path:

```typescript
// Added fields:
rawEvent?: unknown;          // full source event payload for JSON view
sessionFilePath?: string;    // path to session events.jsonl on disk
```

No other fields change. The existing `approvalId`, `toolCallId`, `continuationId`, `sessionId`, `taskId`, `capability`, `toolName` fields already cover linked entity references.

## Selection state

```typescript
type TraceDetailMode = "summary" | "json" | "links" | "chain";

type TraceSelectionState = {
  selectedTraceId?: string;
  selectedIndex: number;
  detailMode: TraceDetailMode;
};
```

Stored in `TuiState`:

```typescript
traceSelection: TraceSelectionState;
```

Default: `{ selectedIndex: -1, detailMode: "summary" }`.

## Drilldown detail panel layout

A split view inside the existing Trace panel. The top section shows the scrollable trace list. The bottom section shows the detail for the selected event.

```
── Trace (filter: all) ──────────────────
> 12:41:09  ✔ tool  shell.run completed
  12:41:10  ● policy  policy: file.read
  12:42:03  ○ approval  approval created
─────────────────────────────────────────
  Type:        tool.completed
  Status:      success
  Tool:        shell.run
  ToolCall:    tc_001
  Session:     tui_abc123
  File:        .alix/sessions/tui_abc123/events.jsonl
  
  Chain:
    policy.decision → tool.started → tool.completed
  
  Keys: ↑↓ select  enter detail  j json  l links  c chain  esc close
```

### Detail modes

| Mode | Content |
|------|---------|
| `summary` | Normalized fields: type, status, capability, toolName, sessionId, source file path |
| `json` | Full raw event payload as pretty-printed JSON |
| `links` | All linked entity IDs with labels and badge count of chain events |
| `chain` | List of related events sharing the same `toolCallId` or `approvalId` |

## Keyboard controls

| Key | Action |
|-----|--------|
| `↑` / `k` | Move selection up |
| `↓` / `j` | Move selection down |
| `enter` | Toggle detail panel open/closed |
| `j` (in detail) | Switch to JSON mode |
| `l` (in detail) | Switch to linked entities mode |
| `c` (in detail) | Switch to chain context mode |
| `esc` | Close detail panel |

The existing `r` (refresh), `t` (filter), `tab` (panel cycle) keys continue working.

## Trace chain context

Chain context is based on shared entity IDs. When an event is selected, the chain view shows all other trace events that share at least one of these IDs:

```
same toolCallId
same approvalId
same continuationId
same sessionId (within a 5-minute window)
```

Priority order for the chain display:

1. All events with the same `toolCallId` (chronological)
2. All events with the same `approvalId` (chronological)
3. All events with the same `sessionId` within a ±5 min window

This means selecting a `tool.completed` event shows the full tool lifecycle, and if that tool call was behind an approval, the approval chain also appears.

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/trace-events.ts` | Modify | Add `rawEvent` and `sessionFilePath` to `TraceEvent`; add `traceChainContext()` helper |
| `src/tui/store.ts` | Modify | Add `traceSelection` state, selectors, navigation mutators |
| `src/tui/panel-renderer.ts` | Modify | Add detail panel rendering below trace list |
| `src/tui/trace-detail.ts` | Create | Detail renderers for summary/json/links/chain modes |
| `src/cli/commands/tui.ts` | Modify | Add keyboard handlers for ↑↓ enter j l c esc |
| `tests/runtime/trace-drilldown.test.ts` | Create | Chain context helper tests |
| `tests/tui/trace-detail-panel.test.ts` | Create | Selection state and detail rendering tests |

## Acceptance criteria

1. User can select a trace row via ↑/↓ keys
2. Selected row is visually marked with `>`
3. Enter toggles detail panel open/closed
4. Summary mode shows normalized fields: type, status, tool, session, file path
5. JSON mode shows raw event payload pretty-printed
6. Links mode shows all linked entity IDs
7. Chain mode shows related events by shared toolCallId/approvalId/sessionId
8. ESC closes the detail panel
9. Selection survives snapshot refresh if the selected event still exists
10. All keyboard navigation covered in tests

## Sequencing

```
M0.32  visible  ← done
M0.33  inspectable  ← this
M0.34  replayable  ← next
```
