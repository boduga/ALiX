import type { TerminalCanvas } from '../canvas.js';

export interface ScrollbackLine {
  kind: string;
  text: string;
  isFirst: boolean;
  /**
   * True only for the last row of a multi-row group (e.g. the tail of a
   * wrapped live-streaming line). Optional — most lines omit it; renderers
   * use it to draw a trailing liveness cursor on the final row.
   */
  isLast?: boolean;
  /**
   * Stage label to paint in the agent scrollback's reserved 15-char
   * left gutter (#432 stage-decorated scrollback). Set on the FIRST wrap
   * line of each stage's first content event; continuation lines of the
   * same stage leave it undefined so the view paints a blank gutter.
   * Undefined for non-stage rows (pre-stage turns, blank separators).
   * Padded to GUTTER_WIDTH by the line builder.
   */
  gutter?: string;
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
