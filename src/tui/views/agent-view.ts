import { renderDashboard } from '../dashboard-renderer.js';
import type { PerTabState, TabId } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';
import { wrapText } from './wrap-text.js';

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
 * Pure: render(ctx) never mutates ctx.
 */
export class AgentView implements TuiView {
  readonly id: TabId = 'agent';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const c = ctx.canvas!;

    // Agent prompt row at row 4 (below the 3-row header), shifted right
    // a bit so the longer label fits without colliding with the cursor.
    const buf = ctx.perTab.inputBuffer;
    c.write(0, 4, '\x1b[33m alix-agent>\x1b[0m ');
    const PROMPT_COL = 13;
    c.write(PROMPT_COL, 4, buf);
    c.write(PROMPT_COL + buf.length, 4, '\x1b[7m \x1b[0m');

    // Runtime status line — pinned just above the scrollback at row 5.
    // Gives the operator immediate context: event count + current step.
    const r = ctx.snap.runtime;
    if (r && r.totalEventCount > 0) {
      const wf = r.workflow;
      const stepBit = wf
        ? ` | step ${wf.currentStep}/${wf.totalSteps}`
        : '';
      c.write(0, 5, `\x1b[90mevents: ${r.totalEventCount}${stepBit}\x1b[0m`);
    }

    // Pin the 4-panel dashboard to the bottom of the canvas, flush above
    // the 3-row footer painted by app.ts.
    const PANEL_H = 14;
    const FOOTER_H = 3;
    const startY = Math.max(0, ctx.dimensions.rows - PANEL_H - FOOTER_H);

    // Scrollback area — alternate between user tasks (→) and agent
    // responses (←). Same interleaving as ChatView but with the status
    // row at row 5 reserved, so the scrollback starts at row 6.
    // Long messages word-wrap so they don't truncate at the right border.
    const submitted = ctx.perTab.submittedPrompts;
    const responses = ctx.perTab.agentResponses;
    const turns: { kind: 'user' | 'agent'; text: string }[] = [];
    const maxLen = Math.max(submitted.length, responses.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < submitted.length) turns.push({ kind: 'user', text: submitted[i]! });
      if (i < responses.length) turns.push({ kind: 'agent', text: responses[i]! });
    }
    const scrollbackTop = 6;
    const scrollbackBottom = startY - 1;
    const scrollbackRows = Math.max(0, scrollbackBottom - scrollbackTop + 1);
    const textWidth = Math.max(0, ctx.dimensions.columns - 4);

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
        c.write(2, rowY, l.text);
      }
    }

    renderDashboard(ctx.snap, c, startY);

    return { rows: [] };
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    // Arrow keys scroll the scrollback; 3 lines per step gives a smooth
    // feel without being too slow for longer responses. Other keys are
    // swallowed (the agent tab's input buffer is handled by TuiApp).
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
