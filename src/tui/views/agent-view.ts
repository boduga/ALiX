import type { PerTabState, TabId, TimelineEvent } from '../state.js';
import type { ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult, TuiView } from './types.js';
import { wrapText } from './wrap-text.js';
import { renderResponse } from '../blocks/render.js';
import { callout } from '../ui-helpers.js';
import { getTheme } from '../blocks/theme.js';
import { RESET } from '../ansi-constants.js';

/**
 * Render an agent (or user) response through the `ResponseBlock` parser
 * so that fenced code blocks render verbatim with a 2-space indent and
 * an optional `[lang]` header, instead of being word-wrapped as prose.
 *
 * Dispatch order preserves the parse-order invariant from the parser:
 * code-mode runs before list-mode, and text-mode is the fallback.
 * (Text-mode currently delegates to `wrapText` so existing wrap
 * behaviour is unchanged.)
 *
 * list-mode normalizes unordered markers and renumbers ordered items while
 * wrapping each item independently with continuation-line indentation.
 */

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
    c.write(0, 4, `\x1b[33m alix-agent>${RESET} `);
    const PROMPT_COL = 13;
    c.write(PROMPT_COL, 4, buf);
    c.write(PROMPT_COL + buf.length, 4, `\x1b[7m ${RESET}`);

    // Runtime status line — pinned just above the scrollback at row 5.
    // Gives the operator immediate context: event count + current step.
    const r = ctx.snap.runtime;
    if (r && r.totalEventCount > 0) {
      const wf = r.workflow;
      const stepBit = wf
        ? ` | step ${wf.currentStep}/${wf.totalSteps}`
        : '';
      c.write(0, 5, `\x1b[90mevents: ${r.totalEventCount}${stepBit}${RESET}`);
    }

    // Mode badge — indicates the agent's current classified intent.
    // Research is the default and renders no badge. Mutation shows a
    // yellow [E], validation shows a green [V].
    const intent = ctx.perTab.currentIntent;
    if (intent && intent !== 'research') {
      const color = intent === 'mutation' ? '\x1b[33m' : '\x1b[32m';
      const label = intent === 'mutation' ? 'E' : 'V';
      c.write(2, 5, `${color}[${label}]${RESET}`);
    }

    // The 14-row dashboard reservation is gone (panels now live in
    // the dashboard tab). Scrollback uses the full vertical space.
    const PANEL_H = 0;
    const FOOTER_H = 3;
    const startY = Math.max(0, ctx.dimensions.rows - PANEL_H - FOOTER_H);

    // Scrollback area — alternate between user tasks (→) and agent
    // responses (←). Same interleaving as ChatView but with the status
    // row at row 5 reserved, so the scrollback starts at row 6.
    // Long messages word-wrap so they don't truncate at the right border.
    // Conversation turns from the unified operator timeline. The agent
    // view is a PROJECTION of the same timeline — filtered to user/agent
    // only. Capability entries never appear here (the agent tab is the
    // execution workspace; the chat tab is the operator narrative).
    const turns: { kind: 'user' | 'agent'; text: string }[] = ctx.perTab.timelineEvents
      .filter((e): e is Extract<TimelineEvent, { kind: 'user' | 'agent' }> => e.kind === 'user' || e.kind === 'agent')
      .map((e) => ({ kind: e.kind, text: e.text }));
    const scrollbackTop = 6;
    const scrollbackBottom = startY - 1;
    const scrollbackRows = Math.max(0, scrollbackBottom - scrollbackTop + 1);
    const textWidth = Math.max(0, ctx.dimensions.columns - 4);

    interface ScrollbackLine { kind: 'user' | 'agent' | 'plan' | 'approval' | 'toolCall'; text: string; isFirst: boolean }
    const allLines: ScrollbackLine[] = [];

    // Plan task checklist — rendered before the full plan markdown so the
    // operator sees a structured summary at a glance. Each task line uses
    // the same `plan` kind (dim styling) as the plan content below.
    // Markers: [ ] pending, [~] in_progress, [x] completed, [-] skipped.
    // Capped at 20 tasks to avoid overwhelming the scrollback.
    if (ctx.perTab.planTasks && ctx.perTab.planTasks.length > 0) {
      const statusSymbol: Record<string, string> = {
        pending: '[ ]',
        in_progress: '[~]',
        completed: '[x]',
        skipped: '[-]',
      };
      const tasks = ctx.perTab.planTasks.slice(0, 20);
      allLines.push({ kind: 'plan', text: 'PLAN TASKS', isFirst: false });
      for (const task of tasks) {
        const marker = statusSymbol[task.status] ?? '[ ]';
        const line = `${marker} ${task.index}. ${task.title}`;
        const wrapped = wrapText(line, textWidth);
        for (let i = 0; i < wrapped.length; i++) {
          allLines.push({ kind: 'plan', text: wrapped[i]!, isFirst: false });
        }
      }
      // Blank line separator before the full plan markdown
      allLines.push({ kind: 'plan', text: '', isFirst: false });
    }

    // Plan content — rendered above the turn scrollback as a distinguished
    // section so the operator sees what the agent planned to do.
    if (ctx.perTab.planContent) {
      const planLines = wrapText(ctx.perTab.planContent, textWidth);
      for (let i = 0; i < planLines.length; i++) {
        allLines.push({ kind: 'plan', text: planLines[i]!, isFirst: i === 0 });
      }
      // ─ separator between plan and scrollback turns
      allLines.push({ kind: 'plan', text: '', isFirst: false });
    }

    for (let ti = 0; ti < turns.length; ti++) {
      const t = turns[ti]!;
      // Blank-line separator between turns so each query breathes
      // away from the previous response. Skip the very first turn.
      if (ti > 0) {
        allLines.push({ kind: t.kind, text: '', isFirst: false });
      }
      const rendered = renderResponse(t.text, textWidth, ctx.themeName ? getTheme(ctx.themeName) : undefined)
        .map(r => ({ kind: t.kind, text: r.text, isFirst: r.isFirst }));
      for (const line of rendered) {
        allLines.push(line);
      }
    }

    // Live approval requests — render as inline cards so the operator can
    // resolve them with `a` / `d` without leaving the agent tab. The
    // first line is a header showing how many are pending; each entry
    // shows tool + target with a hint to press `a` or `d`.
    if (ctx.perTab.pendingApprovals.length > 0) {
      const aps = ctx.perTab.pendingApprovals;
      const body = `${aps.length} approval request${aps.length === 1 ? '' : 's'} pending — press 'a' to approve, 'd' to deny`;
      const calloutRows = callout('WARNING', body, textWidth);
      for (let i = 0; i < calloutRows.length; i++) {
        allLines.push({ kind: 'approval', text: calloutRows[i]!.text, isFirst: i === 0 });
      }
      for (const a of aps) {
        const card = `  ▸ ${a.toolName}  ${a.target || '(no target)'}  ·  ${a.id.slice(-5)}`;
        const wrapped = wrapText(card, textWidth);
        for (let i = 0; i < wrapped.length; i++) {
          allLines.push({ kind: 'approval', text: wrapped[i]!, isFirst: i === 0 });
        }
      }
    }
    // Pending tool calls — rendered as two-line dim entries so the operator
    // can see what tools are queued. Line 1: → tool name (dim), Line 2:
    // 2-space indent + summary (dim, only if summary present).
    if (ctx.perTab.pendingToolCalls && ctx.perTab.pendingToolCalls.length > 0) {
      allLines.push({ kind: 'toolCall', text: 'PENDING TOOL CALLS', isFirst: false });
      for (const tc of ctx.perTab.pendingToolCalls) {
        allLines.push({ kind: 'toolCall', text: `→ ${tc.name}`, isFirst: true });
        if (tc.summary) {
          allLines.push({ kind: 'toolCall', text: `  ${tc.summary}`, isFirst: false });
        }
      }
      allLines.push({ kind: 'toolCall', text: '', isFirst: false });
    }
    // Progress ledger — dim-style status block showing recent tool
    // execution results (checkmarks for completed, crosses for failed).
    // Press `e` to toggle between expanded (all lines) and collapsed
    // (last 3 lines) view. The default is collapsed so the scrollback
    // doesn't fill up with ledger noise during rapid tool execution.
    if (ctx.perTab.progressLedger) {
      const ledgerLines = ctx.perTab.progressLedger.split("\n");
      const cap = ctx.perTab.ledgerExpanded ? ledgerLines.length : Math.min(3, ledgerLines.length);
      const sliced = ledgerLines.slice(-cap);
      for (const line of sliced) {
        allLines.push({ kind: 'plan', text: line, isFirst: false });
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
      if (l.kind === 'plan') {
        if (l.isFirst) {
          c.write(0, rowY, `\x1b[2m◆ ${RESET}`);
          c.write(2, rowY, `\x1b[2m${l.text}${RESET}`);
        } else if (l.text) {
          c.write(2, rowY, `\x1b[2m${l.text}${RESET}`);
        }
        // empty separator line → skip (blank)
      } else if (l.kind === 'approval') {
        if (l.isFirst) {
          c.write(0, rowY, `\x1b[33m⏸ ${RESET}`);
          c.write(2, rowY, `\x1b[33m${l.text}${RESET}`);
        } else {
          c.write(2, rowY, `\x1b[33m${l.text}${RESET}`);
        }
      } else if (l.kind === 'toolCall') {
        // Tool call entries: header line uses bold dim, entries use dim
        if (l.isFirst) {
          c.write(0, rowY, `\x1b[2m→ ${RESET}`);
          c.write(2, rowY, `\x1b[2m${l.text.slice(2)}${RESET}`);
        } else {
          c.write(2, rowY, `\x1b[2m${l.text}${RESET}`);
        }
      } else if (l.isFirst) {
        const marker = l.kind === 'user' ? `\x1b[90m→ ${RESET}` : `\x1b[36m← ${RESET}`;
        c.write(0, rowY, marker);
        c.write(2, rowY, l.text);
      } else {
        c.write(2, rowY, l.text);
      }
    }

    // Dashboard is rendered by app.ts into a separate sidebar canvas
    // (70/30 split). Returning rows: [] keeps the legacy return contract.

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
      case 'e':
      case 'E':
        // Toggle ledger expand/collapse — when expanded all ledger lines
        // are shown; when collapsed only the last 3 lines are visible.
        ctx.perTab.ledgerExpanded = !ctx.perTab.ledgerExpanded;
        return { type: 'handled' };
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
