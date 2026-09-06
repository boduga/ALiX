// src/agent/agent-activity.ts
//
// User-facing activity contract for agent turns. While an invocation runs,
// the UI shows a small activity indicator (Thinking… / Running tool… /
// spinner + elapsed time) that transitions to streamed response text when
// tokens arrive. This module defines the activity state vocabulary and the
// metadata record that accompanies it.
//
// Distinct from AgentLiveness (src/agent/agent-liveness.ts) which tracks
// progress-based liveness (healthy|warning|stalled). Activity is what the
// user *sees*; liveness is whether execution is making progress. They are
// orthogonal concerns that share timestamp fields but must not be merged.
//
// IDLE is represented as `undefined` / `null` activity rather than a state
// member. `cancelling` is the LIVE in-progress phase (the operator pressed
// cancel and the turn is unwinding — rendered "Cancelling…"); `cancelled` is
// the terminal outcome (the existing completion line takes over).

// ─── State union ───────────────────────────────────────────────────

export type AgentActivityState =
  | "thinking"
  | "streaming"
  | "tool_running"
  | "waiting_for_provider"
  | "verifying"
  | "summarizing"
  | "possibly_stalled"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

/** All legal activity state values for iteration / exhaustive checks. */
export const AGENT_ACTIVITY_STATES: readonly AgentActivityState[] = [
  "thinking",
  "streaming",
  "tool_running",
  "waiting_for_provider",
  "verifying",
  "summarizing",
  "possibly_stalled",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
] as const;

// ─── Metadata ──────────────────────────────────────────────────────

export type AgentActivity = Readonly<{
  state: AgentActivityState;
  /** Free-form description of the current operation (e.g. "Searching codebase"). */
  operation?: string;
  /** Name of the tool currently executing, when state is tool_running. */
  toolName?: string;
  /**
   * Timestamp (ms) when the current tool began executing — the zero point of
   * the tool elapsed timer (`now - toolStartedAt`). Set on the
   * thinking→tool_running transition, so a running tool reports its own
   * duration rather than the whole invocation's. Unset until the first tool
   * starts; renderers fall back to `startedAt` when absent. Carried through
   * transitions; each new tool_running restamps it.
   */
  toolStartedAt?: number;
  /** Timestamp (ms) when this activity record was created. */
  startedAt: number;
  /** Timestamp (ms) of the last progress mark. */
  lastProgressAt: number;
  /** Timestamp (ms) of the last event emission (token chunk, tool output, etc.). */
  lastEventAt: number;
  /** Wall-clock elapsed since startedAt, computed by helpers. */
  elapsedMs: number;
  /** Provider identifier (e.g. "openai", "anthropic"). */
  provider?: string;
  /** Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514"). */
  model?: string;
  /** Unique identifier for the invocation this activity belongs to. */
  invocationId: string;
}>;

// ─── Transition options ────────────────────────────────────────────

export type ActivityTransitionOpts = Readonly<{
  operation?: string;
  toolName?: string;
  toolStartedAt?: number;
  provider?: string;
  model?: string;
}>;

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Create a new AgentActivity record. All timestamps are stamped at `now`;
 * elapsedMs starts at 0.
 */
export function createAgentActivity(
  state: AgentActivityState,
  invocationId: string,
  now: number,
  opts?: ActivityTransitionOpts,
): AgentActivity {
  return Object.freeze({
    state,
    invocationId,
    startedAt: now,
    lastProgressAt: now,
    lastEventAt: now,
    elapsedMs: 0,
    ...(opts?.operation !== undefined && { operation: opts.operation }),
    ...(opts?.toolName !== undefined && { toolName: opts.toolName }),
    ...(opts?.toolStartedAt !== undefined && { toolStartedAt: opts.toolStartedAt }),
    ...(opts?.provider !== undefined && { provider: opts.provider }),
    ...(opts?.model !== undefined && { model: opts.model }),
  });
}

/**
 * Immutable transition to a new activity state. Returns a new AgentActivity
 * with the updated state, timestamps, and optional field overrides. Fields
 * not specified in `opts` carry forward from the previous record.
 */
export function transition(
  current: AgentActivity,
  nextState: AgentActivityState,
  now: number,
  opts?: ActivityTransitionOpts,
): AgentActivity {
  return Object.freeze({
    ...current,
    state: nextState,
    lastProgressAt: now,
    lastEventAt: now,
    elapsedMs: now - current.startedAt,
    ...(opts?.operation !== undefined && { operation: opts.operation }),
    ...(opts?.toolName !== undefined && { toolName: opts.toolName }),
    ...(opts?.toolStartedAt !== undefined && { toolStartedAt: opts.toolStartedAt }),
    ...(opts?.provider !== undefined && { provider: opts.provider }),
    ...(opts?.model !== undefined && { model: opts.model }),
  });
}

/**
 * Recompute elapsedMs against the provided `now` without changing state.
 * Useful for UI tick updates.
 */
export function withElapsed(activity: AgentActivity, now: number): AgentActivity {
  return Object.freeze({
    ...activity,
    elapsedMs: now - activity.startedAt,
  });
}

/**
 * Human-friendly elapsed duration — "4s", "2m 14s", "1h 05m". Shared by the
 * TUI activity indicator (`formatActivityLine`) and the session surface's
 * "Cancelled after 4m 12s" summary so both renderers agree on one formatter.
 */
export function formatActivityElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * Exhaustive state handler — call from a switch to ensure every
 * AgentActivityState is covered. Returns `undefined` for all states.
 * Follows the exhaustive-never pattern from src/agent/session.ts.
 */
export function assertExhaustiveState(state: AgentActivityState): undefined {
  switch (state) {
    case "thinking":
    case "streaming":
    case "tool_running":
    case "waiting_for_provider":
    case "verifying":
    case "summarizing":
    case "possibly_stalled":
    case "cancelling":
    case "completed":
    case "failed":
    case "cancelled":
      return undefined;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
