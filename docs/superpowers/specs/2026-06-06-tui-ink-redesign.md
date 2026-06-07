# TUI Ink Redesign

**Date:** 2026-06-06
**Status:** Design Approved

## Motivation

The current TUI uses raw ANSI escape sequences for everything: scroll-region-based status bar, manual cursor tracking, and hand-rolled input handling. This approach works but has grown brittle — the PromptBar class keeps accumulating edge-case handling (arrow keys, Home/End, Ctrl+U, resize), and the streaming output fights with `console.log` from the plan phase.

Ink (React for terminals) gives us a proper component model, free input handling, and a declarative layout that's easier to maintain.

## Architecture

```
AlixApp (Ink root component)
├── <Static>             completed output lines (never re-rendered)
├── <Text>               current streaming line (re-renders per chunk)
├── <Box flexGrow={1}>   spacer pushes status/input to bottom
├── TokenBar             Ink component: divider + budget bar + session ID
└── TextInput            ink-text-input: rich input with history, cursor keys
```

### Output Model

Two output slots:

| Slot | Component | Behavior |
|------|-----------|----------|
| Completed lines | `<Static>` | Lines are appended via state. Ink never re-renders them — perfect scrollback. |
| Current stream | `<Text>` | Re-renders on every chunk. When a `\n` arrives, the line is promoted to `<Static>` and the stream slot resets to `""`. |

**Streaming chunk handling:**
- Each `appendOutput(text, streaming=true)` call replaces the current `<Text>` content
- If `text` contains `\n`, split: everything before the last `\n` goes to `<Static>`, the remainder becomes the new current line
- Chunks are written per-chunk, no buffering — token-level latency

### TokenBar Component

Displays in the pinned bottom zone:

```
 ───────────────────────────── ctx 15% ──────
 ███░░░░░░░  15% (150K/1,000K)
```

Color-coded: green (<60%), yellow (60-85%), red (>85%).

### Input Bar

Uses `ink-text-input`. Provides:
- Cursor movement (←/→)
- History (↑/↓)
- Home/End, Ctrl+A/E
- Ctrl+U to clear
- Paste support
- Automatic resize handling

### Tui Class (Wrapper)

Imperative wrapper matching the existing interface:

```typescript
class Tui {
  constructor(opts: { sessionId, eventLog, maxTokens? })
  async init(): Promise<void>     // mounts Ink app
  appendOutput(text, streaming): void  // pushes to streaming or static
  resetOutput(): void              // inserts separator
  updateTokenUsage(tokens): void   // updates TokenBar
  destroy(): void                  // unmounts Ink
  onTask: ((task: string) => Promise<void>) | null
  onExit: (() => void) | null
}
```

### Wire-up (cli/tui.ts)

1. Read config, resolve context limit
2. Create `Tui` instance with session/eventLog/maxTokens
3. Set `tui.onTask` to call `runTask()` with stream handler
4. In stream handler:
   - `chunk.type === "text"` → `tui.appendOutput(text, true)`
5. After `runTask` resolves → `tui.appendOutput(summary, false)`
6. Set `tui.onExit` → destroy + `process.exit(0)`
7. Call `tui.init()`
8. Push welcome lines via `appendOutput`

## Files

| File | Action | Purpose |
|------|--------|---------|
| `src/tui/AlixApp.tsx` | **NEW** | Ink root component with Static/stream/TokenBar/TextInput |
| `src/tui/index.ts` | **REWRITE** | Tui class wrapping Ink render |
| `src/cli/commands/tui.ts` | **REWRITE** | runTui entry point, simpler no stdin management |
| `src/tui/render.ts` | **REMOVE** | No longer needed — all rendering via Ink |
| `package.json` | **MODIFY** | Add `ink`, `ink-text-input`, `react` deps |
| `tests/tui/` | **UPDATE** | Fix tests for new renderer |

## What Stays Unchanged

- `src/tui/store.ts` — state model unchanged
- `src/tui/widgets/` — widget classes still produce strings (for potential future use)
- `src/tui/events.ts` — EventLogBridge unchanged
- `src/events/event-log.ts` — no changes

## Edge Cases

| Case | Behavior |
|------|----------|
| Streaming chunk with `\n` | Split; everything before last `\n` goes to `<Static>`, remainder stays in stream slot |
| Empty task | Ignored (same as current) |
| `exit` / `quit` | Calls `onExit` which triggers Ink `exit()` |
| Ctrl+C/D | Handled by `useInput` in AlixApp |
| Task throws | Caught in `onTask`, error pushed to output as info line |
| Resize during streaming | Ink handles automatically via `useStdout()` |
