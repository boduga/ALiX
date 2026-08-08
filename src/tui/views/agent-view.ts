import type { PerTabState, TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';
import { renderBottomAnchoredSlice, type KindStyleMap, type ScrollbackLine } from './bottom-anchored-viewport.js';
import { renderSlashOverlay } from './slash-overlay.js';
import { buildAgentScrollbackLines, computeViewport, GUTTER_WIDTH } from './scroll-math.js';
import { RESET } from '../ansi-constants.js';
import type { TerminalCanvas } from '../canvas.js';

/**
 * AgentView — full-workflow task surface. Submit calls
 * `AgentSession.processTurn` (tool-loop capable) rather than
 * `processChat` (lightweight echo).
 *
 * Layout mirrors ChatView so the two tabs share scrollback and prompt
 * behaviour — the only material differences are:
 *   - prompt marker: `alix-agent>` instead of `alix>`
 *   - status row above the scrollback that surfaces runtime workflow
 *     and event counts at a glance
 *
 * The input panel + slash strip are bottom-anchored (Claude-Code style):
 * the panel sits inside the 5-row footer (topBorderRow, panelRow,
 * bottomBorderRow, status row) framed by a dim-grey horizontal rule
 * above and below the prompt. The slash strip renders directly below
 * the panel. The scrollback fills rows 6 through panelRow-1 (1 row
 * above the panel), pinned by default to the most recent content;
 * the view branches on `pinnedBottom`:
 *
 *   pinned:    effectiveOffset = max(0, allLines.length - scrollbackRows)
 *   unpinned:  effectiveOffset = scrollOffset (absolute window-start index)
 *
 * Pure: render(ctx) never mutates ctx.
 */
export class AgentView implements TuiView {
  readonly id: TabId = 'agent';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;
    const vp = computeViewport(ctx.dimensions, 'agent');
    const STATUS_ROW = 4;              // status line + intent badge row
    // Stage-gutter left column: blank under slice #2; stage labels in slice #3.
    // Marker sits at column `gutter`, content text starts at `gutter + 2`. The
    // status row and prompt row are NOT scrollback and stay at column 0.
    const gutter = GUTTER_WIDTH;

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
    const allLines: ScrollbackLine[] = buildAgentScrollbackLines(ctx, vp.textWidth);

    // Branch on pinnedBottom: pinned recomputes bottomAnchor fresh,
    // unpinned uses captured scrollOffset (absolute window-start index).
    const effectiveOffset = ctx.perTab.pinnedBottom
      ? Math.max(0, allLines.length - vp.scrollbackRows)
      : ctx.perTab.scrollOffset;

    const kindStyles: KindStyleMap = {
      plan:     (l, rowY) => this.renderPlanLine(l, rowY, c, gutter),
      approval: (l, rowY) => this.renderApprovalLine(l, rowY, c, gutter),
      toolCall: (l, rowY) => this.renderToolCallLine(l, rowY, c, gutter),
      user:     (l, rowY) => this.renderTurnLine('user', l, rowY, c, gutter),
      agent:    (l, rowY) => this.renderTurnLine('agent', l, rowY, c, gutter),
      streaming: (l, rowY) => this.renderStreamingLine(l, rowY, c, gutter),
      // T6 — C1 observability: LOW-value context lifecycle events
      // (snapshot.created / budget.computed) render as dim grey text.
      context:  (l, rowY) => this.renderContextLine(l, rowY, c, gutter),
    };

    renderBottomAnchoredSlice({
      canvas: c,
      allLines,
      top: vp.scrollbackTop,
      bottomRow: vp.scrollbackBottom,
      offset: effectiveOffset,
      columns: ctx.dimensions.columns,
      kindStyles,
    });

    // Input panel at panelRow.
    const buf = ctx.perTab.inputBuffer;
    c.write(0, vp.panelRow, `\x1b[33m alix-agent>${RESET} `);
    c.write(vp.promptCol, vp.panelRow, buf);
    c.write(vp.promptCol + buf.length, vp.panelRow, `\x1b[7m ${RESET}`);

    // Frame the input panel: full-width dim-grey horizontal rules above
    // and below the prompt (Claude-Code style chrome). Drawn AFTER the
    // prompt so the rules read as part of the panel; on a tall terminal
    // the slash strip overlays the bottom rule's first row — acceptable
    // because the strip is intentionally visually loud.
    const border = `\x1b[90m${'─'.repeat(ctx.dimensions.columns)}\x1b[0m`;
    c.write(0, vp.topBorderRow, border);
    c.write(0, vp.bottomBorderRow, border);

    // Slash strip directly BELOW the panel.
    if (ctx.slash) {
      renderSlashOverlay({ canvas: c, slash: ctx.slash, panelRow: vp.panelRow, columns: ctx.dimensions.columns });
    }

    return { rows: [] };
  }

  private renderPlanLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    // #432 — gutter label at column 0 (when set), dim `│` separator at
    // column `gutter`, dim text at column `gutter + 2`. The gutter +
    // separator only paint on the first line of a group; continuation lines
    // stay blank so the existing test contracts ("blank separator rows are
    // truly empty", "exactly one marker per response") still hold.
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    if (l.text) c.write(textCol, rowY, `\x1b[2m${l.text}${RESET}`);
  }

  private renderApprovalLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
      c.write(textCol, rowY, `\x1b[33m${l.text}${RESET}`);
    } else {
      c.write(textCol, rowY, `\x1b[33m${l.text}${RESET}`);
    }
  }

  private renderToolCallLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    // Tool call text already includes its own `→ ` prefix (produced by
    // scroll-math.ts when rendering the toolCalls block). Render the full
    // text at `gutter + 2` — no marker slicing; the line builder owns the
    // prefix. Pre-#432 this method sliced off the first 2 chars because the
    // old marker was the same `→ `; the new universal `│` separator makes
    // the slicing unnecessary.
    c.write(textCol, rowY, `\x1b[2m${l.text}${RESET}`);
  }

  /** T6 — C1 observability: LOW-value context lifecycle events
   *  (snapshot.created / budget.computed) render as dim grey text with
   *  the stage-gutter separator. Matches the existing toolCall/plan dim
   *  styling convention. */
  private renderContextLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    // Dim grey — the context line text is pre-formatted by TimelineBuilder.
    c.write(textCol, rowY, `\x1b[2m\x1b[37m${l.text}${RESET}`);
  }

  private renderTurnLine(kind: 'user' | 'agent', l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
      if (kind === 'user') {
        c.write(textCol, rowY, l.text);
      } else {
        c.write(textCol, rowY, `\x1b[36m${l.text}${RESET}`);
      }
    } else {
      if (kind === 'user') {
        c.write(textCol, rowY, l.text);
      } else {
        c.write(textCol, rowY, `\x1b[36m${l.text}${RESET}`);
      }
    }
  }

  /** Live-streaming assistant line: dim trailing cursor on the last row so
   *  the operator can tell "growing live" from "frozen partial". The gutter
   *  + separator carry the current stage attribution. */
  private renderStreamingLine(l: ScrollbackLine, rowY: number, c: TerminalCanvas, gutter: number): void {
    const textCol = gutter + 2;
    if (l.isFirst) {
      if (l.gutter) c.write(0, rowY, `\x1b[36m${l.gutter}${RESET}`);
      c.write(gutter, rowY, `\x1b[90m│${RESET}`);
    }
    if (l.isLast) {
      c.write(textCol, rowY, `${l.text}\x1b[90m▍${RESET}`);
    } else {
      c.write(textCol, rowY, l.text);
    }
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // Arrow keys scroll the scrollback; 3 lines per step gives a smooth
    // feel without being too slow for longer responses. Other keys are
    // swallowed (the agent tab's input buffer is handled by TuiApp).
    // The pinnedBottom side-effect happens in app.ts (Task 3).
    const SCROLL_STEP = 3;
    switch (key) {
      case 'ArrowUp':
        return { type: 'scroll', offset: ctx.perTab.scrollOffset + SCROLL_STEP };
      case 'ArrowDown': {
        const offset = Math.max(0, ctx.perTab.scrollOffset - SCROLL_STEP);
        return { type: 'scroll', offset };
      }
      default:
        return { type: 'handled' };
    }
  }

  onActivate(_perTab: PerTabState): void {
    // No-op for now; app.ts handles the per-tab reset.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op for now.
  }
}
