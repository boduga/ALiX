import { describe, it, expect, vi } from 'vitest';
import { ChatView } from '../../../src/tui/views/chat-view.js';
import { MockCanvas } from './helpers/mock-canvas.js';
import type { ViewRenderContext } from '../../../src/tui/views/types.js';
import { createInitialPerTabState } from '../../../src/tui/state.js';
import type { TerminalCanvas } from '../../../src/tui/canvas.js';
import * as viewportModule from '../../../src/tui/views/bottom-anchored-viewport.js';
import type { ScrollbackLine } from '../../../src/tui/views/bottom-anchored-viewport.js';

/**
 * Bottom-anchored prompt row: one above the 5-row footer.
 * Mirrors the formula in `ChatView.render` (via `computeViewport`)
 * so the tests can assert the prompt's absolute position
 * regardless of canvas height.
 *
 * `panelRow = rows - BELOW_PROMPT_ROWS(3)` (see src/tui/views/scroll-math.ts)
 */
function panelRow(height: number): number {
  return Math.max(0, height - 3);
}

// Cast factory: MockCanvas is intentionally minimal (only captures write()).
// renderBottomAnchoredSlice only invokes write() via the kindStyles callbacks
// the view provides, so the structural mismatch with TerminalCanvas is benign
// for this test surface.
function canvas(columns: number, rows: number): TerminalCanvas {
  return new MockCanvas(columns, rows) as unknown as TerminalCanvas;
}

function ctx(opts: {
  rows?: number;
  pinnedBottom?: boolean;
  inputBuffer?: string;
  timeline?: any[];
  scrollOffset?: number;
}): ViewRenderContext {
  const rows = opts.rows ?? 30;
  const perTab = {
    ...createInitialPerTabState(),
    pinnedBottom: opts.pinnedBottom ?? true,
    inputBuffer: opts.inputBuffer ?? '',
  };
  if (opts.scrollOffset !== undefined) perTab.scrollOffset = opts.scrollOffset;
  return {
    snap: {} as never,
    dimensions: { columns: 80, rows },
    perTab,
    canvas: canvas(80, rows),
    runtime: opts.timeline
      ? { chat: { timeline: opts.timeline, totalEventCount: opts.timeline.length, workflow: undefined, session: {} as never } as never, agent: null }
      : undefined,
    themeName: 'dark',
  };
}

// scrollbackRows for a 30-row canvas: topBorderRow = 30 - 5 + 1 = 26, so
// scrollbackBottom = topBorderRow - 1 = 25, scrollbackRows = 25 - 5 + 1 = 21.
// Tests assert against this constant.
const SCROLLBACK_ROWS = 21;

describe('ChatView bottom-anchored render', () => {
  const view = new ChatView();

  it('renders input panel at panelRow (one above the footer)', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    const writesAtPanel = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y === panelRow(30));
    expect(writesAtPanel.some((w) => w.text.includes('alix>'))).toBe(true);
  });

  it('does NOT render a slash strip at panelRow+1 (chat tab has no slash strip)', () => {
    const c = ctx({ rows: 30 });
    view.render(c);
    // The bottom border now sits at panelRow+1 (= bottomBorderRow); only writes
    // containing slash-strip content (cyan \x1b[36m markers) would indicate a
    // slash strip leaking into chat. Anything else (e.g. the bottom border) is fine.
    const writesBelow = (c.canvas as unknown as MockCanvas).writes.filter((w) => w.y >= panelRow(30) + 1);
    const slashLikeWrites = writesBelow.filter((w) => /\x1b\[36m/.test(w.text));
    expect(slashLikeWrites.length).toBe(0);
  });

  it('passes the bottom-anchored window (most-recent lines) to renderBottomAnchoredSlice when pinnedBottom=true', () => {
    // Spy wraps renderBottomAnchoredSlice; default behavior still calls through
    // to the real implementation while recording arguments, so we can prove
    // both WHICH lines were selected AND the visible-window identity.
    const spy = vi.spyOn(viewportModule, 'renderBottomAnchoredSlice');
    try {
      const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'chat.message' as const, text: `msg ${i}` }));
      const c = ctx({ rows: 30, timeline });
      view.render(c);

      expect(spy).toHaveBeenCalledTimes(1);
      const opts = spy.mock.calls[0]![0]!;
      const allLines = opts.allLines as readonly ScrollbackLine[];
      const offset = opts.offset as number;

      // pinnedBottom=true → bottom anchor = max(0, allLines.length - scrollbackRows).
      // scrollbackRows = scrollbackBottom - scrollbackTop + 1
      // scrollbackBottom = topBorderRow - 1
      //                  = (rows - FOOTER_H + 1) - 1
      //                  = rows - FOOTER_H   (FOOTER_H = 5)
      // scrollbackTop   = SCROLLBACK_TOP_CHAT = 5
      // For rows=30:    scrollbackRows = (30 - 5) - 5 + 1 = 21
      // (Equivalently:  rows - FOOTER_H - SCROLLBACK_TOP_CHAT + 1 = 30 - 5 - 5 + 1 = 21)
      expect(offset).toBe(Math.max(0, allLines.length - SCROLLBACK_ROWS));

      // Selected slice spans [offset, offset+SCROLLBACK_ROWS). The last visible
      // line is the most-recent user message — proves the window is pinned to
      // the bottom of the scrollback line array.
      const lastSelectedLine = allLines[offset + SCROLLBACK_ROWS - 1]!;
      expect(lastSelectedLine).toEqual({ kind: 'user', text: 'msg 49', isFirst: true });

      // Sanity: the selected slice equals the expected tail-window exactly.
      const expectedSlice = allLines.slice(allLines.length - SCROLLBACK_ROWS);
      const actualSlice = allLines.slice(offset, offset + SCROLLBACK_ROWS);
      expect(actualSlice).toEqual(expectedSlice);
    } finally {
      spy.mockRestore();
    }
  });

  it('passes the parked-scroll window (older lines) to renderBottomAnchoredSlice when pinnedBottom=false', () => {
    // chat.message kind yields one line per turn (no wrapping here, since
    // "msg N" is short), but buildChatScrollbackLines inserts a blank-separator
    // line before every user turn after the first. So 50 timeline entries
    // produce 99 allLines, and user N lives at allLines[2*N]. With absolute
    // window-start semantics, scrollOffset=10 → window starts at allLines[10],
    // which is "msg 5" (the 5th user message, since allLines[0]="msg 0",
    // allLines[2]="msg 1", ..., allLines[2*N]="msg N").
    const spy = vi.spyOn(viewportModule, 'renderBottomAnchoredSlice');
    try {
      const timeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'chat.message' as const, text: `msg ${i}` }));
      const c = ctx({ rows: 30, timeline, pinnedBottom: false, scrollOffset: 10 });
      view.render(c);

      expect(spy).toHaveBeenCalledTimes(1);
      const opts = spy.mock.calls[0]![0]!;
      const allLines = opts.allLines as readonly ScrollbackLine[];
      const offset = opts.offset as number;

      // pinnedBottom=false → uses perTab.scrollOffset verbatim.
      expect(offset).toBe(10);

      // First selected line at the window start is "msg 5" — older content,
      // not the most-recent turn.
      const firstSelectedLine = allLines[offset]!;
      expect(firstSelectedLine).toEqual({ kind: 'user', text: 'msg 5', isFirst: true });

      // Last selected line at the end of the visible window is older than the
      // most-recent turn (msg 49), proving the parked window does NOT include
      // any of the last two messages.
      const lastSelectedLine = allLines[offset + SCROLLBACK_ROWS - 1]!;
      expect(lastSelectedLine.kind).toBe('user');
      expect(lastSelectedLine.text).not.toMatch(/^msg 4[89]$/);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not move the unpinned (parked) window when new content arrives while unpinned (no drift)', () => {
    // While pinnedBottom=false, scrollOffset is an absolute index into
    // allLines. New chat.message events appended to the timeline must NOT
    // shift the parked window — otherwise the user loses their place while
    // reading older content. We prove this by asserting the slice passed to
    // renderBottomAnchoredSlice is identical for the overlapping range before
    // and after timeline growth.
    const spy = vi.spyOn(viewportModule, 'renderBottomAnchoredSlice');
    try {
      const initialTimeline = Array.from({ length: 50 }, (_, i) => ({ kind: 'chat.message' as const, text: `msg ${i}` }));
      const perTab = { ...createInitialPerTabState(), pinnedBottom: false, scrollOffset: 10 };
      const baseCtx: ViewRenderContext = {
        snap: {} as never,
        dimensions: { columns: 80, rows: 30 },
        perTab,
        canvas: canvas(80, 30),
        runtime: { chat: { timeline: initialTimeline, totalEventCount: initialTimeline.length, workflow: undefined, session: {} as never } as never, agent: null },
        themeName: 'dark',
      };
      view.render(baseCtx);
      expect(spy).toHaveBeenCalledTimes(1);
      const optsBefore = spy.mock.calls[0]![0]!;
      const allLinesBefore = optsBefore.allLines as readonly ScrollbackLine[];
      const offsetBefore = optsBefore.offset as number;

      // Append 5 more chat.message events to the timeline. Because
      // pinnedBottom=false, the parked window must NOT move.
      const grownTimeline = [
        ...initialTimeline,
        ...Array.from({ length: 5 }, (_, i) => ({ kind: 'chat.message' as const, text: `appended ${i}` })),
      ];
      const c2: ViewRenderContext = {
        ...baseCtx,
        runtime: { chat: { timeline: grownTimeline, totalEventCount: grownTimeline.length, workflow: undefined, session: {} as never } as never, agent: null },
      };
      view.render(c2);
      expect(spy).toHaveBeenCalledTimes(2);
      const optsAfter = spy.mock.calls[1]![0]!;
      const allLinesAfter = optsAfter.allLines as readonly ScrollbackLine[];
      const offsetAfter = optsAfter.offset as number;

      // Same perTab state → same offset.
      expect(offsetAfter).toBe(offsetBefore);
      // Selected slice is identical for shared indices, proving no drift.
      for (let i = 0; i < SCROLLBACK_ROWS; i++) {
        expect(allLinesAfter[offsetAfter + i]).toEqual(allLinesBefore[offsetBefore + i]);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
