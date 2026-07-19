import { renderDashboard } from '../dashboard-renderer.js';
import type { PerTabState, TabId } from '../state.js';
import type { ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';

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
    // responses (←). Same interleaving as ChatView so the operator
    // gets a consistent conversation-model feel across both tabs.
    const submitted = ctx.perTab.submittedPrompts;
    const responses = ctx.perTab.agentResponses;
    const turns: { kind: 'user' | 'agent'; text: string }[] = [];
    const maxLen = Math.max(submitted.length, responses.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < submitted.length) turns.push({ kind: 'user', text: submitted[i]! });
      if (i < responses.length) turns.push({ kind: 'agent', text: responses[i]! });
    }
    const scrollbackTop = 6; // 5 reserved for status line
    const scrollbackBottom = startY - 1;
    const scrollbackRows = Math.max(0, scrollbackBottom - scrollbackTop + 1);
    const recent = turns.slice(-scrollbackRows);
    const textWidth = Math.max(0, ctx.dimensions.columns - 4);
    for (let i = 0; i < recent.length; i++) {
      const rowY = scrollbackTop + i;
      const t = recent[i]!;
      if (t.kind === 'user') {
        c.write(0, rowY, '\x1b[90m→ \x1b[0m');
        c.write(2, rowY, t.text.slice(0, textWidth));
      } else {
        c.write(0, rowY, '\x1b[36m← \x1b[0m');
        c.write(2, rowY, t.text.slice(0, textWidth));
      }
    }

    renderDashboard(ctx.snap, c, startY);

    return { rows: [] };
  }

  handleKey(key: string, _ctx: ViewInputContext): { type: 'handled' } {
    // Real input handling arrives in a later iteration. For now swallow keys.
    void key;
    return { type: 'handled' };
  }

  onActivate(_perTab: PerTabState): void {
    // No-op for now.
  }

  onDeactivate(_perTab: PerTabState): void {
    // No-op for now.
  }
}
