# TUI Split-Screen Redesign

**Date:** 2026-06-03
**Status:** ✅ Completed (M0.7)

## Motivation

ALiX's current TUI does full-screen redraws on every render cycle. It clears all lines and rewrites them, which destroys streaming text output from the model. This makes the TUI incompatible with real-time streaming — the model's output appears for a frame then gets wiped.

Claude Code solves this with a **bottom-pinned status bar** pattern: the output area is append-only (never re-rendered), and only a thin status section at the bottom of the terminal updates in place.

## Target Layout

```
┌─────────────────────────────────────────────────────┐
│                                                     │  ← Output area (append-only, scrolls up naturally)
│ > Calling web_search("current president Nigeria")   │
│ ← Bola Tinubu is the 16th president of Nigeria...   │
│ ✓ Task completed.                                   │
│                                                     │
├─────────────────────────────────────────────────────┤
│ ● UNDERSTANDING  ✓ PLANNING  ● EXECUTING  ○ VERIFY  │  ← Bottom-pinned status (4 lines)
│ TOKENS: ████░░░░ 42% │ Files: 3 │ Model: deepseek  │
│ ⠋ Searching...                                      │
└─────────────────────────────────────────────────────┘
```

## Architecture

### Current `render.ts` (to be replaced)

```typescript
// Writes a complete frame, clears everything, rewrites
private doRender(): void {
  const output = this.buildOutput();
  renderDiff(this.lastRender, output);  // diff-based full redraw
  this.lastRender = output;
}

private buildOutput(): string {
  // State theater, budget bar, agent tree, spinner
  // All in one string, all redrawn every 100ms
}
```

### New `render.ts`

```typescript
private outputBuffer: string[] = [];  // append-only lines from agent
private statusHeight = 4;             // divider + 3 status lines
private terminalHeight = 0;           // detected at init

private initLayout(): void {
  // 1. Get terminal height
  // 2. Leave statusHeight lines at bottom
  // 3. Save cursor position
}

appendOutput(text: string): void {
  // 1. Write line above the status block
  // 2. Store in outputBuffer (configurable limit)
}

private renderStatus(): void {
  // 1. Save cursor
  // 2. Move to bottom-statusHeight
  // 3. Write divider + state theater + budget + spinner
  // 4. Restore cursor
  // No clearLine() — overwrite in place
}
```

## Files Affected

| File | Change |
|------|--------|
| `src/tui/render.ts` | Complete rewrite — split-screen layout, bottom-pinned status |
| `src/tui/ansi.ts` | Add `savePos`, `restorePos`, terminal-height helpers |
| `src/tui/index.ts` | Minor — expose `appendOutput()` method |
| Tests (new) | Verify layout math, output buffer, status rendering |

## What Stays Unchanged

- `src/tui/store.ts` — no changes
- `src/tui/widgets/*` — no changes, still produce strings
- `src/tui/diff-render.ts` — no longer needed (remove or keep for reference)
- `src/cli/commands/tui.ts` — no changes
