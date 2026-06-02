# Sub-Project #3: TUI Differential Rendering

**Date:** 2026-05-31
**Status:** Completed (2026-05-31)
**Parent Project:** What ALiX Can Learn From Pi Agent
**Source:** [earendil-works/pi-tui](https://github.com/earendil-works/pi/tree/main/packages/tui) — uses differential rendering to only redraw changed lines

## Motivation

ALiX's TUI (`src/tui/render.ts`, 127 lines) currently does **full redraws** on every change:

```typescript
private doRender(): void {
  const output = this.buildOutput();
  // Clear previous output line by line
  if (this.lastRender) {
    const prevLines = this.lastRender.split("\n").length;
    for (let i = 0; i < prevLines; i++) {
      process.stdout.write(moveUp(1));
      process.stdout.write(clearLine());
    }
  }
  // Print new output
  process.stdout.write(output + "\r");
}
```

**Problems with full redraws:**
1. **Flicker** — every redraw clears and rewrites everything, causing visual flicker
2. **Inefficient** — rewrites lines that didn't change
3. **Lost state** — spinner animations, in-progress streams get reset
4. **Spam on console** — full screen rewrites spam terminal scrollback
5. **No cursor preservation** — user can't have a prompt below the TUI

Pi Agent's `pi-tui` uses **differential rendering**: compute the new frame, compare line-by-line with the previous frame, and only emit ANSI sequences for the lines that actually changed. The rest of the screen is untouched.

## Goals

1. **Replace full redraws with line-level differential rendering** — only redraw changed lines
2. **Eliminate flicker** — unchanged lines stay on screen
3. **Preserve terminal scrollback** — don't spam the scrollback with reprints
4. **Preserve cursor position** for user input
5. **Keep the public `TuiRenderer` interface unchanged** — zero consumer impact
6. **Pure-function diff algorithm** — testable in isolation

## Non-Goals

- Rewriting the TUI from scratch
- Adding new widgets
- Changing the TUI store or events
- Optimizing to use alternate screen buffer (Pi Agent does this; we can defer)

## Architecture

### Current State
```
TuiRenderer
  → buildOutput()       (returns full string)
  → clear lines         (move up + clear)
  → write full string   (full redraw)
```

### Target State
```
TuiRenderer
  → buildOutput()       (returns full string)
  → diffLines(prev, next)  (returns list of changed line indices)
  → render diff         (only update changed lines, leave rest alone)
```

### New Module: `src/tui/diff-render.ts`

A pure-function differential renderer that takes two strings and returns the minimal ANSI sequence to transform the first into the second.

```typescript
// src/tui/diff-render.ts
export type DiffOp =
  | { type: "keep"; line: string }                          // line unchanged
  | { type: "replace"; lineIndex: number; line: string }    // line at index N needs replacement
  | { type: "insert"; lineIndex: number; line: string }     // new line at index N
  | { type: "delete"; lineIndex: number };                  // delete line at index N
  | { type: "scrollUp"; count: number };                    // terminal scrolled, reprint everything

export function diffLines(prev: string, next: string): DiffOp[] {
  // Line-level diff using LCS (longest common subsequence) algorithm
  // Returns minimal sequence of operations
}

export function renderDiff(prev: string, next: string, out: NodeJS.WriteStream = process.stdout): void {
  const ops = diffLines(prev, next);
  for (const op of ops) {
    switch (op.type) {
      case "keep": break;  // do nothing, line stays
      case "replace":
        // Move cursor to line, clear it, write new content
        out.write(moveToLine(op.lineIndex));
        out.write(clearLine);
        out.write(op.line);
        break;
      case "insert":
        // Insert at line N
        ...
      case "delete":
        // Delete line N
        ...
    }
  }
}
```

### Algorithm: Line-level diff via LCS

Given prev and next, both split into lines:
1. Compute Longest Common Subsequence (LCS) of line sequences
2. Walk the LCS table to identify:
   - Lines in `prev` not in LCS → **delete**
   - Lines in `next` not in LCS → **insert**
   - Lines in both LCS at same position → **keep**
   - Lines in `next` at different position than LCS → **replace** (delete + insert)
3. Coalesce adjacent operations for efficiency

For 60fps TUI with ~20 lines, this is O(N²) but N=20 makes it trivial. Real implementation can be optimized later if needed.

### Updated `TuiRenderer.doRender()`

```typescript
private doRender(): void {
  const output = this.buildOutput();
  if (!this.initialPrinted) {
    process.stdout.write(output);
    this.lastRender = output;
    this.initialPrinted = true;
    return;
  }
  renderDiff(this.lastRender, output);
  this.lastRender = output;
}
```

The renderer no longer clears lines — `renderDiff` does the minimal work.

## Data Flow

```
buildOutput() returns full screen as string
  ↓
diffLines(prev, next) computes line-level diff
  ↓
renderDiff() emits ANSI escape sequences only for changed lines
  ↓
Terminal: only changed lines are updated
```

## Edge Cases

1. **First render** (no `prev`) → print all lines, save as `prev`
2. **Terminal resized** → scroll detected, full repaint
3. **Line shorter than previous** → clear remainder of line
4. **Line longer than previous** → just print, terminal handles wrap
5. **Empty prev** → print all of next
6. **Empty next** → clear all lines of prev

## Testing Strategy

### Pure function tests (TDD)
```
tests/tui/diff-render.test.ts
├── diffLines: identical strings → empty ops
├── diffLines: one line added → insert op
├── diffLines: one line removed → delete op
├── diffLines: one line changed → replace op
├── diffLines: multiple changes → optimal diff
├── diffLines: completely different → full replace
├── diffLines: prev empty → all inserts
├── diffLines: next empty → all deletes
├── renderDiff: writes nothing when no changes
├── renderDiff: writes to specified stream
└── renderDiff: handles terminal width correctly
```

### Integration test
```
tests/tui/tui-renderer.test.ts
├── "first render writes full output"
├── "subsequent render only updates changed lines" (mock stdout)
└── "handles store change without flicker"
```

### Compatibility regression
- All existing TUI tests must continue to pass
- No changes to public API

## Files Affected

| Action | File | Reason |
|--------|------|--------|
| ➕ New | `src/tui/diff-render.ts` | Differential renderer (~100 lines) |
| ➕ New | `tests/tui/diff-render.test.ts` | Pure function tests |
| ✏️ Modify | `src/tui/render.ts` | Use diff-render instead of full redraw |
| ✏️ Modify | `src/tui/ansi.ts` | Add `moveToLine` and `clearToEndOfLine` helpers |
| ➕ New | `tests/tui/tui-renderer-integration.test.ts` | Integration test |

**Unchanged:**
- `src/tui/store.ts`, `src/tui/events.ts`, `src/tui/index.ts` — no API changes
- All widgets (`src/tui/widgets/*`) — they return strings, no changes needed
- `src/tui/cursor.ts` — kept

## Migration Strategy

1. **Add `diff-render.ts` first** with TDD (no consumer changes yet)
2. **Add ANSI helpers** (`moveToLine`, `clearToEndOfLine`)
3. **Update `TuiRenderer.doRender()`** to use `renderDiff`
4. **Verify existing TUI tests pass** — should be no behavior change for the user
5. **Add integration test** that verifies minimal output

## Success Criteria

- [ ] `src/tui/diff-render.ts` implemented with 100% test coverage
- [ ] `TuiRenderer` uses `renderDiff` instead of full redraw
- [ ] All existing TUI tests pass
- [ ] New tests for diff algorithm + integration
- [ ] `npm test` passes (1175+ pass, 0 fail)
- [ ] Visual: TUI no longer flickers on updates (manual test in `alix run`)

## Out of Scope (Other Sub-Projects)

- Sub-project #4: Supply-chain hardening
- Sub-project #5: Self-extensibility improvements
- Sub-project #6: Public session sharing
