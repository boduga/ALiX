import { wrapText } from './wrap-text.js';
import { renderResponse } from '../blocks/render.js';
import { callout } from '../ui-helpers.js';
import { getTheme } from '../blocks/theme.js';
import type { ScrollbackLine } from './bottom-anchored-viewport.js';
import type { ViewRenderContext } from './types.js';

/** Shared TUI layout geometry. Single source of truth — the views, app.ts,
 *  and scroll-math all compute panelRow/scrollbackTop/textWidth
 *  (plus topBorderRow/bottomBorderRow for the chrome frame)
 *  from these.
 *  FOOTER_H = 5 (tab row + top border + prompt row + bottom border +
 *  status row). BELOW_PROMPT_ROWS decouples the prompt's row position
 *  from the footer height so future footer additions don't drift the
 *  prompt outside the footer. PANEL_H is the future multi-line
 *  input-panel knob (0 today — single-line prompt). */
export const HEADER_H = 3;
export const FOOTER_H = 5;
export const BELOW_PROMPT_ROWS = 3;
export const PANEL_H = 0;
/** Scrollback starts below the agent tab's status row (agent=6: header rows
 *  0-2, blank 3, status 4, blank 5). Chat has no status row, so 5. */
export const SCROLLBACK_TOP_AGENT = 6;
export const SCROLLBACK_TOP_CHAT = 5;
/** Fixed left gutter reserved on every agent scrollback line (slice #2 of
 *  the stage-decorated scrollback plan). Width is the longest stage label
 *  (UNDERSTANDING = 13) + separator + space = 15. The gutter is blank under
 *  slice #2; slice #3 fills it with stage labels. This is the single source
 *  of truth — `computeViewport` shrinks `textWidth` here, and the agent view
 *  offsets its content column by the same amount. Chat view does not reserve
 *  this gutter. */
export const GUTTER_WIDTH = 15;

export interface Viewport {
  headerRows: number;
  footerRows: number;
  panelRows: number;
  /** Row of the prompt itself, inside the footer. */
  panelRow: number;
  /** Row of the horizontal rule above the prompt (tab row + 1). */
  topBorderRow: number;
  /** Row of the horizontal rule below the prompt (status row - 1). */
  bottomBorderRow: number;
  scrollbackTop: number;
  scrollbackBottom: number;
  scrollbackRows: number;
  textWidth: number;
  promptCol: number;
}

/** Compute all bottom-anchored layout geometry for a tab. Pure over dims. */
export function computeViewport(
  dims: { columns: number; rows: number },
  kind: 'agent' | 'chat',
): Viewport {
  const topBorderRow = dims.rows - FOOTER_H + 1;
  const bottomBorderRow = dims.rows - BELOW_PROMPT_ROWS + 1;
  const panelRow = dims.rows - BELOW_PROMPT_ROWS;
  const scrollbackTop = kind === 'agent' ? SCROLLBACK_TOP_AGENT : SCROLLBACK_TOP_CHAT;
  const scrollbackBottom = topBorderRow - 1;
  // Wrap width = terminal width − existing side margin (4) − reserved gutter
  // (GUTTER_WIDTH, agent only). GUTTER_WIDTH is the single source of truth;
  // the agent view's content column is offset by the same amount. Chat view
  // does not reserve the gutter, so its textWidth keeps the pre-#431 shape.
  const sideMargin = 4;
  const gutter = kind === 'agent' ? GUTTER_WIDTH : 0;
  return {
    headerRows: HEADER_H,
    footerRows: FOOTER_H,
    panelRows: PANEL_H,
    panelRow,
    topBorderRow,
    bottomBorderRow,
    scrollbackTop,
    scrollbackBottom,
    scrollbackRows: Math.max(0, scrollbackBottom - scrollbackTop + 1),
    textWidth: Math.max(0, dims.columns - sideMargin - gutter),
    promptCol: kind === 'agent' ? 13 : 7,
  };
}

/**
 * Build the scrollback line array for the agent view. Pure function over
 * `ctx.runtime.agent` + `ctx.perTab` (planTasks, planContent, pendingApprovals,
 * pendingToolCalls, progressLedger, ledgerExpanded, currentIntent) — same
 * inputs the view's `render` consumes, so the array length matches what the
 * next paint will slice.
 *
 * Single source of truth shared by the view (rendering) and app.ts
 * (offset-capture on scroll-up). Do not duplicate this logic — copy it.
 */
export function buildAgentScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[] {
  const out: ScrollbackLine[] = [];
  const r = ctx.snap?.runtime;
  const planTasks = ctx.perTab.planTasks;
  const planContent = ctx.perTab.planContent;
  const pendingApprovals = ctx.perTab.pendingApprovals;
  const pendingToolCalls = ctx.perTab.pendingToolCalls;
  const progressLedger = ctx.perTab.progressLedger;
  const ledgerExpanded = ctx.perTab.ledgerExpanded;

  // Group timeline entries by turn. A turn starts with a user `agent.message`
  // and contains every subsequent agent entry until the next user message.
  // The plan (planTasks/planContent) belongs to the CURRENT turn — the one in
  // flight or just completed — so it renders AFTER that turn's user prompt,
  // not at the top of the scrollback where it would visually float above
  // every previous turn.
  const timelineEntries = (ctx.runtime?.agent?.timeline ?? [])
    .filter((e: any) => e.kind === 'agent.message' || e.kind === 'agent.reasoning' || e.kind === 'agent.decision' || e.kind === 'agent.response');

  type Turn = { userText: string | null; agentTexts: string[]; startIndex: number };
  const turns: Turn[] = [];
  let current: Turn = { userText: null, agentTexts: [], startIndex: timelineEntries.length };
  for (let i = 0; i < timelineEntries.length; i++) {
    const e: any = timelineEntries[i];
    const isUserMsg = e.kind === 'agent.message' && e.actor === 'user';
    if (isUserMsg) {
      if (current.userText !== null || current.agentTexts.length > 0) turns.push(current);
      current = { userText: e.text ?? '', agentTexts: [], startIndex: i };
    } else if (e.text) {
      current.agentTexts.push(e.text);
    }
  }
  if (current.userText !== null || current.agentTexts.length > 0) turns.push(current);

  // Render planTasks / planContent. Placement depends on timeline state:
  //   - no user message yet (plan-review-only state) → plan at top
  //   - at least one user message → plan inline after the LAST turn's user prompt
  // The previous behavior floated the plan at the top regardless of state,
  // which made it visually float above every prior turn's prompt + response.
  const renderPlanLines = (): void => {
    if (planTasks && planTasks.length > 0) {
      const statusSymbol: Record<string, string> = { pending: '[ ]', in_progress: '[~]', completed: '[x]', skipped: '[-]' };
      const tasks = planTasks.slice(0, 20);
      out.push({ kind: 'plan', text: 'PLAN TASKS', isFirst: false });
      for (const task of tasks) {
        const marker = statusSymbol[task.status] ?? '[ ]';
        const line = `${marker} ${task.index}. ${task.title}`;
        const wrapped = wrapText(line, textWidth);
        for (let i = 0; i < wrapped.length; i++) out.push({ kind: 'plan', text: wrapped[i]!, isFirst: false });
      }
      out.push({ kind: 'plan', text: '', isFirst: false });
    }
    if (planContent) {
      const planLines = wrapText(planContent, textWidth);
      for (let i = 0; i < planLines.length; i++) out.push({ kind: 'plan', text: planLines[i]!, isFirst: i === 0 });
      out.push({ kind: 'plan', text: '', isFirst: false });
    }
  };

  const hasUserMessage = turns.some((t) => t.userText !== null);

  // Render each turn. Within a turn, push a blank separator between the user
  // prompt and each agent response so consecutive turns read top-to-bottom
  // (matches the old behavior where every timeline entry was rendered with
  // its own separator).
  const theme = ctx.themeName ? getTheme(ctx.themeName) : undefined;
  const streaming = ctx.perTab.streamingText;
  for (let ti = 0; ti < turns.length; ti++) {
    const t = turns[ti]!;
    if (ti > 0) out.push({ kind: 'user', text: '', isFirst: false });
    if (t.userText !== null) {
      const rendered = renderResponse(t.userText, textWidth, theme).map((row: any) => ({ kind: 'user', text: row.text, isFirst: row.isFirst }));
      for (const line of rendered) out.push(line);
      // Separator between user prompt and agent response(s) of the same turn.
      if (t.agentTexts.length > 0) out.push({ kind: 'user', text: '', isFirst: false });
    }
    // Inject the plan immediately after the LAST turn's user prompt (or at
    // the top if no user message exists yet).
    if (ti === turns.length - 1) renderPlanLines();
    for (let ai = 0; ai < t.agentTexts.length; ai++) {
      const agentText = t.agentTexts[ai]!;
      const rendered = renderResponse(agentText, textWidth, theme).map((row: any) => ({ kind: 'agent', text: row.text, isFirst: row.isFirst }));
      for (const line of rendered) out.push(line);
      // Separator between consecutive agent responses within the same turn.
      if (ai < t.agentTexts.length - 1) out.push({ kind: 'user', text: '', isFirst: false });
    }
    // Live-streaming line: pinned inline at the bottom of the CURRENT turn's
    // agent response section, NOT at the absolute bottom of the scrollback.
    // The previous behavior rendered it as a separate slot after all turns +
    // ledger, which made streamed tokens appear visually disconnected from the
    // turn they belong to (especially when intermediate agent.message /
    // agent.decision events arrive in the timeline mid-stream).
    if (ti === turns.length - 1 && streaming && streaming.length > 0) {
      // Only add a separator when an agent response exists above to separate
      // from. A turn whose only content is the user prompt is the streaming
      // line's own row — no separator needed.
      if (t.agentTexts.length > 0) {
        out.push({ kind: 'user', text: '', isFirst: false });
      }
      const wrapped = wrapText(streaming, textWidth);
      for (let i = 0; i < wrapped.length; i++) {
        out.push({ kind: 'streaming', text: wrapped[i]!, isFirst: i === 0, isLast: i === wrapped.length - 1 });
      }
    }
  }
  // No turns at all but a plan exists (plan-review-only state): render plan
  // at the top so the operator can review it.
  if (turns.length === 0 && (planContent || (planTasks && planTasks.length > 0))) {
    renderPlanLines();
  }
  // No turns yet but streaming is active (mid-turn, before the first agent
  // event arrives): render the streaming line at the top.
  if (turns.length === 0 && streaming && streaming.length > 0) {
    const wrapped = wrapText(streaming, textWidth);
    for (let i = 0; i < wrapped.length; i++) {
      out.push({ kind: 'streaming', text: wrapped[i]!, isFirst: i === 0, isLast: i === wrapped.length - 1 });
    }
  }

  // Pending approvals (verbatim from agent-view.ts:159-173).
  if (pendingApprovals && pendingApprovals.length > 0) {
    const aps = pendingApprovals;
    const body = `${aps.length} approval request${aps.length === 1 ? '' : 's'} pending — press 'a' to approve, 'd' to deny`;
    const calloutRows = callout('WARNING', body, textWidth);
    for (let i = 0; i < calloutRows.length; i++) out.push({ kind: 'approval', text: calloutRows[i]!.text, isFirst: i === 0 });
    for (const a of aps) {
      const card = `  ▸ ${a.toolName}  ${a.target || '(no target)'}  ·  ${a.id.slice(-5)}`;
      const wrapped = wrapText(card, textWidth);
      for (let i = 0; i < wrapped.length; i++) out.push({ kind: 'approval', text: wrapped[i]!, isFirst: i === 0 });
    }
  }

  // Pending tool calls (verbatim from agent-view.ts:177-186).
  if (pendingToolCalls && pendingToolCalls.length > 0) {
    out.push({ kind: 'toolCall', text: 'PENDING TOOL CALLS', isFirst: false });
    for (const tc of pendingToolCalls) {
      out.push({ kind: 'toolCall', text: `→ ${tc.name}`, isFirst: true });
      if (tc.summary) out.push({ kind: 'toolCall', text: `  ${tc.summary}`, isFirst: false });
    }
    out.push({ kind: 'toolCall', text: '', isFirst: false });
  }

  // Progress ledger (verbatim from agent-view.ts:192-199).
  if (progressLedger) {
    const ledgerLines = progressLedger.split("\n");
    const cap = ledgerExpanded ? ledgerLines.length : Math.min(3, ledgerLines.length);
    const sliced = ledgerLines.slice(-cap);
    for (const line of sliced) out.push({ kind: 'plan', text: line, isFirst: false });
  }

  return out;
}

/**
 * Build the scrollback line array for the chat view. Same sharing rule as
 * `buildAgentScrollbackLines` — one source of truth.
 */
export function buildChatScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[] {
  const out: ScrollbackLine[] = [];
  const events = (ctx.runtime?.chat?.timeline ?? [])
    .filter((e: any) => e.kind === 'chat.message' || e.kind === 'chat.response');
  let prevKind: 'user' | 'agent' | undefined;
  for (const event of events) {
    const kind: 'user' | 'agent' = event.kind === 'chat.message' ? 'user' : 'agent';
    const needsSeparator = prevKind !== undefined && (kind === 'user' || (kind === 'agent' && prevKind === 'agent'));
    if (needsSeparator) out.push({ kind: 'user', text: '', isFirst: false });
    prevKind = kind;
    if (kind === 'user') {
      const wrapped = wrapText(event.text ?? '', textWidth);
      wrapped.forEach((line, j) => out.push({ kind: 'user', text: line, isFirst: j === 0 }));
    } else {
      const theme = ctx.themeName ? getTheme(ctx.themeName) : undefined;
      renderResponse(event.text ?? '', textWidth, theme).forEach((row: any, j: number) => out.push({ kind: 'agent', text: row.text, isFirst: j === 0 }));
    }
  }
  return out;
}

/** Compute the bottom-anchor offset: the index into the scrollback line array
 *  at which the visible window starts when `pinnedBottom === true`.
 *  Convenience wrapper used by the views' render branch and by app.ts on
 *  End/clear/tab-switch. */
export function computeBottomAnchor(ctx: ViewRenderContext, kind: 'agent' | 'chat'): number {
  const vp = computeViewport(ctx.dimensions, kind);
  const allLines = kind === 'agent' ? buildAgentScrollbackLines(ctx, vp.textWidth) : buildChatScrollbackLines(ctx, vp.textWidth);
  return Math.max(0, allLines.length - vp.scrollbackRows);
}
