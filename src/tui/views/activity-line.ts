// src/tui/views/activity-line.ts
//
// Pure presentation helpers for the live response-surface activity indicator
// (Task 3 — `◐ Thinking… 4s` / `⚙ Running shell.run… 3s` / `Still working…`).
//
// These functions are STRICTLY client-side. They consume the runtime's
// `agent.session.activity` state (`AgentActivity` — read-only, comes from
// `ctx.snap.session.activity`) and compute elapsed time + spinner frames
// from the wall clock at render time. They never emit runtime events, never
// touch token accounting, and carry no mutable state of their own — the
// spinner frame is derived deterministically from elapsed seconds, so the
// ~1s tick of the existing render cadence animates it for free.
//
// See spec "2026-09-06-alix-live-response-activity" Unit D (Tasks 3.1-3.5)
// and Test 7.10 (spinner isolation).

import type { AgentActivity, AgentActivityState } from '../../agent/agent-activity.js';

/** Spinner glyphs, cycled once per second (Task 3.3). */
export const ACTIVITY_SPINNER_FRAMES = ['◐', '◓', '◑', '◒'] as const;

/** Human-friendly elapsed time for the indicator — "4s", "2m 14s", "1h 05m". */
export function formatActivityElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The spinner frame for an elapsed duration. Pure function of elapsed time:
 * one frame advance per second, cycling `ACTIVITY_SPINNER_FRAMES`. No counter,
 * no interval, no render-time mutation — the 1s TUI refresh cadence animates
 * the glyph by re-deriving the index from `now`.
 */
export function activitySpinnerFrame(elapsedMs: number): string {
  const sec = Math.max(0, Math.floor(elapsedMs / 1000));
  return ACTIVITY_SPINNER_FRAMES[sec % ACTIVITY_SPINNER_FRAMES.length]!;
}

/**
 * True for the live transient states the response surface renders as an
 * activity indicator. Streaming is excluded (streamed text replaces the
 * indicator on the first token — Task 3.5); terminal states (completed /
 * failed / cancelled) are excluded because the existing completion lines
 * (`✓` / `✗` / turn summary) take over — never a permanent spinner.
 * `cancelling` is transient: it renders only while the cancelled turn is
 * unwinding, then the summary line (`Cancelled after 4m 12s`) takes over.
 */
export function isTransientActivityState(state: AgentActivityState): boolean {
  switch (state) {
    case 'thinking':
    case 'waiting_for_provider':
    case 'tool_running':
    case 'verifying':
    case 'summarizing':
    case 'possibly_stalled':
    case 'cancelling':
      return true;
    case 'streaming':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return false;
  }
}

/**
 * Format one transient activity indicator line from the runtime activity
 * record + wall clock, e.g.:
 *   `◐ Thinking… 18s`
 *   `⚙ Running shell.run… 3s`
 *   `◓ Still working… 2m 14s`   ← possibly_stalled, non-alarming language
 *
 * Returns `undefined` for non-transient states (streaming / terminal) so the
 * caller renders nothing in those cases. Elapsed is computed locally
 * (`now - activity.startedAt`) — no runtime event is emitted per tick.
 *
 * `frame` defaults to the spinner frame derived from elapsed seconds; a
 * caller that renders with a fixed frame (tests) may pass one explicitly.
 */
export function formatActivityLine(
  activity: AgentActivity,
  now: number,
  frame?: string,
): string | undefined {
  if (!activity || !isTransientActivityState(activity.state)) return undefined;
  const elapsedMs = Math.max(0, now - activity.startedAt);
  const glyph = frame ?? activitySpinnerFrame(elapsedMs);
  const elapsed = formatActivityElapsed(elapsedMs);
  switch (activity.state) {
    case 'thinking':
    case 'waiting_for_provider':
      return `${glyph} Thinking… ${elapsed}`;
    case 'tool_running': {
      // Round 1 — the tool timer starts at TOOL start: elapsed runs from
      // toolStartedAt (stamped entering tool_running), falling back to the
      // invocation's startedAt for records created before the field existed.
      const toolStart = activity.toolStartedAt ?? activity.startedAt;
      const toolElapsed = formatActivityElapsed(Math.max(0, now - toolStart));
      return `⚙ Running ${activity.toolName ?? 'tool'}… ${toolElapsed}`;
    }
    case 'verifying':
      return `${glyph} Verifying… ${elapsed}`;
    case 'summarizing':
      return `${glyph} Summarizing… ${elapsed}`;
    case 'possibly_stalled':
      return `${glyph} Still working… ${elapsed}`;
    case 'cancelling':
      // Task 6.2 — operator cancel requested: rendered live while the turn
      // unwinds (`◐ Cancelling… 4m 12s`). Replaced by the timeline's
      // `Cancelled after 4m 12s` summary once the turn resolves — never a
      // permanent spinner.
      return `${glyph} Cancelling… ${elapsed}`;
    case 'streaming':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return undefined;
  }
}