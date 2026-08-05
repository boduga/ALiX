import type { PerTabState, TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';
import { renderBottomAnchoredSlice, type KindStyleMap, type ScrollbackLine } from './bottom-anchored-viewport.js';
import { buildChatScrollbackLines } from './scroll-math.js';
import { RESET } from '../ansi-constants.js';
import type { TerminalCanvas } from '../canvas.js';

/**
 * ChatView — default landing tab. Lightweight conversation surface
 * (no tool-loop, no slash commands). Renders the operator timeline
 * as user prompts (→) interleaved with agent replies (←) and
 * a bottom-anchored input panel.
 *
 * Layout mirrors AgentView (sans status row, slash strip, plan/approval
 * rendering): header (rows 0-2), blank (3), scrollback (4..panelRow-1),
 * panel (panelRow). pinnedBottom=true recomputes the bottom anchor on
 * each paint; pinnedBottom=false uses the absolute window-start index
 * captured by app.ts on scroll-up.
 *
 * Pure: render(ctx) never mutates ctx; same input → same output.
 */
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

    // Line-builder lives in scroll-math.ts (single source truth).
    const allLines: ScrollbackLine[] = buildChatScrollbackLines(ctx, textWidth);

    const effectiveOffset = ctx.perTab.pinnedBottom
      ? Math.max(0, allLines.length - scrollbackRows)
      : ctx.perTab.scrollOffset;

    const kindStyles: KindStyleMap = {
      user: (l, rowY) => this.renderChatLine('user', l, rowY, c),
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
    c.write(0, panelRow, `\x1b[33m alix>${RESET} `);
    c.write(PROMPT_COL, panelRow, buf);
    c.write(PROMPT_COL + buf.length, panelRow, `\x1b[7m ${RESET}`);

    return { rows: [] };
  }

  private renderChatLine(kind: 'user' | 'agent', l: ScrollbackLine, rowY: number, c: TerminalCanvas): void {
    // Verbatim chat-view.ts:100-109.
    if (l.isFirst) {
      const marker = kind === 'user' ? `\x1b[90m→ ${RESET}`
        : kind === 'agent' ? `\x1b[36m← ${RESET}`
        : `\x1b[35m⚡ ${RESET}`;
      c.write(0, rowY, marker);
      c.write(2, rowY, l.text);
    } else {
      // Continuation — indent under the text column (no marker).
      c.write(2, rowY, l.text);
    }
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // Arrow keys scroll the scrollback; 3 lines per step gives a smooth
    // feel without being too slow for longer responses. Other keys are
    // swallowed (the chat tab's input buffer is handled by TuiApp).
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
    // No-op for now.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op for now.
  }
}
