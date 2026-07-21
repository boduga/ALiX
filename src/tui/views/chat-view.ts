import { renderDashboard } from '../dashboard-renderer.js';
import type { PerTabState, TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';
import { wrapText } from './wrap-text.js';

/**
 * ChatView — default landing tab. Renders the input prompt placeholder
 * followed by a compact 4-panel coordinate-based dashboard (DAEMON,
 * APPROVALS, RUNTIME, SOPS & POLICY) when a canvas is provided via
 * `ctx.canvas`.  Falls back to the legacy string[] render path when
 * no canvas is available.
 *
 * Pure: render(ctx) never mutates ctx; same input → same output.
 * Passive: only reads from ctx.snap — does not import any subsystem.
 */
export class ChatView implements TuiView {
  readonly id: TabId = 'chat';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;

    // Prompt line with the current input buffer (placed below the 3-row header).
    const buf = ctx.perTab.inputBuffer;
    c.write(0, 4, '\x1b[33m alix>\x1b[0m ');
    c.write(7, 4, buf);
    // Draw the cursor at the end of the typed text.
    c.write(7 + buf.length, 4, '\x1b[7m \x1b[0m');

    // Pin the 4-panel dashboard to the bottom of the canvas, flush above
    // the 3-row footer painted by app.ts (tab row at N-3, gap row at N-2,
    // status row at N-1). Floor at 0 so very small canvases still render
    // a meaningful frame instead of overlapping the prompt.
    const PANEL_H = 14;
    const FOOTER_H = 3;
    const startY = Math.max(0, ctx.dimensions.rows - PANEL_H - FOOTER_H);

    // Scrollback area — alternate between user prompts (→) and
    // agent responses (←). Long messages word-wrap into multiple rows so
    // they don't truncate at the panel border; the marker only appears
    // on the first line of each turn and continuation lines indent to
    // align under the text.
    const submitted = ctx.perTab.submittedPrompts;
    const responses = ctx.perTab.agentResponses;
    const turns: { kind: 'user' | 'agent'; text: string }[] = [];
    const maxLen = Math.max(submitted.length, responses.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < submitted.length) turns.push({ kind: 'user', text: submitted[i]! });
      if (i < responses.length) turns.push({ kind: 'agent', text: responses[i]! });
    }
    const scrollbackTop = 5;
    const scrollbackBottom = startY - 1;
    const scrollbackRows = Math.max(0, scrollbackBottom - scrollbackTop + 1);
    const textWidth = Math.max(0, ctx.dimensions.columns - 4);

    // Flatten turns → wrapped lines so very long messages occupy multiple
    // rows instead of truncating at the right border.
    interface ScrollbackLine { kind: 'user' | 'agent'; text: string; isFirst: boolean }
    const allLines: ScrollbackLine[] = [];
    for (const t of turns) {
      const wrapped = wrapText(t.text, textWidth);
      for (let i = 0; i < wrapped.length; i++) {
        allLines.push({ kind: t.kind, text: wrapped[i]!, isFirst: i === 0 });
      }
    }
    // Use scrollOffset so the user can scroll back through past responses
    // with arrow keys. offset=0 shows the most recent lines (bottom).
    const offset = ctx.perTab.scrollOffset;
    const endIndex = Math.max(0, allLines.length - offset);
    const startIndex = Math.max(0, endIndex - scrollbackRows);
    const visible = allLines.slice(startIndex, endIndex);
    for (let i = 0; i < visible.length; i++) {
      const rowY = scrollbackTop + i;
      const l = visible[i]!;
      if (l.isFirst) {
        const marker = l.kind === 'user' ? '\x1b[90m→ \x1b[0m' : '\x1b[36m← \x1b[0m';
        c.write(0, rowY, marker);
        c.write(2, rowY, l.text);
      } else {
        // Continuation — indent under the text column (no marker).
        c.write(2, rowY, l.text);
      }
    }

    renderDashboard(ctx.snap, c, startY);

    // Return empty rows — the caller writes the full frame from the canvas.
    return { rows: [] };
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