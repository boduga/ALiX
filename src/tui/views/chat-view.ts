import type { PerTabState, TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';
import { wrapText } from './wrap-text.js';
import { renderResponse } from '../blocks/render.js';
import { getTheme } from '../blocks/theme.js';

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

    // The 4-panel dashboard strip at the bottom of the chat tab is gone;
    // the panels now live in the new `dashboard` tab. Scrollback uses
    // the full vertical viewport (down to the tab bar at N-3). Floor
    // at 0 so very small canvases still render a meaningful frame.
    const PANEL_H = 0;
    const FOOTER_H = 3;
    const startY = Math.max(0, ctx.dimensions.rows - PANEL_H - FOOTER_H);

    // Scrollback area — alternate between user prompts (→) and
    // agent responses (←). Long messages word-wrap into multiple rows so
    // they don't truncate at the panel border; the marker only appears
    // on the first line of each turn and continuation lines indent to
    // align under the text.
    const submitted = ctx.perTab.submittedPrompts;
    const responses = ctx.perTab.agentResponses;
    const scrollbackTop = 5;
    const scrollbackBottom = startY - 1;
    const scrollbackRows = Math.max(0, scrollbackBottom - scrollbackTop + 1);
    const textWidth = Math.max(0, ctx.dimensions.columns - 4);

    // Flatten turns → wrapped lines so very long messages occupy multiple
    // rows instead of truncating at the right border. User prompts stay
    // plain; agent responses go through the rich renderer so fenced
    // code, lists, bold/italic, headings, and quotes get their own
    // visual treatment.
    interface ScrollbackLine { kind: 'user' | 'agent' | 'capability'; text: string; isFirst: boolean }
    const allLines: ScrollbackLine[] = [];
    const maxLen = Math.max(submitted.length, responses.length);
    for (let i = 0; i < maxLen; i++) {
      // Blank-line separator between turns so each query breathes away
      // from the previous response. Skip the very first turn so we
      // don't push a leading empty line.
      if (i > 0) {
        allLines.push({ kind: 'user', text: '', isFirst: false });
      }
      if (i < submitted.length) {
        // User prompts render as plain text — no markdown parsing needed.
        const wrapped = wrapText(submitted[i]!, textWidth);
        wrapped.forEach((line, j) => {
          allLines.push({ kind: 'user', text: line, isFirst: j === 0 });
        });
      }
      if (i < responses.length) {
        // Agent responses go through the rich renderer.
        renderResponse(responses[i]!, textWidth, ctx.themeName ? getTheme(ctx.themeName) : undefined).forEach((row, j) => {
          allLines.push({ kind: 'agent', text: row.text, isFirst: j === 0 });
        });
      }
    }
    // (Turns were inlined into the loop above; nothing to do here.)

    // Capability invocations surface in the operator timeline after the
    // conversation turns — "⚡ core.session.list [completed ✓]".
    const invocations = ctx.perTab.capabilityInvocations;
    for (const inv of invocations) {
      let text = inv.capabilityId;
      if (inv.status === 'running') text += ' [running]';
      else if (inv.status === 'completed') text += ` [completed ✓] ${inv.output === undefined ? '' : JSON.stringify(inv.output)}`;
      else if (inv.status === 'failed') text += ` [failed ✗] ${inv.error ?? ''}`;
      else text += ' [cancelled]';
      allLines.push({ kind: 'capability', text: text.trim(), isFirst: true });
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
        const marker = l.kind === 'user' ? '\x1b[90m→ \x1b[0m'
          : l.kind === 'agent' ? '\x1b[36m← \x1b[0m'
          : '\x1b[35m⚡ \x1b[0m';
        c.write(0, rowY, marker);
        c.write(2, rowY, l.text);
      } else {
        // Continuation — indent under the text column (no marker).
        c.write(2, rowY, l.text);
      }
    }

    // The 4 dashboard panels (DAEMON/APPROVALS/RUNTIME/SOPs) used to
    // render here at the bottom of the chat tab. They now live in the
    // new `dashboard` tab as the default landing surface.

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