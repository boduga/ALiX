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
 *
 * #432 — stage labels and durations. The line builder is the SOLE producer
 * of stage attribution: it walks the timeline once, builds turn + stage
 * state, and decorates the FIRST content line of each stage in the LAST
 * turn with `l.gutter = "  STAGE"` plus a right-padded duration. Earlier
 * turns keep flat rendering against the blank gutter. A stage that
 * completes having produced no output drops out entirely; a running stage
 * with no content yet renders a bare gutter row carrying its ticker.
 */
export function buildAgentScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[] {
  const out: ScrollbackLine[] = [];
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
    .filter((e: any) =>
      e.kind === 'agent.message' ||
      e.kind === 'agent.reasoning' ||
      e.kind === 'agent.decision' ||
      e.kind === 'agent.response' ||
      e.kind === 'agent.session.phase_changed' ||
      e.kind === 'agent.session.turn.completed');

  // Stage tracking (#432). A stage is the interval between two consecutive
  // phase_changed events; the final stage of a turn is terminated by
  // turn_completed. A re-entered phase renders as a separate occurrence
  // because each phase_changed emits a fresh StageState instance.
  type StageState = {
    name: string;          // phase name as it appeared in the timeline entry's `text`
    startedAt: number;     // ms timestamp of the phase_changed event
    closedAt: number;      // ms timestamp of the closing event; Date.now() while running
    hasContent: boolean;   // true once any content event has been attributed to this stage
    isRunning: boolean;    // true until the stage is closed by another phase or turn_completed
  };
  type ContentItem = {
    text: string;
    stage: StageState | null;  // null when content arrived before any stage in the turn
    isFirstOfStage: boolean;
  };
  type TurnBuild = {
    userText: string | null;
    contents: ContentItem[];
    startIndex: number;
  };

  const turns: TurnBuild[] = [];
  let current: TurnBuild = { userText: null, contents: [], startIndex: timelineEntries.length };
  // Track the active stage across the whole timeline so a running stage
  // survives its producing turn until turn_completed closes it. Reset on
  // a user message — the next turn starts with no current stage.
  let currentStage: StageState | null = null;

  for (let i = 0; i < timelineEntries.length; i++) {
    const e: any = timelineEntries[i];
    const ts: number = typeof e.startedAt === 'number' ? e.startedAt : Date.parse(e.timestamp) || 0;
    const isUserMsg = e.kind === 'agent.message' && e.actor === 'user';
    if (isUserMsg) {
      // Close the active stage at the user message's timestamp; a new turn
      // begins with no current stage.
      if (currentStage && currentStage.isRunning) {
        currentStage.closedAt = ts;
        currentStage.isRunning = false;
      }
      currentStage = null;
      if (current.userText !== null || current.contents.length > 0) turns.push(current);
      current = { userText: e.text ?? '', contents: [], startIndex: i };
    } else if (e.kind === 'agent.session.phase_changed') {
      // Close previous stage at this event's timestamp; it either had
      // content (its first-content line carries the duration) or did not
      // (it drops out entirely). Start a fresh stage with this phase.
      if (currentStage && currentStage.isRunning) {
        currentStage.closedAt = ts;
        currentStage.isRunning = false;
      }
      currentStage = {
        name: typeof e.text === 'string' ? e.text : '',
        startedAt: ts,
        closedAt: ts,   // provisional; reset to Date.now() while running
        hasContent: false,
        isRunning: true,
      };
    } else if (e.kind === 'agent.session.turn.completed') {
      // Terminate the final stage of the turn.
      if (currentStage && currentStage.isRunning) {
        currentStage.closedAt = ts;
        currentStage.isRunning = false;
      }
    } else if (e.text) {
      // Content event. If a stage is active, attribute to it. Content
      // arriving before any phase_changed in a turn (pre-stage) has no
      // stage attribution — it renders with a blank gutter.
      if (currentStage) {
        const isFirstOfStage = !currentStage.hasContent;
        current.contents.push({ text: e.text, stage: currentStage, isFirstOfStage });
        currentStage.hasContent = true;
      } else {
        current.contents.push({ text: e.text, stage: null, isFirstOfStage: false });
      }
    }
  }
  if (current.userText !== null || current.contents.length > 0) turns.push(current);

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

  // Stage decoration (#432). The label is a 2-space indent + the uppercase
  // phase name right-padded to GUTTER_WIDTH. The duration is `· X.Ys` for
  // completed stages, `· Xs…` for running ones. Appended to the FIRST wrap
  // line of the first content event in a stage; subsequent wrap lines and
  // subsequent content events leave the gutter blank.
  const formatGutter = (phaseName: string): string => {
    const upper = (phaseName || '').toUpperCase();
    return '  ' + upper.padEnd(GUTTER_WIDTH - 2).slice(0, GUTTER_WIDTH - 2);
  };
  const formatCompletedDuration = (startedAt: number, closedAt: number): string => {
    const sec = Math.max(0, (closedAt - startedAt) / 1000);
    return `· ${sec.toFixed(1)}s`;
  };
  const formatRunningDuration = (startedAt: number, now: number): string => {
    const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
    return `· ${sec}s…`;
  };
  /** Append a duration string to the right of the FIRST wrap line of `text`,
   *  right-aligned to `width`. If the text would overflow after appending
   *  the duration, the duration is hard-truncated so the row still ends
   *  with the duration marker — the rest of the text still occupies its
   *  natural wrap. The duration never crosses to subsequent lines: it is
   *  the last token on the first wrap line. */
  const appendDurationToFirstLine = (
    text: string,
    duration: string,
    width: number,
  ): { lines: string[]; isFirst: boolean[] } => {
    if (width <= 0 || !text) return { lines: [text], isFirst: [true] };
    if (!duration) return { lines: wrapText(text, width), isFirst: wrapText(text, width).map((_, i) => i === 0) };
    // Wrap the text alone first, then append duration to first wrap line.
    const wrapped = wrapText(text, width);
    if (wrapped.length === 0) return { lines: [''], isFirst: [true] };
    const first = wrapped[0]!;
    // Compute available room on the first wrap line for the duration.
    const durLen = duration.length;
    const maxFirstLineLen = Math.max(1, width);
    if (first.length + durLen <= maxFirstLineLen) {
      const padLen = maxFirstLineLen - first.length - durLen;
      const padded = (first + ' '.repeat(padLen) + duration).slice(0, maxFirstLineLen);
      return { lines: [padded, ...wrapped.slice(1)], isFirst: [true, ...wrapped.slice(1).map(() => false)] };
    }
    // First wrap line already at width; append duration and let wrap
    // handle overflow onto a fresh trailing line.
    const padded = first + ' '.repeat(Math.max(0, width - first.length)) + duration;
    const rewrapped = wrapText(padded, width);
    return { lines: rewrapped, isFirst: rewrapped.map((_, i) => i === 0) };
  };

  // Render each turn. Within a turn, push a blank separator between the user
  // prompt and each agent response so consecutive turns read top-to-bottom
  // (matches the old behavior where every timeline entry was rendered with
  // its own separator).
  const theme = ctx.themeName ? getTheme(ctx.themeName) : undefined;
  const streaming = ctx.perTab.streamingText;
  const now = Date.now();
  const lastTurnIdx = turns.length - 1;
  for (let ti = 0; ti < turns.length; ti++) {
    const t = turns[ti]!;
    if (ti > 0) out.push({ kind: 'user', text: '', isFirst: false });
    if (t.userText !== null) {
      const rendered = renderResponse(t.userText, textWidth, theme).map((row: any) => ({ kind: 'user', text: row.text, isFirst: row.isFirst }));
      for (const line of rendered) out.push(line);
      // Separator between user prompt and agent response(s) of the same turn.
      if (t.contents.length > 0) out.push({ kind: 'user', text: '', isFirst: false });
    }
    // Inject the plan immediately after the LAST turn's user prompt (or at
    // the top if no user message exists yet).
    if (ti === turns.length - 1) renderPlanLines();
    for (let ai = 0; ai < t.contents.length; ai++) {
      const item = t.contents[ai]!;
      const isLastTurn = ti === lastTurnIdx;
      const applyStage = isLastTurn && item.stage && item.isFirstOfStage;
      let preRows: Array<{ text: string; isFirst: boolean }>;
      if (applyStage) {
        const stage = item.stage!;
        const duration = stage.isRunning
          ? formatRunningDuration(stage.startedAt, now)
          : formatCompletedDuration(stage.startedAt, stage.closedAt);
        const appended = appendDurationToFirstLine(item.text, duration, textWidth);
        preRows = appended.lines.map((t, i) => ({ text: t, isFirst: i === 0 && appended.isFirst[0] === true }));
        // First row of the wrapped content gets the gutter label.
        if (preRows.length > 0) {
          (preRows[0] as any).gutter = formatGutter(stage.name);
        }
      } else {
        const rendered = renderResponse(item.text, textWidth, theme).map((row: any) => ({ text: row.text, isFirst: row.isFirst }));
        preRows = rendered;
      }
      for (const row of preRows) {
        const line: ScrollbackLine = { kind: 'agent', text: row.text, isFirst: row.isFirst };
        if ((row as any).gutter) line.gutter = (row as any).gutter;
        out.push(line);
      }
      // Separator between consecutive agent responses within the same turn.
      if (ai < t.contents.length - 1) out.push({ kind: 'user', text: '', isFirst: false });
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
      if (t.contents.length > 0) {
        out.push({ kind: 'user', text: '', isFirst: false });
      }
      // If the current stage has not yet produced any content event, the
      // streaming line is the first content of the running stage — apply
      // the gutter + running duration.
      const applyStageToStream = currentStage && !currentStage.hasContent;
      let streamLines: string[];
      if (applyStageToStream) {
        const stage = currentStage!;
        const duration = formatRunningDuration(stage.startedAt, now);
        const appended = appendDurationToFirstLine(streaming!, duration, textWidth);
        streamLines = appended.lines;
        for (let i = 0; i < streamLines.length; i++) {
          const sl: ScrollbackLine = {
            kind: 'streaming',
            text: streamLines[i]!,
            isFirst: i === 0,
            isLast: i === streamLines.length - 1,
          };
          if (i === 0) sl.gutter = formatGutter(stage.name);
          out.push(sl);
        }
        // Mark the running stage as having produced content so subsequent
        // renders don't double-attribute gutter.
        currentStage!.hasContent = true;
      } else {
        const wrapped = wrapText(streaming!, textWidth);
        for (let i = 0; i < wrapped.length; i++) {
          out.push({ kind: 'streaming', text: wrapped[i]!, isFirst: i === 0, isLast: i === wrapped.length - 1 });
        }
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

  // Bare-running-stage row (#432). A stage that is still active and has
  // produced no output yet renders a single gutter row carrying its
  // ticking timer. Skipped when streaming is non-empty (the streaming
  // line carries the same decoration), and skipped when the stage has
  // already emitted content. Appended at the very bottom of the agent
  // scrollback so the operator sees the stage is alive during a silent
  // step rather than mistaking it for a frozen tab.
  if (
    currentStage &&
    currentStage.isRunning &&
    !currentStage.hasContent &&
    (!streaming || streaming.length === 0)
  ) {
    const duration = formatRunningDuration(currentStage.startedAt, now);
    // Single row: gutter label + timer text. Right-padding puts the
    // duration at the wrap width's right edge so it stays in column.
    const timerText = duration;
    const padded = timerText.padEnd(Math.max(1, textWidth)).slice(0, Math.max(1, textWidth));
    out.push({
      kind: 'agent',
      text: padded,
      isFirst: false,
      gutter: formatGutter(currentStage.name),
    });
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
