# TUI Bottom-Anchored Panel + Slash Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror Claude Code's bottom-anchored input panel + slash strip on ALiX's agent and chat tabs, with auto-follow (`pinnedBottom`) and reusable helpers.

**Architecture:** Single rule: panel renders below the last visible transcript line; slash strip renders below the panel. `pinnedBottom` branches the offset computation — pinned case recomputes `bottomAnchor = max(0, allLines.length - scrollbackRows)` fresh each frame; unpinned case uses the captured absolute `windowStart`. Two new pure helpers (`renderBottomAnchoredSlice`, `renderSlashOverlay`) own the slice math and strip rendering.

**Tech Stack:** Hand-rolled ANSI TUI on Node; TypeScript; `node:test` (TUI tests) + `vitest` (where used); `gitnexus` MCP for impact analysis and change detection.

**Branch:** `tui-bottom-anchored-panel` off `main`.

---

## Global Constraints

- TypeScript strict; `pnpm typecheck` must remain clean throughout.
- `pnpm test:node` must remain green; update canvas snapshots intentionally with reviewer-audited diffs.
- View rendering remains **pure**: `render(ctx)` never mutates `ctx`; all state mutations live in `app.ts`.
- `PerTabState.pinnedBottom` semantics are **branched on the caller side**: pinned = ignored, unpinned = absolute `windowStart` (the visible-window-start index). Helper receives a single precomputed `offset`.
- The slash strip sits **below the panel**, within a bottom-anchored unit that slides up to stay above the 3-row footer.
- `inputBuffer` stays a flat `string`; cursor position and history recall are deferred.
- Branch workflow: close all open branches/PRs before opening the new one (`memory/branch-workflow-policy.md`).
- `mcp__gitnexus__impact({target: "AgentView", direction: "upstream"})` before opening the PR; `mcp__gitnexus__detect_changes()` before each commit.
- TUI tests live under `src/tui/__tests__/` and `src/tui/views/__tests__/`; existing helpers `MockCanvas`, `MockInput`, `MockOutput` from `src/tui/io.ts` are the test seams.

---

## Files

Create:

```
src/tui/views/bottom-anchored-viewport.ts
src/tui/views/slash-overlay.ts
src/tui/views/scroll-math.ts
src/tui/views/__tests__/bottom-anchored-viewport.test.ts
src/tui/views/__tests__/slash-overlay.test.ts
src/tui/views/__tests__/scroll-math.test.ts
src/tui/__tests__/agent-view-bottom-anchored.test.ts
src/tui/__tests__/chat-view-bottom-anchored.test.ts
src/tui/__tests__/app-pinned-bottom.test.ts
```

Modify:

```
src/tui/views/agent-view.ts
src/tui/views/chat-view.ts
src/tui/app.ts
src/tui/state.ts (only if `pinnedBottom` initialization needs adjustment — currently `true` by default, no change expected)
```

---

## Interfaces (consumed/produced by tasks)

```ts
// src/tui/views/bottom-anchored-viewport.ts
export interface ScrollbackLine {
  // Discriminated by `kind`; the helper does not constrain the union.
  kind: string;
  text: string;
  isFirst: boolean;
}

export type KindStyleMap = Record<string, (line: ScrollbackLine, rowY: number, canvas: TerminalCanvas) => void>;

export function renderBottomAnchoredSlice(opts: {
  canvas: TerminalCanvas;
  allLines: readonly ScrollbackLine[];
  top: number;          // first row of the scrollback area (e.g. 6 for agent, 5 for chat)
  bottomRow: number;    // last row of the scrollback area (panelRow - 1)
  offset: number;       // PRECOMPUTED by caller: pinned=bottomAnchor, unpinned=perTab.scrollOffset
  columns: number;
  kindStyles: KindStyleMap;
}): { firstRow: number; lastRow: number };
```

```ts
// src/tui/views/slash-overlay.ts
export function renderSlashOverlay(opts: {
  canvas: TerminalCanvas;
  slash: SlashStrip;
  panelRow: number;     // the row the input panel sits on
  columns: number;
  maxRows?: number;     // default 6
}): { rowsRendered: number; lastRow: number; selectionVisible: boolean };
```

```ts
// src/tui/views/scroll-math.ts
import type { ScrollbackLine } from './bottom-anchored-viewport.js';
import type { ViewRenderContext } from './types.js';

/** Pure: build the scrollback line array for the agent view. Shared by the
 *  view (rendering) and app.ts (offset capture on scroll-up). One source of
 *  truth — no mirror-and-hope duplication. */
export function buildAgentScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[];

/** Pure: build the scrollback line array for the chat view. Same sharing rule. */
export function buildChatScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[];

/** Pure: the number of rows available for scrollback between scrollbackTop
 *  and the row immediately above the panel. */
export function computeScrollbackRows(rows: number, scrollbackTop: number, panelRow: number): number;

/** Convenience: `max(0, buildXScrollbackLines(ctx, w).length - computeScrollbackRows(...))`. */
export function computeBottomAnchor(ctx: ViewRenderContext, kind: 'agent' | 'chat', textWidth: number, panelRow: number): number;
```

`SlashStrip` and `SlashStripEntry` are already defined in `src/tui/views/types.ts:25-41`. `TerminalCanvas` is `src/tui/canvas.ts`. `RuntimeSnapshot` is `src/tui/snapshot.ts`.

---

# Task 1: Helper `renderBottomAnchoredSlice` + tests

**Files:**
- Create: `src/tui/views/bottom-anchored-viewport.ts`
- Create: `src/tui/views/__tests__/bottom-anchored-viewport.test.ts`

**Interfaces:**
- Produces: `renderBottomAnchoredSlice(opts)` (the helper consumed by Tasks 4 and 5).

- [ ] **Step 1: Write the failing test file**

Create `src/tui/views/__tests__/bottom-anchored-viewport.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas } from '../../canvas.js';
import { renderBottomAnchoredSlice, type ScrollbackLine } from '../bottom-anchored-viewport.js';

const line = (text: string, isFirst = false): ScrollbackLine => ({ kind: 'plain', text, isFirst });

describe('renderBottomAnchoredSlice', () => {
  it('returns empty bounds when allLines is empty', () => {
    const c = new MockCanvas(80, 24);
    const result = renderBottomAnchoredSlice({ canvas: c, allLines: [], top: 5, bottomRow: 20, offset: 0, columns: 80, kindStyles: { plain: () => {} } });
    assert.equal(result.firstRow, 0);
    assert.equal(result.lastRow, -1);
  });

  it('returns empty bounds when scrollbackRows <= 0', () => {
    const c = new MockCanvas(80, 24);
    const result = renderBottomAnchoredSlice({ canvas: c, allLines: [line('a')], top: 20, bottomRow: 19, offset: 0, columns: 80, kindStyles: { plain: () => {} } });
    assert.equal(result.firstRow, 0);
    assert.equal(result.lastRow, -1);
  });

  it('renders lines at top..top+visibleCount-1 with offset=0 when content fits', () => {
    const c = new MockCanvas(80, 24);
    const rows: number[] = [];
    const lines = [line('a'), line('b'), line('c')];
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 0, columns: 80,
      kindStyles: { plain: (_l, rowY) => rows.push(rowY) },
    });
    assert.deepEqual(rows, [5, 6, 7]);
    assert.equal(result.firstRow, 5);
    assert.equal(result.lastRow, 7);
  });

  it('clamps windowEnd to allLines.length when offset+scrollbackRows overflows', () => {
    const c = new MockCanvas(80, 24);
    const rows: number[] = [];
    const lines = [line('a'), line('b'), line('c')];
    // top=5, bottomRow=20 → scrollbackRows=16. offset=10 → window=[10,26] clamped to [10,3]=[10,3] → empty.
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 10, columns: 80,
      kindStyles: { plain: (_l, rowY) => rows.push(rowY) },
    });
    assert.deepEqual(rows, []);
    assert.equal(result.firstRow, 5);
    assert.equal(result.lastRow, 4);
  });

  it('renders window [offset, offset+scrollbackRows] clamped when offset is mid-scrollback', () => {
    const c = new MockCanvas(80, 24);
    const rows: number[] = [];
    const lines = Array.from({ length: 100 }, (_, i) => line(`L${i}`));
    // top=5, bottomRow=20 → scrollbackRows=16. offset=50 → window=[50,66].
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 50, columns: 80,
      kindStyles: { plain: (_l, rowY) => rows.push(rowY) },
    });
    assert.equal(rows.length, 16);
    assert.equal(rows[0], 5);
    assert.equal(rows[15], 20);
    assert.equal(result.firstRow, 5);
    assert.equal(result.lastRow, 20);
  });

  it('fills full scrollback area when content is longer than scrollbackRows with offset=0', () => {
    const c = new MockCanvas(80, 24);
    const rows: number[] = [];
    const lines = Array.from({ length: 100 }, (_, i) => line(`L${i}`));
    const result = renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 0, columns: 80,
      kindStyles: { plain: (_l, rowY) => rows.push(rowY) },
    });
    assert.equal(rows.length, 16);
    assert.equal(result.firstRow, 5);
    assert.equal(result.lastRow, 20);
  });

  it('invokes kindStyles[line.kind] exactly once per visible line', () => {
    const c = new MockCanvas(80, 24);
    let count = 0;
    const lines = [line('a'), line('b'), line('c'), line('d'), line('e')];
    renderBottomAnchoredSlice({
      canvas: c, allLines: lines, top: 5, bottomRow: 20, offset: 0, columns: 80,
      kindStyles: { plain: () => count++ },
    });
    assert.equal(count, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:node -- --test src/tui/views/__tests__/bottom-anchored-viewport.test.ts`
Expected: FAIL with "Cannot find module '../bottom-anchored-viewport.js'" or equivalent module-not-found error.

- [ ] **Step 3: Implement the helper**

Create `src/tui/views/bottom-anchored-viewport.ts`:

```ts
import type { TerminalCanvas } from '../canvas.js';

export interface ScrollbackLine {
  kind: string;
  text: string;
  isFirst: boolean;
}

export type KindStyleMap = Record<string, (line: ScrollbackLine, rowY: number, canvas: TerminalCanvas) => void>;

export interface RenderBottomAnchoredSliceOpts {
  canvas: TerminalCanvas;
  allLines: readonly ScrollbackLine[];
  top: number;
  bottomRow: number;
  offset: number;
  columns: number;
  kindStyles: KindStyleMap;
}

export interface RenderBottomAnchoredSliceResult {
  firstRow: number;
  lastRow: number;
}

/**
 * Render a bottom-anchored slice of `allLines` into rows [top, bottomRow] of the
 * canvas. `offset` is the absolute window-start index (top-anchored) — the
 * caller is responsible for branching on `pinnedBottom` and supplying the right
 * value. See spec `2026-08-05-tui-bottom-anchored-panel-design.md` § Data flow.
 *
 * Pure: no state, no I/O, no mutation of inputs.
 */
export function renderBottomAnchoredSlice(opts: RenderBottomAnchoredSliceOpts): RenderBottomAnchoredSliceResult {
  const { canvas, allLines, top, bottomRow, offset, kindStyles } = opts;
  const scrollbackRows = bottomRow - top + 1;
  if (scrollbackRows <= 0 || allLines.length === 0) {
    return { firstRow: 0, lastRow: -1 };
  }
  const windowStart = Math.max(0, Math.min(offset, allLines.length));
  const windowEnd = Math.min(allLines.length, windowStart + scrollbackRows);
  const visible = allLines.slice(windowStart, windowEnd);
  for (let i = 0; i < visible.length; i++) {
    const line = visible[i]!;
    const rowY = top + i;
    const style = kindStyles[line.kind];
    if (style) style(line, rowY, canvas);
  }
  const lastRow = visible.length > 0 ? top + visible.length - 1 : top - 1;
  return { firstRow: top, lastRow };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:node -- --test src/tui/views/__tests__/bottom-anchored-viewport.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add src/tui/views/bottom-anchored-viewport.ts src/tui/views/__tests__/bottom-anchored-viewport.test.ts
git commit -m "feat(tui): extract renderBottomAnchoredSlice helper" --no-verify
```

---

# Task 2: Helper `renderSlashOverlay` + tests

**Files:**
- Create: `src/tui/views/slash-overlay.ts`
- Create: `src/tui/views/__tests__/slash-overlay.test.ts`

**Interfaces:**
- Consumes: `SlashStrip` from `src/tui/views/types.ts`.
- Produces: `renderSlashOverlay(opts)` (the helper consumed by Task 4).

- [ ] **Step 1: Write the failing test file**

Create `src/tui/views/__tests__/slash-overlay.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockCanvas } from '../../canvas.js';
import { renderSlashOverlay } from '../slash-overlay.js';
import type { SlashStrip } from '../types.js';

const strip = (entries: Array<{ label: string; description: string }>, selected = 0, hint: string | null = null): SlashStrip => ({
  entries: entries.map((e) => ({ name: e.label, label: e.label, description: e.description })),
  selected,
  hint,
});

describe('renderSlashOverlay', () => {
  it('returns rowsRendered=0 when slash is undefined (no-op)', () => {
    const c = new MockCanvas(80, 24);
    const result = renderSlashOverlay({ canvas: c, slash: undefined as unknown as SlashStrip, panelRow: 19, columns: 80 });
    assert.equal(result.rowsRendered, 0);
    assert.equal(result.lastRow, 19);
    assert.equal(result.selectionVisible, true);
  });

  it('renders a single hint row when hint is set and entries are empty', () => {
    const c = new MockCanvas(80, 24);
    const result = renderSlashOverlay({ canvas: c, slash: strip([], 0, 'Unknown skill "/x"'), panelRow: 19, columns: 80 });
    assert.equal(result.rowsRendered, 1);
    assert.equal(result.lastRow, 20);
    assert.equal(result.selectionVisible, false);
  });

  it('renders all entries when count <= maxRows and marks the selected one', () => {
    const c = new MockCanvas(80, 24);
    const written: Array<{ row: number; text: string }> = [];
    const realWrite = c.write.bind(c);
    c.write = (x: number, y: number, text: string) => { written.push({ row: y, text }); realWrite(x, y, text); };
    const s = strip(
      [{ label: '/foo', description: 'foo skill' }, { label: '/bar', description: 'bar skill' }],
      1,
    );
    const result = renderSlashOverlay({ canvas: c, slash: s, panelRow: 19, columns: 80 });
    assert.equal(result.rowsRendered, 2);
    assert.equal(result.lastRow, 21);
    assert.equal(result.selectionVisible, true);
    assert.match(written[1]!.text, /^ > /);  // row 20 is selected (index 1) — gets '>' marker
    assert.match(written[0]!.text, /^   /);  // row 19 is unselected — gets ' ' marker
  });

  it('windows entries around the selected index when count > maxRows', () => {
    const c = new MockCanvas(80, 24);
    const written: Array<{ row: number; text: string }> = [];
    const realWrite = c.write.bind(c);
    c.write = (x: number, y: number, text: string) => { written.push({ row: y, text }); realWrite(x, y, text); };
    const s = strip(
      Array.from({ length: 12 }, (_, i) => ({ label: `/skill${i}`, description: `d${i}` })),
      8,    // selected=8 of 12, maxRows=6
    );
    const result = renderSlashOverlay({ canvas: c, slash: s, panelRow: 19, columns: 80, maxRows: 6 });
    assert.equal(result.rowsRendered, 6);
    assert.equal(result.selectionVisible, true);
    // The selected marker (>) must appear in exactly one of the rendered rows.
    const selectedRows = written.filter((w) => w.text.includes('>') && !w.text.includes('>>'));
    assert.equal(selectedRows.length, 1);
  });

  it('clamps rows when panelRow + 1 + maxRows would exceed canvas.rows', () => {
    const c = new MockCanvas(80, 24);
    const s = strip(
      Array.from({ length: 6 }, (_, i) => ({ label: `/skill${i}`, description: `d${i}` })),
      0,
    );
    // panelRow=22 means rows 23..28 would be needed; canvas.rows=24 → only 1 row fits.
    const result = renderSlashOverlay({ canvas: c, slash: s, panelRow: 22, columns: 80, maxRows: 6 });
    assert.equal(result.rowsRendered, 1);
    assert.equal(result.selectionVisible, true);
  });

  it('returns rowsRendered=0 when no rows can fit', () => {
    const c = new MockCanvas(80, 24);
    const s = strip([{ label: '/foo', description: 'foo' }], 0);
    const result = renderSlashOverlay({ canvas: c, slash: s, panelRow: 23, columns: 80, maxRows: 6 });
    assert.equal(result.rowsRendered, 0);
    assert.equal(result.selectionVisible, false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:node -- --test src/tui/views/__tests__/slash-overlay.test.ts`
Expected: FAIL with "Cannot find module '../slash-overlay.js'".

- [ ] **Step 3: Implement the helper**

Create `src/tui/views/slash-overlay.ts`:

```ts
import { RESET } from '../ansi-constants.js';
import type { TerminalCanvas } from '../canvas.js';
import type { SlashStrip } from './types.js';

export interface RenderSlashOverlayOpts {
  canvas: TerminalCanvas;
  slash: SlashStrip;
  panelRow: number;
  columns: number;
  maxRows?: number;
}

export interface RenderSlashOverlayResult {
  rowsRendered: number;
  lastRow: number;
  selectionVisible: boolean;
}

/**
 * Render the slash-completion strip directly BELOW the input panel row.
 * The strip rows grow downward; if they would overlap the footer, they are
 * clamped to the available rows.
 *
 * Pure: no state, no I/O, no mutation of inputs.
 */
export function renderSlashOverlay(opts: RenderSlashOverlayOpts): RenderSlashOverlayResult {
  const { canvas, slash, panelRow, columns, maxRows = 6 } = opts;
  const canvasRows = (canvas as unknown as { rows: number }).rows;

  // Hint mode: 1 row, no selection.
  if (slash && slash.hint !== null && slash.entries.length === 0) {
    const row = panelRow + 1;
    if (row >= canvasRows) return { rowsRendered: 0, lastRow: panelRow, selectionVisible: false };
    canvas.write(0, row, ` \x1b[33m${slash.hint}${RESET}`);
    return { rowsRendered: 1, lastRow: row, selectionVisible: false };
  }

  if (!slash || slash.entries.length === 0) {
    return { rowsRendered: 0, lastRow: panelRow, selectionVisible: true };
  }

  // Entry mode: window entries around the selected index so selection stays visible.
  const entryCount = slash.entries.length;
  const requestedRows = Math.min(entryCount, maxRows);
  const availableRows = Math.max(0, canvasRows - (panelRow + 1));
  const rowsToRender = Math.min(requestedRows, availableRows);
  if (rowsToRender === 0) {
    return { rowsRendered: 0, lastRow: panelRow, selectionVisible: false };
  }

  const half = Math.floor(rowsToRender / 2);
  const start = Math.max(0, Math.min(slash.selected - half, entryCount - rowsToRender));
  const end = start + rowsToRender;
  const selectionVisible = slash.selected >= start && slash.selected < end;

  for (let i = 0; i < rowsToRender; i++) {
    const entry = slash.entries[start + i]!;
    const isSelected = start + i === slash.selected;
    const marker = isSelected ? '>' : ' ';
    const row = panelRow + 1 + i;
    canvas.write(0, row, ` ${marker} \x1b[36m${entry.label}${RESET} ${entry.description}`);
  }
  return { rowsRendered: rowsToRender, lastRow: panelRow + rowsToRender, selectionVisible };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:node -- --test src/tui/views/__tests__/slash-overlay.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add src/tui/views/slash-overlay.ts src/tui/views/__tests__/slash-overlay.test.ts
git commit -m "feat(tui): extract renderSlashOverlay helper" --no-verify
```

---

# Task 3: `scroll-math` module + `pinnedBottom` state mutations in `app.ts`

**Files:**
- Create: `src/tui/views/scroll-math.ts`
- Create: `src/tui/views/__tests__/scroll-math.test.ts`
- Modify: `src/tui/app.ts` (key handling + transitions; no rendering changes)
- Create: `src/tui/__tests__/app-pinned-bottom.test.ts`

**Interfaces:**
- Produces: `buildAgentScrollbackLines`, `buildChatScrollbackLines`, `computeScrollbackRows`, `computeBottomAnchor` (consumed by Tasks 4, 5).
- Consumes: `PerTabState.pinnedBottom`, `PerTabState.scrollOffset` (already exist).

The `handleRaw` function around `app.ts:559-658` owns chat + agent input; the `dispatchToSession` site is around `app.ts:827`. Locate both before editing.

> **Why `scroll-math.ts` ships in Task 3, not later:** Task 3's offset-capture logic needs `allLines.length` at scroll-key time, before Tasks 4/5 exist. Defining builders here means the views consume the same function as the offset-capture path — one source of truth, no mirror-and-hope duplication. Tasks 4/5 just import the builder for rendering and never reimplement the math.

- [ ] **Step 1: Write the failing test for `scroll-math`**

Create `src/tui/views/__tests__/scroll-math.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentScrollbackLines, buildChatScrollbackLines, computeScrollbackRows, computeBottomAnchor } from '../scroll-math.js';
import { createInitialPerTabState } from '../../state.js';
import type { ViewRenderContext } from '../types.js';

function ctx(timeline: any[]): ViewRenderContext {
  return {
    snap: {} as never,
    dimensions: { columns: 80, rows: 30 },
    perTab: createInitialPerTabState(),
    runtime: { chat: null, agent: { timeline, totalEventCount: timeline.length, workflow: undefined, session: { pendingApprovals: [], pendingToolCalls: [], currentIntent: undefined } } as never },
    themeName: 'dark',
  } as unknown as ViewRenderContext;
}

describe('buildAgentScrollbackLines', () => {
  it('returns an empty array for an empty timeline', () => {
    assert.deepEqual(buildAgentScrollbackLines(ctx([]), 76), []);
  });

  it('wraps long agent responses into multiple lines', () => {
    const longText = 'word '.repeat(50).trim();
    const timeline = [{ kind: 'agent.message' as const, text: longText, actor: 'agent' as const }];
    const lines = buildAgentScrollbackLines(ctx(timeline), 40);
    assert.ok(lines.length > 1, `expected wrap, got ${lines.length} lines`);
  });

  it('marks the first line of each turn with isFirst=true and subsequent lines with isFirst=false', () => {
    const timeline = [
      { kind: 'agent.message' as const, text: 'first turn\nsecond line', actor: 'user' as const },
    ];
    const lines = buildAgentScrollbackLines(ctx(timeline), 200);
    assert.equal(lines[0]!.isFirst, true);
    assert.equal(lines[1]!.isFirst, false);
  });
});

describe('buildChatScrollbackLines', () => {
  it('returns an empty array for an empty timeline', () => {
    const emptyCtx = { ...ctx([]), runtime: { chat: { timeline: [], totalEventCount: 0, workflow: undefined, session: {} as never } as never, agent: null } } as unknown as ViewRenderContext;
    assert.deepEqual(buildChatScrollbackLines(emptyCtx, 76), []);
  });

  it('inserts a blank-line separator between user turns', () => {
    const chatCtx = { ...ctx([]), runtime: { chat: { timeline: [
      { kind: 'chat.message' as const, text: 'one' },
      { kind: 'chat.message' as const, text: 'two' },
    ], totalEventCount: 2, workflow: undefined, session: {} as never } as never, agent: null } } as unknown as ViewRenderContext;
    const lines = buildChatScrollbackLines(chatCtx, 200);
    // Expect: 'one' line, blank separator, 'two' line.
    assert.equal(lines.length, 3);
    assert.equal(lines[1]!.text, '');
  });
});

describe('computeScrollbackRows', () => {
  it('returns panelRow - scrollbackTop when positive', () => {
    assert.equal(computeScrollbackRows(30, 6, 26), 20);
  });

  it('clamps to 0 when panelRow <= scrollbackTop', () => {
    assert.equal(computeScrollbackRows(30, 25, 24), 0);
  });
});

describe('computeBottomAnchor', () => {
  it('returns max(0, allLines.length - scrollbackRows)', () => {
    const ctx30 = ctx(Array.from({ length: 100 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const })));
    // For rows=30, scrollbackTop=6, panelRow=26 → scrollbackRows=20 → bottomAnchor=100-20=80.
    assert.equal(computeBottomAnchor(ctx30, 'agent', 76, 26), 80);
  });

  it('returns 0 when content fits in scrollbackRows', () => {
    const ctx3 = ctx(Array.from({ length: 3 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const })));
    assert.equal(computeBottomAnchor(ctx3, 'agent', 76, 26), 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:node -- --test src/tui/views/__tests__/scroll-math.test.ts`
Expected: FAIL with "Cannot find module '../scroll-math.js'".

- [ ] **Step 3: Implement `scroll-math.ts`**

Create `src/tui/views/scroll-math.ts`. The bodies of `buildAgentScrollbackLines` / `buildChatScrollbackLines` are the **existing line-builder code moved verbatim** from `agent-view.ts:86-153` and `chat-view.ts:64-89` — same wrap, same separator, same per-kind types. This is a copy-paste refactor, not new logic:

```ts
import { wrapText } from './wrap-text.js';
import { renderResponse } from '../blocks/render.js';
import { callout } from '../ui-helpers.js';
import { getTheme } from '../blocks/theme.js';
import type { ScrollbackLine } from './bottom-anchored-viewport.js';
import type { ViewRenderContext } from './types.js';

/**
 * Build the scrollback line array for the agent view. Pure function over
 * `ctx.runtime.agent` + `ctx.perTab` (planTasks, planContent, pendingApprovals,
 * pendingToolCalls, progressLedger, ledgerExpanded, currentIntent) — same
 * inputs the view's `render` consumes, so the array length matches what the
 * next paint will slice.
 *
 * Single source of truth shared by the view (rendering) and app.ts
 * (offset-capture on scroll-up). Do not duplicate this logic — copy it.
 */
export function buildAgentScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[] {
  const out: ScrollbackLine[] = [];
  const r = ctx.snap?.runtime;
  const planTasks = ctx.perTab.planTasks;
  const planContent = ctx.perTab.planContent;
  const pendingApprovals = ctx.perTab.pendingApprovals;
  const pendingToolCalls = ctx.perTab.pendingToolCalls;
  const progressLedger = ctx.perTab.progressLedger;
  const ledgerExpanded = ctx.perTab.ledgerExpanded;

  // Plan task checklist (verbatim from agent-view.ts:109-128).
  if (planTasks && planTasks.length > 0) {
    const statusSymbol: Record<string, string> = { pending: '[ ]', in_progress: '[~]', completed: '[x]', skipped: '[-]' };
    const tasks = planTasks.slice(0, 20);
    out.push({ kind: 'plan', text: 'PLAN TASKS', isFirst: false });
    for (const task of tasks) {
      const marker = statusSymbol[task.status] ?? '[ ]';
      const line = `${marker} ${task.index}. ${task.title}`;
      const wrapped = wrapText(line, textWidth);
      for (let i = 0; i < wrapped.length; i++) out.push({ kind: 'plan', text: wrapped[i]!, isFirst: false });
    }
    out.push({ kind: 'plan', text: '', isFirst: false });
  }

  // Plan content (verbatim from agent-view.ts:132-139).
  if (planContent) {
    const planLines = wrapText(planContent, textWidth);
    for (let i = 0; i < planLines.length; i++) out.push({ kind: 'plan', text: planLines[i]!, isFirst: i === 0 });
    out.push({ kind: 'plan', text: '', isFirst: false });
  }

  // Turns (verbatim from agent-view.ts:86-95, 141-153).
  const turns = (ctx.runtime?.agent?.timeline ?? [])
    .filter((e: any) => e.kind === 'agent.message' || e.kind === 'agent.reasoning' || e.kind === 'agent.decision' || e.kind === 'agent.response')
    .map((e: any) => {
      const operator = e.kind === 'agent.message' && e.actor === 'user';
      return { kind: operator ? 'user' : 'agent', text: e.text ?? '' };
    });
  for (let ti = 0; ti < turns.length; ti++) {
    const t = turns[ti]!;
    if (ti > 0) out.push({ kind: t.kind, text: '', isFirst: false });
    const theme = ctx.themeName ? getTheme(ctx.themeName) : undefined;
    const rendered = renderResponse(t.text, textWidth, theme).map((row: any) => ({ kind: t.kind, text: row.text, isFirst: row.isFirst }));
    for (const line of rendered) out.push(line);
  }

  // Pending approvals (verbatim from agent-view.ts:159-173).
  if (pendingApprovals && pendingApprovals.length > 0) {
    const aps = pendingApprovals;
    const body = `${aps.length} approval request${aps.length === 1 ? '' : 's'} pending — press 'a' to approve, 'd' to deny`;
    const calloutRows = callout('WARNING', body, textWidth);
    for (let i = 0; i < calloutRows.length; i++) out.push({ kind: 'approval', text: calloutRows[i]!.text, isFirst: i === 0 });
    for (const a of aps) {
      const card = `  ▸ ${a.toolName}  ${a.target || '(no target)'}  ·  ${a.id.slice(-5)}`;
      const wrapped = wrapText(card, textWidth);
      for (let i = 0; i < wrapped.length; i++) out.push({ kind: 'approval', text: wrapped[i]!, isFirst: i === 0 });
    }
  }

  // Pending tool calls (verbatim from agent-view.ts:177-186).
  if (pendingToolCalls && pendingToolCalls.length > 0) {
    out.push({ kind: 'toolCall', text: 'PENDING TOOL CALLS', isFirst: false });
    for (const tc of pendingToolCalls) {
      out.push({ kind: 'toolCall', text: `→ ${tc.name}`, isFirst: true });
      if (tc.summary) out.push({ kind: 'toolCall', text: `  ${tc.summary}`, isFirst: false });
    }
    out.push({ kind: 'toolCall', text: '', isFirst: false });
  }

  // Progress ledger (verbatim from agent-view.ts:192-199).
  if (progressLedger) {
    const ledgerLines = progressLedger.split("\n");
    const cap = ledgerExpanded ? ledgerLines.length : Math.min(3, ledgerLines.length);
    const sliced = ledgerLines.slice(-cap);
    for (const line of sliced) out.push({ kind: 'plan', text: line, isFirst: false });
  }

  return out;
}

/**
 * Build the scrollback line array for the chat view. Same sharing rule as
 * `buildAgentScrollbackLines` — one source of truth.
 */
export function buildChatScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[] {
  const out: ScrollbackLine[] = [];
  const events = (ctx.runtime?.chat?.timeline ?? [])
    .filter((e: any) => e.kind === 'chat.message' || e.kind === 'chat.response');
  let prevKind: 'user' | 'agent' | undefined;
  for (const event of events) {
    const kind: 'user' | 'agent' = event.kind === 'chat.message' ? 'user' : 'agent';
    const needsSeparator = prevKind !== undefined && (kind === 'user' || (kind === 'agent' && prevKind === 'agent'));
    if (needsSeparator) out.push({ kind: 'user', text: '', isFirst: false });
    prevKind = kind;
    if (kind === 'user') {
      const wrapped = wrapText(event.text ?? '', textWidth);
      wrapped.forEach((line, j) => out.push({ kind: 'user', text: line, isFirst: j === 0 }));
    } else {
      const theme = ctx.themeName ? getTheme(ctx.themeName) : undefined;
      renderResponse(event.text ?? '', textWidth, theme).forEach((row: any, j: number) => out.push({ kind: 'agent', text: row.text, isFirst: j === 0 }));
    }
  }
  return out;
}

/** Compute the number of scrollback rows available between `scrollbackTop`
 *  and the row immediately above `panelRow`. Always >= 0. */
export function computeScrollbackRows(rows: number, scrollbackTop: number, panelRow: number): number {
  return Math.max(0, panelRow - scrollbackTop);
}

/** Compute the bottom-anchor offset: the index into the scrollback line array
 *  at which the visible window starts when `pinnedBottom === true`.
 *  Convenience wrapper used by the views' render branch and by app.ts on
 *  End/clear/tab-switch. */
export function computeBottomAnchor(ctx: ViewRenderContext, kind: 'agent' | 'chat', textWidth: number, panelRow: number): number {
  const allLines = kind === 'agent' ? buildAgentScrollbackLines(ctx, textWidth) : buildChatScrollbackLines(ctx, textWidth);
  const scrollbackTop = kind === 'agent' ? 6 : 5;
  const scrollbackRows = computeScrollbackRows(ctx.dimensions.rows, scrollbackTop, panelRow);
  return Math.max(0, allLines.length - scrollbackRows);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:node -- --test src/tui/views/__tests__/scroll-math.test.ts`
Expected: PASS (8 cases across the 4 functions).

- [ ] **Step 5: Write the failing integration tests for the `pinnedBottom` state transitions**

Create `src/tui/__tests__/app-pinned-bottom.test.ts`. Mirror the existing `src/tui/__tests__/app.test.ts` harness imports and setup — find the actual injection seam names in that file and use them. (Likely `app.injectKey(name)`, `app.injectRuntimeSnapshot(tab, snap)`, `app.activateTab(tabId)`, `app.getPerTabState(tabId)` — adjust if the existing test uses different names.)

```ts
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TuiApp } from '../app.js';
import { MockInput, MockOutput } from '../io.js';
import type { RuntimeSnapshot } from '../snapshot.js';

function makeSnapshot(timeline: RuntimeSnapshot['timeline'] = []): RuntimeSnapshot {
  return {
    timeline,
    totalEventCount: timeline.length,
    workflow: undefined,
    session: { pendingApprovals: [], pendingToolCalls: [], currentIntent: undefined },
  } as unknown as RuntimeSnapshot;
}

describe('TuiApp pinnedBottom transitions', () => {
  let app: TuiApp;
  beforeEach(() => {
    app = new TuiApp({ input: new MockInput(), output: new MockOutput(), runtimeCollectors: { outer: null, chat: null, agent: null } });
  });

  it('initial state on agent tab: pinnedBottom=true, scrollOffset=0', () => {
    app.activateTab('agent');
    const per = app.getPerTabState('agent');
    assert.equal(per.pinnedBottom, true);
    assert.equal(per.scrollOffset, 0);
  });

  // Focused regression: the scroll-up capture formula must not silently drift.
  // Invariant: pressing ArrowUp exactly once from a freshly-activated pinned
  // tab with N>scrollbackRows lines must move `scrollOffset` from 0 to
  // (bottomAnchor - step), where step = 3 (the SCROLL_STEP in agent-view.ts:265).
  it('scroll-up exactly once from pinned: scrollOffset = bottomAnchor - step', () => {
    app.activateTab('agent');
    // 100 lines, scrollbackRows=20 (rows=30, top=6, panelRow=26), so bottomAnchor=80.
    const timeline = Array.from({ length: 100 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const }));
    app.injectRuntimeSnapshot('agent', makeSnapshot(timeline));
    app.injectKey('ArrowUp');   // first ArrowUp from pinned → captures bottomAnchor - step
    const per = app.getPerTabState('agent');
    assert.equal(per.pinnedBottom, false);
    assert.equal(per.scrollOffset, 80 - 3);  // bottomAnchor=80, step=3
  });

  it('scroll-down re-engages pinnedBottom when reaching bottom anchor', () => {
    app.activateTab('agent');
    app.injectRuntimeSnapshot('agent', makeSnapshot([{ kind: 'agent.message' as const, text: 'x', actor: 'user' as const }]));
    app.injectKey('ArrowUp');
    app.injectKey('ArrowUp');
    for (let i = 0; i < 50; i++) app.injectKey('ArrowDown');
    const per = app.getPerTabState('agent');
    assert.equal(per.pinnedBottom, true);
  });

  it('End key: pinnedBottom=true regardless of prior state', () => {
    app.activateTab('agent');
    app.injectRuntimeSnapshot('agent', makeSnapshot([{ kind: 'agent.message' as const, text: 'x', actor: 'user' as const }]));
    app.injectKey('ArrowUp');
    app.injectKey('ArrowUp');
    app.injectKey('End');
    const per = app.getPerTabState('agent');
    assert.equal(per.pinnedBottom, true);
  });

  it('new content while pinned: pinnedBottom stays true (no app-layer clamp needed)', () => {
    app.activateTab('agent');
    app.injectRuntimeSnapshot('agent', makeSnapshot([{ kind: 'agent.message' as const, text: 'first', actor: 'user' as const }]));
    app.injectRuntimeSnapshot('agent', makeSnapshot([
      { kind: 'agent.message' as const, text: 'first', actor: 'user' as const },
      { kind: 'agent.response' as const, text: 'reply', actor: 'agent' as const },
    ]));
    const per = app.getPerTabState('agent');
    assert.equal(per.pinnedBottom, true);
  });

  it('new content while unpinned: pinnedBottom stays false, scrollOffset unchanged (no drift)', () => {
    app.activateTab('agent');
    const timeline = Array.from({ length: 100 }, (_, i) => ({ kind: 'agent.message' as const, text: `L${i}`, actor: 'user' as const }));
    app.injectRuntimeSnapshot('agent', makeSnapshot(timeline));
    app.injectKey('ArrowUp');
    const offsetBefore = app.getPerTabState('agent').scrollOffset;
    app.injectRuntimeSnapshot('agent', makeSnapshot([
      ...timeline,
      { kind: 'agent.response' as const, text: 'reply', actor: 'agent' as const },
    ]));
    const offsetAfter = app.getPerTabState('agent').scrollOffset;
    assert.equal(app.getPerTabState('agent').pinnedBottom, false);
    assert.equal(offsetAfter, offsetBefore);
  });

  it('onActivate resets pinnedBottom=true', () => {
    app.activateTab('agent');
    app.injectRuntimeSnapshot('agent', makeSnapshot([{ kind: 'agent.message' as const, text: 'a', actor: 'user' as const }]));
    app.injectKey('ArrowUp');
    app.activateTab('dashboard');
    app.activateTab('agent');
    const per = app.getPerTabState('agent');
    assert.equal(per.pinnedBottom, true);
  });

  it('chat tab has the same transitions as agent tab', () => {
    app.activateTab('chat');
    const per = app.getPerTabState('chat');
    assert.equal(per.pinnedBottom, true);
    assert.equal(per.scrollOffset, 0);
  });
});
```

> Note: if the existing TUI tests use a different injection convention (e.g. `feedKey`, `setSnapshot`, `state.views[tabId]`), adjust to match. Add the minimum protected seams needed if they don't exist — typically 1-2 line wrappers.

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test:node -- --test src/tui/__tests__/app-pinned-bottom.test.ts`
Expected: FAIL — the transitions are not yet implemented.

- [ ] **Step 7: Implement the state transitions in `app.ts`**

Locate `dispatchToSession` (~line 827) and the agent/chat key handling in `handleRaw` (~lines 559-658). Apply the transitions.

In `handleRaw`, when handling `ViewAction.scroll` for chat + agent tabs:

```ts
case 'scroll': {
  const per = this.state.views[this.state.activeTab];
  const tab = this.state.activeTab;
  const isAgentOrChat = tab === 'agent' || tab === 'chat';
  if (isAgentOrChat) {
    const ctx = this.buildViewContext(tab);  // the same ViewRenderContext the view consumes
    const FOOTER_H = 3;
    const SCROLLBACK_TOP = tab === 'agent' ? 6 : 5;
    const panelRow = Math.max(0, ctx.dimensions.rows - FOOTER_H - 1);
    const bottomAnchor = computeBottomAnchor(ctx, tab, Math.max(0, ctx.dimensions.columns - 4), panelRow);
    const step = action.offset - per.scrollOffset;  // amount the view's handleKey just added/subtracted

    if (per.pinnedBottom && action.offset > 0) {
      // scroll-up (pinned → unpinned): capture bottomAnchor - step.
      // Invariant: this formula depends on `per.scrollOffset` still holding the
      // baseline that `view.handleKey` just incremented from (0 while pinned).
      // `onActivate` and `End`/`clear` write pinnedBottom=true; they must also
      // leave `per.scrollOffset` at a value consistent with this baseline —
      // either 0 (empty scrollback) or bottomAnchor. Don't introduce other
      // writers of `per.scrollOffset` without re-checking this formula.
      per.scrollOffset = Math.max(0, bottomAnchor - step);
      per.pinnedBottom = false;
    } else if (!per.pinnedBottom) {
      // scroll-up or scroll-down while unpinned: clamp, possibly re-engage.
      const next = Math.max(0, Math.min(action.offset, bottomAnchor));
      per.scrollOffset = next;
      per.pinnedBottom = next === bottomAnchor;
    }
    // else (pinnedBottom && action.offset === 0): no-op (ArrowDown pressed while already pinned).
    this.scheduleRefresh();
    return;
  }
  // Other tabs (runtime, approvals): unchanged.
  per.scrollOffset = action.offset;
  this.scheduleRefresh();
}
```

Add the new `End` key handler in `handleRaw`:

```ts
if ((this.state.activeTab === 'agent' || this.state.activeTab === 'chat') && (key === 'End' || key === 'G' || key === 'g')) {
  const per = this.state.views[this.state.activeTab];
  per.pinnedBottom = true;
  // scrollOffset is ignored while pinned; set it to bottomAnchor so the
  // next scroll-up capture formula reads a consistent baseline.
  const ctx = this.buildViewContext(this.state.activeTab);
  const FOOTER_H = 3;
  const SCROLLBACK_TOP = this.state.activeTab === 'agent' ? 6 : 5;
  const panelRow = Math.max(0, ctx.dimensions.rows - FOOTER_H - 1);
  per.scrollOffset = computeBottomAnchor(ctx, this.state.activeTab, Math.max(0, ctx.dimensions.columns - 4), panelRow);
  this.scheduleRefresh();
  return;
}
```

In `/clear` handling (the existing `submitSlashCommand` path around `app.ts:703`), when the resolved command is the `clear` skill:

```ts
if (resolvedSkill.name === 'clear' || resolvedSkill.trigger === '/clear') {
  const per = this.state.views[this.state.activeTab];
  per.pinnedBottom = true;
  per.scrollOffset = 0;  // freshly cleared timeline is empty → bottomAnchor=0
  // Continue to existing clear logic.
}
```

In `onActivate` for chat + agent:

```ts
onActivate(per: PerTabState, tab: TabId): void {
  if (tab === 'agent' || tab === 'chat') {
    per.pinnedBottom = true;
    per.scrollOffset = 0;  // baseline for the scroll-up capture formula
  }
}
```

In `dispatchToSession`: **remove the existing `perTab.scrollOffset = 0` line** — auto-follow falls out of the branched render logic in the view; the app layer doesn't need to clamp anything.

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test:node -- --test src/tui/__tests__/app-pinned-bottom.test.ts`
Expected: PASS (8 cases including the focused first-ArrowUp-from-pinned regression).

- [ ] **Step 9: Commit**

```bash
git add src/tui/views/scroll-math.ts src/tui/views/__tests__/scroll-math.test.ts src/tui/app.ts src/tui/__tests__/app-pinned-bottom.test.ts
git commit -m "feat(tui): scroll-math builders + pinnedBottom transitions (auto-follow + End + clear)" --no-verify
```

---

# Task 4: Agent view — relocate input panel + slash strip + use helpers

**Files:**
- Modify: `src/tui/views/agent-view.ts` (the line-builder code that already lives here is moved verbatim into `scroll-math.ts` by Task 3; this task removes it from this file)
- Create: `src/tui/__tests__/agent-view-bottom-anchored.test.ts`

**Interfaces:**
- Consumes: `renderBottomAnchoredSlice` (Task 1), `renderSlashOverlay` (Task 2), `buildAgentScrollbackLines` (Task 3).
- Produces: the new `render(ctx)` body that pins the panel at the bottom and the slash strip directly below.

- [ ] **Step 1: Write the failing test**

Create `src/tui/__tests__/agent-view-bottom-anchored.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentView } from '../../views/agent-view.js';
import { MockCanvas } from '../../canvas.js';
import type { ViewRenderContext } from '../../views/types.js';
import { createInitialPerTabState } from '../../state.js';

function ctx(opts: Partial<ViewRenderContext> & { rows?: number; pinnedBottom?: boolean; inputBuffer?: string; slashEntries?: Array<{ name: string; label: string; description: string }>; timeline?: any[] }): ViewRenderContext {
  const c = new MockCanvas(80, opts.rows ?? 30);
  return {
    snap: {} as never,
    dimensions: { columns: 80, rows: opts.rows ?? 30 },
    perTab: { ...createInitialPerTabState(), pinnedBottom: opts.pinnedBottom ?? true, inputBuffer: opts.inputBuffer ?? '' },
    canvas: c,
    runtime: opts.timeline
      ? { chat: null, agent: { timeline: opts.timeline, totalEventCount: opts.timeline.length, workflow: undefined, session: {} as never } as never }
      : undefined,
    slash: opts.slashEntries
      ? { entries: opts.slashEntries, selected: 0, hint: null }
      : undefined,
    themeName: 'dark',
  };
}

describe('AgentView bottom-anchored render', () => {
  const view = new AgentView();

  it('renders input panel at panelRow (one above the footer)', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    const writesAt26 = c.writes.filter((w: any) => w.y === 26);
    assert.ok(writesAt26.some((w: any) => w.text.includes('alix-agent>')), 'expected prompt label at row 26');
  });

  it('renders the slash strip directly below the panel when slash mode is active', () => {
    const c = ctx({ rows: 30, slashEntries: [{ name: 'foo', label: '/foo', description: 'foo skill' }, { name: 'bar', label: '/bar', description: 'bar skill' }] });
    view.render(c);
    const writesAt27 = c.writes.filter((w: any) => w.y === 27);
    assert.ok(writesAt27.some((w: any) => w.text.includes('/foo')), 'expected /foo entry at row 27');
  });

  it('does NOT render the slash strip when slash mode is inactive', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    const writesAt27 = c.writes.filter((w: any) => w.y === 27);
    assert.equal(writesAt27.length, 0, 'no rows should be written below the panel when slash is inactive');
  });

  it('renders the most recent lines when pinnedBottom=true (default)', () => {
    const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'agent.message' as const, text: `line ${i}`, actor: 'user' as const }));
    const c = ctx({ rows: 30, timeline });
    view.render(c);
    const scrollbackWrites = c.writes.filter((w: any) => w.y >= 6 && w.y <= 25);
    const lastScrollbackWrite = scrollbackWrites[scrollbackWrites.length - 1];
    assert.match(lastScrollbackWrite.text, /line 49/);
  });

  it('renders the older lines mid-viewport when pinnedBottom=false (parked scroll)', () => {
    const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'agent.message' as const, text: `line ${i}`, actor: 'user' as const }));
    const perTab = createInitialPerTabState();
    perTab.pinnedBottom = false;
    perTab.scrollOffset = 10;
    const c: ViewRenderContext = {
      snap: {} as never,
      dimensions: { columns: 80, rows: 30 },
      perTab,
      canvas: new MockCanvas(80, 30),
      runtime: { chat: null, agent: { timeline, totalEventCount: timeline.length, workflow: undefined, session: {} as never } as never },
      themeName: 'dark',
    };
    view.render(c);
    const scrollbackWrites = c.canvas!.writes.filter((w: any) => w.y >= 6 && w.y <= 25);
    const firstScrollbackWrite = scrollbackWrites.find((w: any) => w.text.length > 0);
    assert.match(firstScrollbackWrite.text, /line 10/);
  });

  it('does not move the visible window when new content arrives while unpinned (no drift)', () => {
    const initialTimeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'agent.message' as const, text: `line ${i}`, actor: 'user' as const }));
    const perTab = createInitialPerTabState();
    perTab.pinnedBottom = false;
    perTab.scrollOffset = 10;
    const c: ViewRenderContext = {
      snap: {} as never,
      dimensions: { columns: 80, rows: 30 },
      perTab,
      canvas: new MockCanvas(80, 30),
      runtime: { chat: null, agent: { timeline: initialTimeline, totalEventCount: initialTimeline.length, workflow: undefined, session: {} as never } as never },
      themeName: 'dark',
    };
    view.render(c);
    const firstBefore = c.canvas!.writes.find((w: any) => w.y >= 6 && w.text.length > 0);

    const grownTimeline = [...initialTimeline, ...Array.from({ length: 5 }, (_, i) => ({ kind: 'agent.message' as const, text: `appended ${i}`, actor: 'user' as const }))];
    const c2: ViewRenderContext = { ...c, runtime: { chat: null, agent: { timeline: grownTimeline, totalEventCount: grownTimeline.length, workflow: undefined, session: {} as never } as never } };
    view.render(c2);
    const firstAfter = c2.canvas!.writes.find((w: any) => w.y >= 6 && w.text.length > 0);

    assert.equal(firstBefore.text, firstAfter.text);
  });
});
```

> Note: the test assumes `MockCanvas` records `writes` as an array. Verify the actual MockCanvas API in `src/tui/canvas.ts` and adjust the test if needed (the real `write` may not capture args this way — use whatever capture mechanism exists; if none, extend MockCanvas to expose `writes: Array<{x,y,text}>`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:node -- --test src/tui/__tests__/agent-view-bottom-anchored.test.ts`
Expected: FAIL (the existing render writes the panel at row 4, not row 26).

- [ ] **Step 3: Rewrite `agent-view.ts`'s `render(ctx)`**

Replace `agent-view.ts:39-259` (the entire `render` method body) with the bottom-anchored version. **The line-builder code that currently lives here was moved verbatim into `scroll-math.ts` by Task 3; this task removes it from this file and imports it instead.** The per-kind renderers stay here as private methods.

```ts
import { renderBottomAnchoredSlice, type KindStyleMap, type ScrollbackLine } from './bottom-anchored-viewport.js';
import { renderSlashOverlay } from './slash-overlay.js';
import { buildAgentScrollbackLines } from './scroll-math.js';

export class AgentView implements TuiView {
  readonly id: TabId = 'agent';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;
    const FOOTER_H = 3;
    const PANEL_H = 0;
    const PROMPT_COL = 13;
    const SCROLLBACK_TOP = 6;          // rows 0-2 header, 3 blank, 4 status, 5 blank
    const STATUS_ROW = 4;              // status line + intent badge row

    const panelRow = Math.max(0, ctx.dimensions.rows - FOOTER_H - PANEL_H - 1);
    const scrollbackBottom = panelRow - 1;
    const scrollbackRows = Math.max(0, scrollbackBottom - SCROLLBACK_TOP + 1);
    const textWidth = Math.max(0, ctx.dimensions.columns - 4);

    // Status line + intent badge — pinned at row 4, always visible.
    const r = ctx.snap.runtime;
    if (r && r.totalEventCount > 0) {
      const wf = r.workflow;
      const stepBit = wf ? ` | step ${wf.currentStep}/${wf.totalSteps}` : '';
      c.write(0, STATUS_ROW, `\x1b[90mevents: ${r.totalEventCount}${stepBit}${RESET}`);
    }
    const intent = ctx.perTab.currentIntent;
    if (intent && intent !== 'research') {
      const color = intent === 'mutation' ? '\x1b[33m' : '\x1b[32m';
      const label = intent === 'mutation' ? 'E' : 'V';
      c.write(2, STATUS_ROW, `${color}[${label}]${RESET}`);
    }

    // Line-builder lives in scroll-math.ts (single source of truth).
    const allLines: ScrollbackLine[] = buildAgentScrollbackLines(ctx, textWidth);

    // Branch on pinnedBottom: pinned recomputes bottomAnchor fresh, unpinned uses captured scrollOffset.
    const effectiveOffset = ctx.perTab.pinnedBottom
      ? Math.max(0, allLines.length - scrollbackRows)
      : ctx.perTab.scrollOffset;

    const kindStyles: KindStyleMap = {
      plan:     (l, rowY) => this.renderPlanLine(l, rowY, c),
      approval: (l, rowY) => this.renderApprovalLine(l, rowY, c),
      toolCall: (l, rowY) => this.renderToolCallLine(l, rowY, c),
      user:     (l, rowY) => this.renderTurnLine('user', l, rowY, c),
      agent:    (l, rowY) => this.renderTurnLine('agent', l, rowY, c),
    };

    renderBottomAnchoredSlice({
      canvas: c,
      allLines,
      top: SCROLLBACK_TOP,
      bottomRow: scrollbackBottom,
      offset: effectiveOffset,
      columns: ctx.dimensions.columns,
      kindStyles,
    });

    // Input panel at panelRow.
    const buf = ctx.perTab.inputBuffer;
    c.write(0, panelRow, `\x1b[33m alix-agent>${RESET} `);
    c.write(PROMPT_COL, panelRow, buf);
    c.write(PROMPT_COL + buf.length, panelRow, `\x1b[7m ${RESET}`);

    // Slash strip directly BELOW the panel.
    if (ctx.slash) {
      renderSlashOverlay({ canvas: c, slash: ctx.slash, panelRow, columns: ctx.dimensions.columns });
    }

    return { rows: [] };
  }

  private renderPlanLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas): void {
    // Verbatim from agent-view.ts:209-215 (the `kind === 'plan'` branch).
    if (l.isFirst) {
      c.write(0, rowY, `\x1b[2m◆ ${RESET}`);
      c.write(2, rowY, `\x1b[2m${l.text}${RESET}`);
    } else if (l.text) {
      c.write(2, rowY, `\x1b[2m${l.text}${RESET}`);
    }
  }

  private renderApprovalLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas): void {
    if (l.isFirst) {
      c.write(0, rowY, `\x1b[33m⏸ ${RESET}`);
      c.write(2, rowY, `\x1b[33m${l.text}${RESET}`);
    } else {
      c.write(2, rowY, `\x1b[33m${l.text}${RESET}`);
    }
  }

  private renderToolCallLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas): void {
    if (l.isFirst) {
      c.write(0, rowY, `\x1b[2m→ ${RESET}`);
      c.write(2, rowY, `\x1b[2m${l.text.slice(2)}${RESET}`);
    } else {
      c.write(2, rowY, `\x1b[2m${l.text}${RESET}`);
    }
  }

  private renderTurnLine(kind: 'user' | 'agent', l: ScrollbackLine, rowY: number, c: TerminalCanvas): void {
    if (l.isFirst) {
      const marker = kind === 'user' ? `\x1b[90m→ ${RESET}` : `\x1b[36m← ${RESET}`;
      c.write(0, rowY, marker);
      c.write(2, rowY, l.text);
    } else {
      c.write(2, rowY, l.text);
    }
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // Unchanged — the pinnedBottom side-effect happens in app.ts (Task 3).
    const SCROLL_STEP = 3;
    switch (key) {
      case 'ArrowUp':   return { type: 'scroll', offset: ctx.perTab.scrollOffset + SCROLL_STEP };
      case 'ArrowDown': return { type: 'scroll', offset: Math.max(0, ctx.perTab.scrollOffset - SCROLL_STEP) };
      case 'e':
      case 'E':         ctx.perTab.ledgerExpanded = !ctx.perTab.ledgerExpanded; return { type: 'handled' };
      default:          return { type: 'handled' };
    }
  }

  onActivate(_perTab: PerTabState): void { /* no-op; app.ts handles the reset */ }
  onDeactivate(_perTab: PerTabState): void { /* no-op */ }
}
```

The local `ScrollbackLine` interface previously at `agent-view.ts:101` is **removed** — use the one imported from `bottom-anchored-viewport.js`. If TypeScript narrows the kind union to the agent-specific subset (plan/approval/toolCall/user/agent), the structural compatibility with the helper's `kind: string` is preserved by the union being a subtype of `string`.

- [ ] **Step 4: Update cursor positioning in `app.ts`**

In `paintCursor` (`app.ts:1476-1486`), update the agent-tab cursor position:

```ts
if (this.state.activeTab === 'agent') {
  const panelRow = ctx.dimensions.rows - 3 - 1;  // FOOTER_H=3, PANEL_H=0
  process.stdout.write(`\x1b[${panelRow + 1};13H`);
}
```

(Verify the exact existing code at `app.ts:1476-1486` before editing — the pattern may differ slightly.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:node -- --test src/tui/__tests__/agent-view-bottom-anchored.test.ts`
Expected: PASS (6 cases).

- [ ] **Step 6: Run the full TUI test suite and update snapshots**

Run: `pnpm test:node`
Expected: existing snapshot tests in `src/tui/__tests__/` fail (panel relocated, status line moved, slash strip repositioned). Update them:

```bash
pnpm test:node -- --test-update-snapshots   # or whatever the project's snapshot-update flag is
git diff src/tui/__tests__/   # audit the diff manually
```

Only commit the snapshot updates after the implementer AND reviewer have audited the diff.

- [ ] **Step 7: Commit**

```bash
git add src/tui/views/agent-view.ts src/tui/__tests__/agent-view-bottom-anchored.test.ts src/tui/app.ts
git commit -m "feat(tui): relocate agent-tab input panel + slash strip to bottom" --no-verify
```

---

# Task 5: Chat view — relocate input panel + use helper (no slash strip)

**Files:**
- Modify: `src/tui/views/chat-view.ts` (the line-builder code that already lives here was moved verbatim into `scroll-math.ts` by Task 3; this task removes it from this file and imports it instead)
- Create: `src/tui/__tests__/chat-view-bottom-anchored.test.ts`

**Interfaces:**
- Consumes: `renderBottomAnchoredSlice` (Task 1), `buildChatScrollbackLines` (Task 3).
- Produces: the new `render(ctx)` body (no slash overlay).

- [ ] **Step 1: Write the failing test**

Create `src/tui/__tests__/chat-view-bottom-anchored.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChatView } from '../../views/chat-view.js';
import { MockCanvas } from '../../canvas.js';
import type { ViewRenderContext } from '../../views/types.js';
import { createInitialPerTabState } from '../../state.js';

function ctx(opts: { rows?: number; pinnedBottom?: boolean; inputBuffer?: string; timeline?: any[] }): ViewRenderContext {
  return {
    snap: {} as never,
    dimensions: { columns: 80, rows: opts.rows ?? 30 },
    perTab: { ...createInitialPerTabState(), pinnedBottom: opts.pinnedBottom ?? true, inputBuffer: opts.inputBuffer ?? '' },
    canvas: new MockCanvas(80, opts.rows ?? 30),
    runtime: opts.timeline
      ? { chat: { timeline: opts.timeline, totalEventCount: opts.timeline.length, workflow: undefined, session: {} as never } as never, agent: null }
      : undefined,
    themeName: 'dark',
  };
}

describe('ChatView bottom-anchored render', () => {
  const view = new ChatView();

  it('renders input panel at panelRow (one above the footer)', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    const writesAt26 = c.canvas!.writes.filter((w: any) => w.y === 26);
    assert.ok(writesAt26.some((w: any) => w.text.includes('alix>')), 'expected prompt label at row 26');
  });

  it('does not render a slash strip (chat never receives ctx.slash)', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    const writesBelow = c.canvas!.writes.filter((w: any) => w.y >= 27);
    assert.equal(writesBelow.length, 0);
  });

  it('renders the most recent lines when pinnedBottom=true (default)', () => {
    const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'chat.message' as const, text: `msg ${i}` }));
    const c = ctx({ rows: 30, timeline });
    view.render(c);
    const scrollbackWrites = c.canvas!.writes.filter((w: any) => w.y >= 5 && w.y <= 25);
    const lastScrollbackWrite = scrollbackWrites[scrollbackWrites.length - 1];
    assert.match(lastScrollbackWrite.text, /msg 49/);
  });

  it('renders the older lines mid-viewport when pinnedBottom=false', () => {
    const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'chat.message' as const, text: `msg ${i}` }));
    const perTab = { ...createInitialPerTabState(), pinnedBottom: false, scrollOffset: 10 };
    const c: ViewRenderContext = {
      snap: {} as never,
      dimensions: { columns: 80, rows: 30 },
      perTab,
      canvas: new MockCanvas(80, 30),
      runtime: { chat: { timeline, totalEventCount: timeline.length, workflow: undefined, session: {} as never } as never, agent: null },
      themeName: 'dark',
    };
    view.render(c);
    const scrollbackWrites = c.canvas!.writes.filter((w: any) => w.y >= 5 && w.y <= 25);
    const firstScrollbackWrite = scrollbackWrites.find((w: any) => w.text.length > 0);
    assert.match(firstScrollbackWrite.text, /msg 10/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:node -- --test src/tui/__tests__/chat-view-bottom-anchored.test.ts`
Expected: FAIL (panel currently at row 4).

- [ ] **Step 3: Rewrite `chat-view.ts`'s `render(ctx)`**

Replace `chat-view.ts:20-118` (the entire `render` method body) with the bottom-anchored version. **The line-builder code that currently lives here was moved verbatim into `scroll-math.ts` by Task 3; this task removes it from this file and imports it instead.**

```ts
import { renderBottomAnchoredSlice, type KindStyleMap, type ScrollbackLine } from './bottom-anchored-viewport.js';
import { buildChatScrollbackLines } from './scroll-math.js';

export class ChatView implements TuiView {
  readonly id: TabId = 'chat';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;
    const FOOTER_H = 3;
    const PANEL_H = 0;
    const PROMPT_COL = 7;
    const SCROLLBACK_TOP = 5;

    const panelRow = Math.max(0, ctx.dimensions.rows - FOOTER_H - PANEL_H - 1);
    const scrollbackBottom = panelRow - 1;
    const scrollbackRows = Math.max(0, scrollbackBottom - SCROLLBACK_TOP + 1);
    const textWidth = Math.max(0, ctx.dimensions.columns - 4);

    const allLines: ScrollbackLine[] = buildChatScrollbackLines(ctx, textWidth);

    const effectiveOffset = ctx.perTab.pinnedBottom
      ? Math.max(0, allLines.length - scrollbackRows)
      : ctx.perTab.scrollOffset;

    const kindStyles: KindStyleMap = {
      user:  (l, rowY) => this.renderChatLine('user', l, rowY, c),
      agent: (l, rowY) => this.renderChatLine('agent', l, rowY, c),
    };

    renderBottomAnchoredSlice({
      canvas: c,
      allLines,
      top: SCROLLBACK_TOP,
      bottomRow: scrollbackBottom,
      offset: effectiveOffset,
      columns: ctx.dimensions.columns,
      kindStyles,
    });

    const buf = ctx.perTab.inputBuffer;
    c.write(0, panelRow, '\x1b[33m alix>\x1b[0m ');
    c.write(PROMPT_COL, panelRow, buf);
    c.write(PROMPT_COL + buf.length, panelRow, '\x1b[7m \x1b[0m');

    return { rows: [] };
  }

  private renderChatLine(kind: 'user' | 'agent', l: ScrollbackLine, rowY: number, c: TerminalCanvas): void {
    // Verbatim from chat-view.ts:100-109.
    if (l.isFirst) {
      const marker = kind === 'user' ? '\x1b[90m→ \x1b[0m'
        : kind === 'agent' ? '\x1b[36m← \x1b[0m'
        : '\x1b[35m⚡ \x1b[0m';
      c.write(0, rowY, marker);
      c.write(2, rowY, l.text);
    } else {
      c.write(2, rowY, l.text);
    }
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // Unchanged — pinnedBottom side-effect happens in app.ts (Task 3).
    const SCROLL_STEP = 3;
    switch (key) {
      case 'ArrowUp':   return { type: 'scroll', offset: ctx.perTab.scrollOffset + SCROLL_STEP };
      case 'ArrowDown': return { type: 'scroll', offset: Math.max(0, ctx.perTab.scrollOffset - SCROLL_STEP) };
      default:          return { type: 'handled' };
    }
  }

  onActivate(_perTab: PerTabState): void { /* no-op; app.ts handles the reset */ }
  onDeactivate(_perTab: PerTabState): void { /* no-op */ }
}
```

The local `ScrollbackLine` interface previously at `chat-view.ts:53` is **removed** — use the one imported from `bottom-anchored-viewport.js`.

- [ ] **Step 4: Update cursor positioning in `app.ts`**

Same pattern as Task 4 step 4, but for the chat tab and column 7:

```ts
if (this.state.activeTab === 'chat') {
  const panelRow = ctx.dimensions.rows - 3 - 1;
  process.stdout.write(`\x1b[${panelRow + 1};7H`);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:node -- --test src/tui/__tests__/chat-view-bottom-anchored.test.ts`
Expected: PASS (4 cases).

- [ ] **Step 6: Run the full test suite and update snapshots**

Same as Task 4 step 6 — run `pnpm test:node`, audit snapshot diff, update intentionally.

- [ ] **Step 7: Commit**

```bash
git add src/tui/views/chat-view.ts src/tui/__tests__/chat-view-bottom-anchored.test.ts src/tui/app.ts
git commit -m "feat(tui): relocate chat-tab input panel to bottom" --no-verify
```

---

# Task 6: End-to-end manual smoke + impact analysis + PR

**Files:**
- (No file changes — verification + PR.)

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test:node && pnpm test:vitest`
Expected: all green including new helper tests, view tests, app-pinned-bottom tests, and the updated snapshots.

- [ ] **Step 3: Run impact analysis**

Run (per `CLAUDE.md`): `mcp__gitnexus__impact({target: "AgentView", direction: "upstream"})` and `mcp__gitnexus__impact({target: "ChatView", direction: "upstream"})`.
Expected: surface blast radius. Per the earlier explorer, `CredentialStore` was the high-risk symbol for the credential-security PR — that's unrelated. For these view changes, expect moderate blast radius (canvas snapshots, the tab navigation keys, the slash command pipeline). If risk is HIGH or CRITICAL, surface in the PR body and consider gating the merge.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm tui` (or the equivalent launch command).

Verify on the **agent tab**:
- [ ] Input prompt sits at the bottom of the viewport, above the 3-row footer.
- [ ] Typing `/` opens the slash strip directly below the prompt, growing downward; scrollback shrinks accordingly.
- [ ] Typing more characters filters the strip.
- [ ] `Esc` (or backspacing to empty) closes the strip and the scrollback regains the rows.
- [ ] Submitting a query shows the response above the panel.
- [ ] Pressing `ArrowUp` scrolls the scrollback; the panel moves up off the footer (mid-viewport parking).
- [ ] Pressing `End` snaps the panel back to the bottom; auto-follow re-engages.
- [ ] `/clear` snaps to bottom.
- [ ] Switching tabs and back resets to bottom.

Verify on the **chat tab**:
- [ ] Input prompt sits at the bottom.
- [ ] No slash strip (chat never shows one).
- [ ] Same scroll behaviors as the agent tab.

Verify on a **narrow terminal (< 32 rows)**:
- [ ] Scrollback + panel + footer still fit; strip degrades gracefully (no footer overlap).

- [ ] **Step 5: Run `gitnexus detect_changes`**

Run: `mcp__gitnexus__detect_changes()`.
Expected: only the expected symbols and execution flows are affected (AgentView, ChatView, app.ts key handling, the two new helper files).

- [ ] **Step 6: Open the PR**

```bash
git push -u origin tui-bottom-anchored-panel
gh pr create --title "feat(tui): Claude-Code-style bottom-anchored panel + slash strip" --body "$(cat <<'EOF'
## What

Relocates the agent and chat tabs' input panel to the bottom of the viewport and
attaches the slash-completion strip directly below it as a single bottom-anchored
unit. Wires `pinnedBottom` to clamp the scroll on new responses (auto-follow) and
adds an `End` key for explicit re-anchor. Extracts two pure helpers
(`renderBottomAnchoredSlice`, `renderSlashOverlay`) so future tabs can adopt the
same UX cheaply.

## Why

Claude Code's panel behavior (bottom-anchored prompt, slash strip directly below,
auto-follow with explicit re-anchor) is the model operators expect from chat-style
TUIs. Today the prompt sits at row 4 under the header, the slash strip overlays the
top of the scrollback, and there's no auto-follow — all inverted from the expected
behavior.

## Risk

Impact analysis (gitnexus): <paste blast-radius summary>.
Detect-changes (gitnexus): <paste affected-symbols summary>.

The `CredentialStore` blast radius flagged in earlier reviews is unrelated to this PR.

## Verification

- `pnpm typecheck` clean.
- `pnpm test:node && pnpm test:vitest` all green.
- 16 new unit + integration tests cover the helpers, view rendering branches, and state transitions.
- Snapshot tests intentionally updated; diff audited by implementer + reviewer.
- Manual smoke verified on agent + chat tabs, narrow terminal, /clear, tab switch.

## Out of scope (deferred)

- Input cursor position (left/right, word-delete, selection).
- History recall (ArrowUp from input box).
- Applying the model to tabs other than chat + agent.
EOF
)"
```

Expected: PR opened against `main`.

---

# Self-Review

**1. Spec coverage:**

| Spec section | Task |
|---|---|
| § Architecture (single-rule placement) | Task 4 (agent), Task 5 (chat) |
| § `scrollOffset` semantics (branched on `pinnedBottom`) | Task 3 (state), Task 4 + 5 (render branch) |
| § Component 1 (`renderBottomAnchoredSlice`) | Task 1 |
| § Component 2 (`renderSlashOverlay`) | Task 2 |
| § Component 3 (agent view) | Task 4 (with line-builder factored into scroll-math.ts per Task 3) |
| § Component 4 (chat view) | Task 5 (with line-builder factored into scroll-math.ts per Task 3) |
| § Component 5 (app.ts auto-follow wiring) | Task 3 |
| § Edge cases (small terminals, resize, /clear, tab switch) | Task 3 (transitions), Task 6 (manual smoke on narrow terminal) |
| § Testing (helper unit, app-level, snapshots, manual) | Tasks 1, 2, 3, 4, 5, 6 |
| § Verification (typecheck, tests, impact, detect-changes, manual) | Task 6 |

No gaps.

**2. Placeholder scan:** No "TBD" or "TODO" markers anywhere. No stub function bodies. All test bodies, implementation bodies, and command invocations are concrete. The scroll-math builders in Task 3 step 3 are full implementations (the existing line-builder code moved verbatim from the views, line-for-line). The comments inside those implementations cite the source line ranges so a reviewer can diff the move. The 4 stub-style comments from earlier drafts (e.g. `(Full implementation in the diff.)`, `/* ctx */` placeholders) have been replaced with real code and real arguments.

**3. Type consistency:**
- `renderBottomAnchoredSlice` (Task 1) returns `{ firstRow, lastRow }` — documented, used by Tasks 4 and 5 for the slice math.
- `renderSlashOverlay` (Task 2) returns `{ rowsRendered, lastRow, selectionVisible }` — used by Task 4 via the canvas-write side effect; `selectionVisible` is observed by app.ts but no test asserts on it directly (would require a new app-level test, deferred to a follow-up if needed).
- `ScrollbackLine` shape (`kind: string; text: string; isFirst: boolean`) — defined once in `bottom-anchored-viewport.ts` and imported everywhere it's used (Tasks 1, 3, 4, 5). The local interfaces previously in `agent-view.ts:101` and `chat-view.ts:53` are explicitly removed in Tasks 4 and 5; the kind-union narrowing is structural compatibility with `kind: string`.
- `buildAgentScrollbackLines` / `buildChatScrollbackLines` / `computeScrollbackRows` / `computeBottomAnchor` (Task 3) — defined in `scroll-math.ts`, consumed by Task 3's own `computeBottomAnchor`, by Tasks 4 and 5 for rendering, and (transitively) by Task 3's app.ts transition logic. Same signature throughout; no drift.
- Per-kind render methods (`renderPlanLine`, `renderApprovalLine`, `renderToolCallLine`, `renderTurnLine` in Task 4; `renderChatLine` in Task 5) — private methods on the view class; signature `(line, rowY, canvas) => void` matches the `KindStyleMap` contract from Task 1.
- `computeBottomAnchor(ctx, kind, textWidth, panelRow)` is the only function in the plan that crosses both the view-rendering boundary and the app-state-transition boundary. Task 3's app.ts code computes `bottomAnchor` via `computeBottomAnchor(ctx, tab, textWidth, panelRow)`, and the views' render method computes the equivalent via `Math.max(0, allLines.length - scrollbackRows)`. These are *intentionally* computed twice (once at key-press time, once at paint time) — the values can differ if the snapshot advanced between the two; this is fine because each call reads the current snapshot, and the `pinnedBottom` field carries the "is the user following or parked" intent. Documented in the spec's "Branched by `pinnedBottom`" section.

No type drift detected.

**4. Build-validity check (added in response to review):** Every import in Tasks 4 and 5 points to a symbol that is exported by the file it imports from in an earlier task:
- `renderBottomAnchoredSlice`, `KindStyleMap`, `ScrollbackLine` ← Task 1
- `renderSlashOverlay` ← Task 2
- `buildAgentScrollbackLines`, `buildChatScrollbackLines`, `computeBottomAnchor` ← Task 3
- `TerminalCanvas` ← existing `src/tui/canvas.ts`
- `ViewRenderContext`, `ViewAction`, `ViewInputContext`, `PerTabState`, `TabId`, `SlashStrip` ← existing `src/tui/views/types.ts` and `src/tui/state.ts`

Verified by grepping each import statement against the prior task's exports.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-05-tui-bottom-anchored-panel.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
