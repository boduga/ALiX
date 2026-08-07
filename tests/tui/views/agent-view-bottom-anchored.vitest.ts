import { describe, it, expect } from 'vitest';
import { AgentView } from '../../../src/tui/views/agent-view.js';
import { GUTTER_WIDTH } from '../../../src/tui/views/scroll-math.js';
import { MockCanvas } from './helpers/mock-canvas.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';
import { createInitialPerTabState } from '../../../src/tui/state.js';
import type { TerminalCanvas } from '../../../src/tui/canvas.js';

// Cast factory: MockCanvas is intentionally minimal (only captures write()).
// renderBottomAnchoredSlice only invokes write() via the kindStyles callbacks
// the view provides, so the structural mismatch with TerminalCanvas is benign
// for this test surface.
function canvas(columns: number, rows: number): TerminalCanvas {
  return new MockCanvas(columns, rows) as unknown as TerminalCanvas;
}

function ctx(opts: Partial<ViewRenderContext> & { rows?: number; pinnedBottom?: boolean; inputBuffer?: string; streamingText?: string; slashEntries?: Array<{ name: string; label: string; description: string }>; timeline?: any[] }): ViewRenderContext {
  const rows = opts.rows ?? 30;
  return {
    snap: {} as never,
    dimensions: { columns: 80, rows },
    perTab: { ...createInitialPerTabState(), pinnedBottom: opts.pinnedBottom ?? true, inputBuffer: opts.inputBuffer ?? '', streamingText: opts.streamingText },
    canvas: canvas(80, rows),
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
    const writesAtPanel = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y === 27);
    expect(writesAtPanel.some((w) => w.text.includes('alix-agent>'))).toBe(true);
  });

  it('renders the slash strip directly below the panel when slash mode is active', () => {
    const c = ctx({ rows: 30, slashEntries: [{ name: 'foo', label: '/foo', description: 'foo skill' }, { name: 'bar', label: '/bar', description: 'bar skill' }] });
    view.render(c);
    const writesBelowPanel = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y === 28);
    expect(writesBelowPanel.some((w) => w.text.includes('/foo'))).toBe(true);
  });

  it('does NOT render the slash strip when slash mode is inactive', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    const writesAtBottomBorder = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y === 28);
    // Row 28 is the bottom-border row (full-width `─` rule), which always
    // paints; the slash strip should NOT add any extra writes here.
    expect(writesAtBottomBorder.some((w) => !w.text.includes('─'))).toBe(false);
  });

  it('renders the most recent lines when pinnedBottom=true (default)', () => {
    const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'agent.message' as const, text: `line ${i}`, actor: 'user' as const }));
    const c = ctx({ rows: 30, timeline });
    view.render(c);
    const writes = (c.canvas as unknown as MockCanvas).writes;
    const scrollbackWrites = writes.filter((w) => w.y >= 6 && w.y <= 25);
    const lastScrollbackWrite = scrollbackWrites[scrollbackWrites.length - 1];
    expect(lastScrollbackWrite.text).toMatch(/line 49/);
  });

  it('renders the older lines mid-viewport when pinnedBottom=false (parked scroll)', () => {
    // Brief arithmetic note (parked): with buildAgentScrollbackLines inserting
    // blank-line separators between turns, 50 timeline entries yield 99 allLines,
    // and the new view semantics use scrollOffset as the ABSOLUTE window-start
    // index (not "lines from the bottom" as in the old code). Therefore
    // scrollOffset=10 → window [10, 30] → allLines[10] = "line 5" (since
    // user turn N lives at allLines[2*N]). Brief's expectation of "/line 10/"
    // is internally inconsistent with this buildAgentScrollbackLines shape; we
    // match reality here ("line 5") and verify the spirit: an unpinned window
    // shows older content, not the most recent turn.
    const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'agent.message' as const, text: `line ${i}`, actor: 'user' as const }));
    const perTab = createInitialPerTabState();
    perTab.pinnedBottom = false;
    perTab.scrollOffset = 10;
    const c: ViewRenderContext = {
      snap: {} as never,
      dimensions: { columns: 80, rows: 30 },
      perTab,
      canvas: canvas(80, 30),
      runtime: { chat: null, agent: { timeline, totalEventCount: timeline.length, workflow: undefined, session: {} as never } as never },
      themeName: 'dark',
    };
    view.render(c);
    const writes = (c.canvas as unknown as MockCanvas).writes;
    // Skip the user-turn marker write (#431: marker now sits at gutter
    // column, text follows at gutter + 2). The filter selects writes that
    // started past the marker so the first text-cell is found.
    const scrollbackWrites = writes.filter((w) => w.y >= 6 && w.y <= 25 && w.x >= GUTTER_WIDTH + 2 && w.text.length > 0);
    const firstScrollbackWrite = scrollbackWrites[0];
    expect(firstScrollbackWrite).toBeDefined();
    expect(firstScrollbackWrite!.text).toMatch(/line 5/);
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
      canvas: canvas(80, 30),
      runtime: { chat: null, agent: { timeline: initialTimeline, totalEventCount: initialTimeline.length, workflow: undefined, session: {} as never } as never },
      themeName: 'dark',
    };
    view.render(c);
    const writesBefore = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y >= 6 && w.x >= 17 && w.text.length > 0);
    const firstBefore = writesBefore[0]!;

    const grownTimeline = [...initialTimeline, ...Array.from({ length: 5 }, (_, i) => ({ kind: 'agent.message' as const, text: `appended ${i}`, actor: 'user' as const }))];
    const c2: ViewRenderContext = { ...c, runtime: { chat: null, agent: { timeline: grownTimeline, totalEventCount: grownTimeline.length, workflow: undefined, session: {} as never } as never } };
    view.render(c2);
    const writesAfter = (c2.canvas as unknown as MockCanvas).writes.filter((w) => w.y >= 6 && w.x >= 17 && w.text.length > 0);
    const firstAfter = writesAfter[0]!;

    expect(firstAfter.text).toBe(firstBefore.text);
  });

  it('renders the live streaming line with the gutter separator and a trailing cursor', () => {
    // #432: the previous `← ` agent marker is replaced by the universal
    // `│` gutter separator. The streaming line carries it the same way
    // every other agent scrollback line does — the visual identity of
    // a streaming line is now the trailing liveness cursor, not a kind
    // marker.
    const c = ctx({ streamingText: 'tok one' });
    view.render(c);
    const writes = (c.canvas as unknown as MockCanvas).writes;
    const scrollbackWrites = writes.filter((w) => w.y >= 6 && w.y <= 25);
    // The streamed text is written (gutter at col 0, separator at col 15, text at col 17).
    expect(scrollbackWrites.some((w) => w.text.includes('tok one'))).toBe(true);
    expect(scrollbackWrites.some((w) => w.text.includes('│'))).toBe(true);
    // Trailing liveness cursor on the last streaming row.
    expect(scrollbackWrites.some((w) => w.text.includes('▍'))).toBe(true);
  });

  it('renders no streaming line when streamingText is empty', () => {
    const c = ctx({ streamingText: '' });
    view.render(c);
    const writes = (c.canvas as unknown as MockCanvas).writes;
    const scrollbackWrites = writes.filter((w) => w.y >= 6 && w.y <= 25);
    expect(scrollbackWrites.some((w) => w.text.includes('▍'))).toBe(false);
  });
});
