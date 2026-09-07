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
import { formatActivityElapsed } from '../../agent/agent-activity.js';

/** Spinner glyphs, cycled once per second (Task 3.3). */
export const ACTIVITY_SPINNER_FRAMES = ['◐', '◓', '◑', '◒'] as const;

/**
 * Rendered label per activity state, with `null` for the states that never
 * show a live indicator. The non-null membership IS the transient
 * classification: `isTransientActivityState` and `formatActivityLine` both
 * derive their behaviour from this single map, so a new union member fails
 * compilation here (missing key) rather than silently relying on
 * `noImplicitReturns` in two restated switches.
 *
 * `tool_running` keeps the bare label ('Running'); the running line inserts
 * the tool name (and trailing ellipsis) between the label and its elapsed.
 * The remaining transient labels already end in '…' and are rendered
 * verbatim after the spinner glyph.
 */
const ACTIVITY_STATE_LABELS: Readonly<Record<AgentActivityState, string | null>> = {
  thinking: 'Thinking…',
  streaming: null,
  tool_running: 'Running',
  waiting_for_provider: 'Thinking…',
  verifying: 'Verifying…',
  summarizing: 'Summarizing…',
  possibly_stalled: 'Still working…',
  cancelling: 'Cancelling…',
  completed: null,
  failed: null,
  cancelled: null,
};

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
 * Classification is delegated to `ACTIVITY_STATE_LABELS` (non-null label) —
 * the single source of truth shared with `formatActivityLine`.
 */
export function isTransientActivityState(state: AgentActivityState): boolean {
  return ACTIVITY_STATE_LABELS[state] !== null;
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
  if (!activity) return undefined;
  const elapsedMs = Math.max(0, now - activity.startedAt);
  const glyph = frame ?? activitySpinnerFrame(elapsedMs);
  switch (activity.state) {
    // Uniform transient shape — spinner glyph + label from the shared
    // ACTIVITY_STATE_LABELS map + elapsed measured from the invocation start.
    // `thinking` / `waiting_for_provider` share the Thinking label (per spec);
    // `cancelling` (Task 6.2) renders "Cancelling…" live while the turn
    // unwinds and is replaced by the timeline's `Cancelled after Ns` summary
    // once it resolves — never a permanent spinner.
    case 'thinking':
    case 'waiting_for_provider':
    case 'verifying':
    case 'summarizing':
    case 'cancelling': {
      const label = ACTIVITY_STATE_LABELS[activity.state]!;
      return `${glyph} ${label} ${formatActivityElapsed(elapsedMs)}`;
    }
    case 'tool_running': {
      // Round 1 — the tool timer starts at TOOL start: elapsed runs from
      // toolStartedAt (stamped entering tool_running), falling back to the
      // invocation's startedAt for records created before the field existed.
      const toolStart = activity.toolStartedAt ?? activity.startedAt;
      const toolElapsed = formatActivityElapsed(Math.max(0, now - toolStart));
      return `⚙ Running ${activity.toolName ?? 'tool'}… ${toolElapsed}`;
    }
    case 'possibly_stalled': {
      // The elapsed shown while a stall is suspected anchors on lastEventAt —
      // the timestamp of the last real activity event (token chunk / tool
      // output / transition) — so the line reads "how long since the runtime
      // last did something" rather than the whole invocation's age. Falls back
      // to startedAt for records predating the field.
      const lastEvent = activity.lastEventAt ?? activity.startedAt;
      const stallElapsed = Math.max(0, now - lastEvent);
      const stallGlyph = frame ?? activitySpinnerFrame(stallElapsed);
      return `${stallGlyph} Still working… ${formatActivityElapsed(stallElapsed)}`;
    }
    case 'streaming':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return undefined;
    default: {
      const exhaustive: never = activity.state;
      return exhaustive;
    }
  }
}
