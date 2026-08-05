import { wrapText } from './wrap-text.js';
import { renderResponse } from '../blocks/render.js';
import { callout } from '../ui-helpers.js';
import { getTheme } from '../blocks/theme.js';
import type { ScrollbackLine } from './bottom-anchored-viewport.js';
import type { ViewRenderContext } from './types.js';

/** Shared TUI layout geometry. Single source of truth — the views, app.ts,
 *  and scroll-math all compute panelRow/scrollbackTop/textWidth from these.
 *  FOOTER_H = 3 (tabs row + status row + padding). PANEL_H is the future
 *  multi-line input-panel knob (0 today — single-line prompt). */
export const HEADER_H = 3;
export const FOOTER_H = 3;
export const PANEL_H = 0;
/** Scrollback starts below the agent tab's status row (agent=6: header rows
 *  0-2, blank 3, status 4, blank 5). Chat has no status row, so 5. */
export const SCROLLBACK_TOP_AGENT = 6;
export const SCROLLBACK_TOP_CHAT = 5;

export interface Viewport {
  headerRows: number;
  footerRows: number;
  panelRows: number;
  panelRow: number;
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
  const footerRows = FOOTER_H;
  const panelRow = Math.max(0, dims.rows - FOOTER_H - PANEL_H - 1);
  const scrollbackTop = kind === 'agent' ? SCROLLBACK_TOP_AGENT : SCROLLBACK_TOP_CHAT;
  const scrollbackBottom = panelRow - 1;
  return {
    headerRows: HEADER_H,
    footerRows,
    panelRows: PANEL_H,
    panelRow,
    scrollbackTop,
    scrollbackBottom,
    scrollbackRows: Math.max(0, scrollbackBottom - scrollbackTop + 1),
    textWidth: Math.max(0, dims.columns - 4),
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

  // Plan task checklist (verbatim from agent-view.ts:109-128).
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

  // Plan content (verbatim from agent-view.ts:132-139).
  if (planContent) {
    const planLines = wrapText(planContent, textWidth);
    for (let i = 0; i < planLines.length; i++) out.push({ kind: 'plan', text: planLines[i]!, isFirst: i === 0 });
    out.push({ kind: 'plan', text: '', isFirst: false });
  }

  // Turns (verbatim from agent-view.ts:86-95, 141-153).
  const turns = (ctx.runtime?.agent?.timeline ?? [])
    .filter((e: any) => e.kind === 'agent.message' || e.kind === 'agent.reasoning' || e.kind === 'agent.decision' || e.kind === 'agent.response')
    .map((e: any) => {
      const operator = e.kind === 'agent.message' && e.actor === 'user';
      return { kind: operator ? 'user' : 'agent', text: e.text ?? '' };
    });
  for (let ti = 0; ti < turns.length; ti++) {
    const t = turns[ti]!;
    if (ti > 0) out.push({ kind: t.kind, text: '', isFirst: false });
    const theme = ctx.themeName ? getTheme(ctx.themeName) : undefined;
    const rendered = renderResponse(t.text, textWidth, theme).map((row: any) => ({ kind: t.kind, text: row.text, isFirst: row.isFirst }));
    for (const line of rendered) out.push(line);
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
