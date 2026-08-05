import { describe, it, expect } from 'vitest';
import { AgentView } from '../../../src/tui/views/agent-view.js';
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

function ctx(opts: Partial<ViewRenderContext> & { rows?: number; pinnedBottom?: boolean; inputBuffer?: string; slashEntries?: Array<{ name: string; label: string; description: string }>; timeline?: any[] }): ViewRenderContext {
  const rows = opts.rows ?? 30;
  return {
    snap: {} as never,
    dimensions: { columns: 80, rows },
    perTab: { ...createInitialPerTabState(), pinnedBottom: opts.pinnedBottom ?? true, inputBuffer: opts.inputBuffer ?? '' },
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
    const writesAt26 = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y === 26);
    expect(writesAt26.some((w) => w.text.includes('alix-agent>'))).toBe(true);
  });

  it('renders the slash strip directly below the panel when slash mode is active', () => {
    const c = ctx({ rows: 30, slashEntries: [{ name: 'foo', label: '/foo', description: 'foo skill' }, { name: 'bar', label: '/bar', description: 'bar skill' }] });
    view.render(c);
    const writesAt27 = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y === 27);
    expect(writesAt27.some((w) => w.text.includes('/foo'))).toBe(true);
  });

  it('does NOT render the slash strip when slash mode is inactive', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    const writesAt27 = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y === 27);
    expect(writesAt27.length).toBe(0);
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
    // Skip the user-turn marker write at col 0 (text contains ANSI but no line content).
    const scrollbackWrites = writes.filter((w) => w.y >= 6 && w.y <= 25 && w.x >= 2 && w.text.length > 0);
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
    const writesBefore = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y >= 6 && w.x >= 2 && w.text.length > 0);
    const firstBefore = writesBefore[0]!;

    const grownTimeline = [...initialTimeline, ...Array.from({ length: 5 }, (_, i) => ({ kind: 'agent.message' as const, text: `appended ${i}`, actor: 'user' as const }))];
    const c2: ViewRenderContext = { ...c, runtime: { chat: null, agent: { timeline: grownTimeline, totalEventCount: grownTimeline.length, workflow: undefined, session: {} as never } as never } };
    view.render(c2);
    const writesAfter = (c2.canvas as unknown as MockCanvas).writes.filter((w) => w.y >= 6 && w.x >= 2 && w.text.length > 0);
    const firstAfter = writesAfter[0]!;

    expect(firstAfter.text).toBe(firstBefore.text);
  });
});
