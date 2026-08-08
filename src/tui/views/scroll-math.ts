import { wrapText } from './wrap-text.js';
import { renderResponse } from '../blocks/render.js';
import { getTheme } from '../blocks/theme.js';
import type { ScrollbackLine } from './bottom-anchored-viewport.js';
import type { ViewRenderContext } from './types.js';
import type { TimelineEntry } from '../runtime/timeline-builder.js';

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
 * Trim a live-streamed line down to its still-in-flight suffix by stripping
 * any prose that has already landed as a permanent `agent.message` entry in
 * the projected timeline.
 *
 * During a multi-iteration turn, task-loop emits one `agent.message` per
 * iteration as each completes, while the TUI's `streamingText` accumulates
 * every streamed token until the turn folds (app.ts dispatchToSession
 * finally). Without trimming, the live line re-shows iterations that have
 * already landed beside their permanent entries — the in-flight overlap.
 *
 * Only current-turn agent-prose messages (after the last user prompt) are
 * candidates. Text is stripped as a prefix, so the remainder is exactly the
 * current iteration's still-streaming tokens. Pure and re-derived every call
 * from the timeline — no tracking state, safe to run on every sample.
 */
export function trimStreamedTextToLanded(
  timeline: readonly TimelineEntry[],
  streamingText: string | undefined,
): string | undefined {
  if (!streamingText || streamingText.length === 0) return streamingText;
  // The current turn starts at the last user-prompt `agent.message`. Prose
  // before it belongs to past turns and is already fully rendered. Scanned
  // backwards so both passes here are O(current turn), not O(full session) —
  // this runs on the 1s refresh cadence.
  let startIdx = 0;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i]!;
    if (e.kind === 'agent.message' && e.actor === 'user') { startIdx = i + 1; break; }
  }
  let rest = streamingText;
  for (let i = startIdx; i < timeline.length; i++) {
    const e = timeline[i]!;
    if (
      e.kind === 'agent.message' &&
      e.actor === 'agent' &&
      typeof e.text === 'string' &&
      e.text.length > 0 &&
      rest.startsWith(e.text)
    ) {
      rest = rest.slice(e.text.length);
    }
  }
  return rest.length > 0 ? rest : undefined;
}

/**
 * Build the scrollback line array for the agent view. Pure function over
 * `ctx.runtime.agent` + `ctx.perTab` (planTasks, planContent, currentIntent)
 * — same inputs the view's `render` consumes, so the array length matches
 * what the next paint will slice. The pending-approval banner is owned by
 * `frame-painter.ts` (it surfaces pendingApprovals on the status row),
 * not by the scrollback builder.
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
 *
 * #434 — tool calls in the stream with outcomes. The bottom-pinned
 * pending-tool-call section is gone. Each tool lifecycle event is
 * rendered inline at the moment it happens, in chronological order:
 *   - `tool.started`  → `→ toolname` invocation line (first of stage if
 *     no other content has claimed the gutter for this stage).
 *   - `tool.completed` → `✓ toolname — <detail>` result line.
 *   - `tool.failed`   → `✗ toolname — <detail>` result line.
 * Both invocation and result render under the same stage's gutter —
 * the invocation gets the gutter label, the result is a continuation.
 * Result lines never insert mid-stream because tool calls execute
 * strictly sequentially (assumption pinned by an append-only invariant
 * test). The `perTab.pendingToolCalls` data flow still arrives from
 * the snapshot but is no longer rendered; #435 will subsume it.
 */
/** T6 — C1 observability: classify context lifecycle events by display signal.
 *  HIGH — assembled / preflight.failed / irreducible — always shown.
 *  LOW  — snapshot.created / budget.computed — lower-signal, filterable by the
 *         operator (future filter toggle; always shown for now). */
export function classifyContextEventSignal(kind: string): 'HIGH' | 'LOW' | null {
  switch (kind) {
    case 'context.assembled':
    case 'context.preflight.failed':
    case 'context.irreducible':
      return 'HIGH';
    case 'context.snapshot.created':
    case 'context.budget.computed':
      return 'LOW';
    default:
      return null;
  }
}

export function buildAgentScrollbackLines(ctx: ViewRenderContext, textWidth: number): ScrollbackLine[] {
  const out: ScrollbackLine[] = [];
  const planTasks = ctx.perTab.planTasks;
  const planContent = ctx.perTab.planContent;

  // Group timeline entries by turn. A turn starts with a user `agent.message`
  // and contains every subsequent agent entry until the next user message.
  // The plan (planTasks/planContent) belongs to the CURRENT turn — the one in
  // flight or just completed — so it renders AFTER that turn's user prompt,
  // not at the top of the scrollback where it would visually float above
  // every previous turn.
  //
  // #434: tool.started / tool.completed / tool.failed are admitted here so
  // the line builder can render them chronologically. tool.requested and
  // tool.output are admitted to the timeline projection (whitelist
  // vocabulary) but rejected by this render-layer filter — they are
  // internal lifecycle events that the scrollback does not display.
  // #436: `approval.requested` is admitted so approvals render inline
  // and chronologically like every other content event. The pending
  // banner that names tool/target is painted in frame-painter.ts on the
  // status row, separately.
  const rawEntries = (ctx.runtime?.agent?.timeline ?? [])
    .filter((e: any) =>
      // `agent.reasoning` is intentionally NOT in this filter. The task-loop
      // emits a `agent.reasoning` event per iteration whose `text` is the
      // first 500 chars of the same model output that just landed in
      // `agent.message` — it is a metadata breadcrumb (iteration + tool
      // names), not prose content. Admitting it here rendered every
      // response twice (and three times when the final summary's
      // `agent.response` matched). Reasoning still appears in the EventLog
      // audit trail; the scrollback just doesn't show it.
      e.kind === 'agent.message' ||
      e.kind === 'agent.decision' ||
      e.kind === 'agent.response' ||
      e.kind === 'agent.session.phase_changed' ||
      e.kind === 'agent.session.turn.completed' ||
      e.kind === 'tool.started' ||
      e.kind === 'tool.completed' ||
      e.kind === 'tool.failed' ||
      e.kind === 'approval.requested' ||
      // T6 — C1 observability: context lifecycle events (all five admitted;
      // HIGH-value always shown, LOW-value can be filtered by the operator).
      e.kind === 'context.snapshot.created' ||
      e.kind === 'context.budget.computed' ||
      e.kind === 'context.assembled' ||
      e.kind === 'context.preflight.failed' ||
      e.kind === 'context.irreducible');

  // Final-summary / last-iteration prose dedup. The TUI's final `agent.response`
  // (app.ts:822 emitTimelineLog) carries the same text as the last iteration's
  // `agent.message` (task-loop.ts:462-464 emitAgent). Without this dedup the
  // final answer renders twice — once as the last iteration's prose, once as
  // the per-turn summary. We drop the trailing `agent.response` only when its
  // text equals the most recent *prose* `agent.message` *within the same
  // turn*; intervening metadata entries (`agent.decision`,
  // `agent.session.phase_changed`, `agent.session.turn.completed`, tool
  // lifecycle) are skipped over. The scan stops at any user `agent.message`
  // (turn boundary — a new user prompt is a fresh turn with its own summary)
  // or any prior `agent.response` (per-turn boundary — earlier turn's
  // summary). Direct-route turns (no preceding in-turn `agent.message`) keep
  // their `agent.response` because nothing would dedup it — and the
  // text-comparison guard means summaries that diverge from the iteration
  // prose (e.g. `(no response)` sentinels) survive.
  const timelineEntries: any[] = [];
  for (const e of rawEntries) {
    if (
      e.kind === 'agent.response' &&
      typeof e.text === 'string' &&
      e.text.length > 0
    ) {
      let lastProseIdx = -1;
      for (let j = timelineEntries.length - 1; j >= 0; j--) {
        const prev = timelineEntries[j]!;
        // Turn boundary: a user prompt starts a fresh turn — its
        // `agent.response` must NEVER dedup against prose from a previous
        // turn even if the text happens to match.
        if (prev.kind === 'agent.message' && prev.actor === 'user') break;
        // Per-turn boundary: a prior `agent.response` closed an earlier
        // turn; further back entries belong to that turn.
        if (prev.kind === 'agent.response') break;
        // Only `agent.message` from the agent (not user prompts) is prose
        // for this purpose. Tool.* entries carry text (the tool name) but
        // they aren't agent prose; if we compared against them we'd dedup
        // legitimate summaries that happen to match a tool name by
        // coincidence — vanishingly unlikely with real data but worth
        // pinning.
        if (
          prev.kind === 'agent.message' &&
          prev.actor === 'agent' &&
          typeof prev.text === 'string' &&
          prev.text.length > 0
        ) {
          lastProseIdx = j;
          break;
        }
      }
      if (lastProseIdx >= 0 && timelineEntries[lastProseIdx]!.text === e.text) {
        continue;
      }
    }
    timelineEntries.push(e);
  }

  // Stage tracking (#432). A stage is the interval between two consecutive
  // phase_changed events; the final stage of a turn is terminated by
  // turn_completed. A re-entered phase renders as a separate occurrence
  // because each phase_changed emits a fresh StageState instance.
  //
  // #434: tool events are treated as CONTENT events for stage attribution.
  // A tool.started that arrives under a running stage is the first content
  // of that stage if no other content has yet claimed the gutter. This
  // makes the invocation line the first content row of the stage, which
  // is what the "tool under stage" pattern from spec #429 calls for.
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
    // #434: tool events are content, but the line builder distinguishes
    // them so it can pick the right marker and the right
    // first-line-of-stage behaviour. `kind: 'toolCall'` for tool events
    // (the existing 'toolCall' ScrollbackLine kind) and 'agent' for
    // prose responses. The kind is passed through to the ScrollbackLine
    // so the view's existing renderToolCallLine can pick them up.
    // #436: approvals render inline with the same pattern. They use
    // the existing 'approval' ScrollbackLine kind painted by
    // AgentView.renderApprovalLine (yellow text + gutter when present).
    lineKind: 'agent' | 'toolCall' | 'approval' | 'context';
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
    // TimelineEntry.startedAt is a required number per the projection contract.
    // Earlier drafts fell back to Date.parse(e.timestamp) for defensive
    // robustness, but the fallback masked missing-startedAt bugs and produced
    // zero-duration stages that were hard to debug. Trust the type.
    const ts: number = e.startedAt;
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
    } else if (e.kind === 'tool.started') {
      // #434: invocation line. Render as content attributed to the
      // current stage. If a stage is running, the invocation may be
      // the first content of that stage (gutter label) — but only
      // when the stage has not yet produced any content.
      const toolName = typeof e.text === 'string' ? e.text : '';
      const detail = typeof e.detail === 'string' ? e.detail : '';
      const text = detail ? `→ ${toolName} ${detail}` : `→ ${toolName}`;
      if (currentStage) {
        const isFirstOfStage = !currentStage.hasContent;
        current.contents.push({ text, stage: currentStage, isFirstOfStage, lineKind: 'toolCall' });
        currentStage.hasContent = true;
      } else {
        current.contents.push({ text, stage: null, isFirstOfStage: false, lineKind: 'toolCall' });
      }
    } else if (e.kind === 'tool.completed' || e.kind === 'tool.failed') {
      // #434: result line. Success uses `✓`; failure uses `✗`. The
      // toolName comes from `text` (mapped by TimelineBuilder.build for
      // tool.* events); the outcome detail comes from `detail` (error
      // for failed, outputPreview for completed). A result line is
      // ALWAYS a continuation within the same stage as its invocation,
      // because tool execution is strictly sequential and the result
      // arrives after the started event under the same running stage.
      const isFailure = e.kind === 'tool.failed';
      const marker = isFailure ? '✗' : '✓';
      const toolName = typeof e.text === 'string' ? e.text : '';
      const outcome = typeof e.detail === 'string' ? e.detail : '';
      const text = outcome ? `${marker} ${toolName} — ${outcome}` : `${marker} ${toolName}`;
      if (currentStage) {
        // Result line is a continuation of the stage — not first-of-stage
        // even if no other content was attributed (the invocation has
        // already claimed that slot). The result renders under the same
        // gutter label as the invocation.
        //
        // The `hasContent = true` mutation below looks redundant (the
        // invocation already set it), but it is INTENTIONAL: a tool
        // completion is still content arriving in the stage. The flag
        // is correctly carrying the "any content has been attributed to
        // this stage" invariant, not "the gutter slot has been claimed."
        // Do NOT move this assignment later — it is the load-bearing
        // signal that a subsequent tool.started in this stage is NOT
        // first-of-stage and therefore does not steal the gutter from
        // this result's invocation.
        //
        // Edge case: a tool.completed / tool.failed that arrives WITHOUT
        // a preceding tool.started will still flow through this branch
        // (the timeline is permissive). In that case `hasContent` was
        // false, `isFirstOfStage` becomes true, and the result becomes
        // first-of-stage — which means the result carries the gutter
        // label. This is rare (the executor emits started before
        // completed) but is exercised by the regression test
        // "tool.completed without preceding tool.started".
        const isFirstOfStage = !currentStage.hasContent;
        current.contents.push({ text, stage: currentStage, isFirstOfStage, lineKind: 'toolCall' });
        currentStage.hasContent = true;
      } else {
        // Tool result with no active stage (e.g. pre-stage turn). Render
        // with a blank gutter; the result still goes here so the
        // outcome isn't lost.
        current.contents.push({ text, stage: null, isFirstOfStage: false, lineKind: 'toolCall' });
      }
    } else if (e.kind === 'approval.requested') {
      // #436 — inline approval. Render chronologically under the
      // running stage; the text comes from `payload.prompt` (mapped to
      // `text` by TimelineBuilder.build). The pending banner surfaces
      // toolName/target separately on the status row so the keys always
      // name their target, even if the operator has scrolled past the
      // inline line.
      const prompt = typeof e.text === 'string' ? e.text : 'approval requested';
      const text = `⏸ ${prompt}`;
      if (currentStage) {
        const isFirstOfStage = !currentStage.hasContent;
        current.contents.push({ text, stage: currentStage, isFirstOfStage, lineKind: 'approval' });
        currentStage.hasContent = true;
      } else {
        current.contents.push({ text, stage: null, isFirstOfStage: false, lineKind: 'approval' });
      }
    } else if (e.kind.startsWith('context.')) {
      // T6 — C1 observability: context lifecycle events. Render as
      // informational lines with the 'context' lineKind so the view can
      // style them differently (HIGH = prominent, LOW = muted).
      // Text is pre-formatted by TimelineBuilder.build.
      const cText = typeof e.text === 'string' ? e.text : e.kind;
      // HIGH-value events get the 'agent' lineKind so they appear in
      // the normal content flow; LOW-value events use a new 'context'
      // lineKind that the agent-view paints subtly (grey).
      const signal = classifyContextEventSignal(e.kind);
      const lk: 'agent' | 'context' = signal === 'LOW' ? 'context' : 'agent';
      if (currentStage) {
        const isFirstOfStage = !currentStage.hasContent;
        current.contents.push({ text: cText, stage: currentStage, isFirstOfStage, lineKind: lk });
        currentStage.hasContent = true;
      } else {
        current.contents.push({ text: cText, stage: null, isFirstOfStage: false, lineKind: lk });
      }
    } else if (e.text) {
      // Content event. If a stage is active, attribute to it. Content
      // arriving before any phase_changed in a turn (pre-stage) has no
      // stage attribution — it renders with a blank gutter.
      if (currentStage) {
        const isFirstOfStage = !currentStage.hasContent;
        current.contents.push({ text: e.text, stage: currentStage, isFirstOfStage, lineKind: 'agent' });
        currentStage.hasContent = true;
      } else {
        current.contents.push({ text: e.text, stage: null, isFirstOfStage: false, lineKind: 'agent' });
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
  //
  // Stage attribution is applied to the LAST turn only — earlier turns keep
  // flat rendering against the blank gutter. Rationale: stages are a
  // forward-looking signal (the in-flight run); older turns' stages are
  // historical record and don't need to be re-rendered for the operator.
  // The scrollback remains append-only: the gutter is decoration, not a
  // header line; no extra rows are inserted.
  const formatGutter = (phaseName: string): string => {
    const upper = (phaseName || '').toUpperCase();
    return '  ' + upper.slice(0, GUTTER_WIDTH - 2).padEnd(GUTTER_WIDTH - 2);
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
   *  right-aligned to `width`. Behaviour:
   *    - If the first wrap line has room for `text + duration`, the duration
   *      sits at the right edge of the first wrap line and the rest of the
   *      text occupies its natural wrap.
   *    - If the first wrap line is already at width, the duration is appended
   *      after the text and `wrapText` is reapplied — the duration may then
   *      end up on a subsequent wrap line. The duration is never truncated;
   *      visibility is the priority over anchoring to the first line. */
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
        // #434: tool events carry their own pre-formatted text with the
        // →/✓/✗ marker already in `item.text` — they should not pass
        // through `renderResponse` (which is markdown-aware and would
        // mangle the marker characters). Render verbatim with a single
        // wrap to textWidth.
        //
        // wrapText vs renderResponse divergence: tool lines use plain
        // wrapText so the leading marker survives as a literal character.
        // renderResponse is markdown-aware for agent prose — it would
        // interpret `→` as text (fine) but `✓`/`✗` could be misread as
        // list items or otherwise mutated. Keep the paths separate; do
        // not unify them without re-testing both surface areas.
        if (item.lineKind === 'toolCall') {
          const wrapped = wrapText(item.text, textWidth);
          preRows = wrapped.map((t, i) => ({ text: t, isFirst: i === 0 }));
        } else {
          const rendered = renderResponse(item.text, textWidth, theme).map((row: any) => ({ text: row.text, isFirst: row.isFirst }));
          preRows = rendered;
        }
      }
      for (const row of preRows) {
        // #434: toolCall items emit ScrollbackLine.kind = 'toolCall' so
        // the view's existing renderToolCallLine can paint them with the
        // right styling. Other content uses 'agent' as before.
        // #436: approval items emit ScrollbackLine.kind = 'approval' so
        // the view's existing renderApprovalLine paints them yellow
        // (33m) — the lineBuilder owns the prompt text, the view owns
        // the styling. Without this routing, approvals would render in
        // the agent cyan palette and the yellow marker would be lost.
        const line: ScrollbackLine = {
          kind: item.lineKind,
          text: row.text,
          isFirst: row.isFirst,
        };
        if ((row as any).gutter) line.gutter = (row as any).gutter;
        out.push(line);
      }
      // Separator between consecutive content items within the same turn.
      if (ai < t.contents.length - 1) out.push({ kind: 'user', text: '', isFirst: false });
    }
    // Live-streaming line: pinned inline at the bottom of the CURRENT turn's
    // agent response section, NOT at the absolute bottom of the scrollback.
    // The previous behavior rendered it as a separate slot after all turns,
    // which made streamed tokens appear visually disconnected from the turn
    // they belong to (especially when intermediate agent.message /
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

  // #436 — the bottom "X approval requests pending — press 'a' to approve"
// callout block is retired. Approvals render inline and chronologically via
// the timeline `approval.requested` branch above; the pending banner in
// frame-painter.ts surfaces any pending approval on the status row.

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
