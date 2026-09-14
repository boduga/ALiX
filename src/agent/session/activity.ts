// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — activity feed + lifecycle accessors (#717 step 5b: decomposed from AgentSessionBuilder.build()).
 *
 * @module agent-session
 */

import "node:crypto";
import "node:fs";
import "node:path";
import "node:path";
import "node:os";
import "node:url";
import "../../events/event-log.js";

import "../../tracing/noop-client.js";
import "../agent.js";
import "../run-root.js";
import "../../run/task-loop.js";
import "../../providers/registry.js";
import "../../runtime/task-router.js";
import "../../runtime/cancellation-token.js";
import type { AgentLivenessSnapshot } from "../agent-liveness.js";
import { createAgentActivity, transition, type AgentActivity, type AgentActivityState, type ActivityTransitionOpts } from "../agent-activity.js";
import "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import "../../kernel/workflow-run.js";
import "../../repomap/context-compiler.js";
import "../../config/context-limits.js";
import "../../config/model-resolver.js";
import "../../config/context-budget.js";
import "../../utils/tokens.js";
import "../../skills/dispatcher.js";
import "../../skills/lifecycle.js";
import "../../mcp/tool-selector.js";
import "../../mcp/tool-discovery.js";
import "../../agents/tool-name-map.js";
import "../../kernel/minimal-metrics.js";
import "../system-prompt.js";
import { SessionPhase } from "./types.js";

import type { SessionState } from "./state.js";

export function feedActivity(
  state: SessionState,
  next: AgentActivityState,
  opts?: ActivityTransitionOpts,
): void {
  // ctx may not be wired yet during very early setup (initialize's
  // internal phases never surface an activity record anyway).
  const log = state.ctx?.log;
  if (!log) return;
  const now = Date.now();
  const nextRecord = state.activeActivity
    ? transition(state.activeActivity, next, now, opts)
    : createAgentActivity(next, state.activityInvocationId ?? "unassigned", now, {
        provider: state.activityModel?.provider,
        model: state.activityModel?.model,
        ...opts,
      });
  state.activeActivity = nextRecord;
  void log
    .append({
      sessionId: state.ctx.sessionId,
      actor: "system",
      type: "agent.session.activity",
      payload: nextRecord,
    })
    .catch(() => {
      // Observability must never break the turn loop.
    });
  // Phase 9 observability — sample the activity-state gauge at each
  // transition (1 = one active invocation in the labelled state). The
  // buffer is flushed once per turn (success or thrown-failure path), so
  // transition rows are bounded by the transition count — never per
  // chunk or per watchdog tick. `metrics` is always set here: feedActivity
  // only runs once ctx.log exists, and ctx.log + metrics are created
  // together in initialize().
  state.metrics.gauge("agent_activity_state", 1, {
    state: next,
  });
}

export function advancePhase(state: SessionState, next: SessionPhase): void {
  if (state.phase === next) return;
  state.phase = next;
  // A phase transition is genuine execution progress.
  state.activeLiveness?.mark("phase_changed", next);
  // ctx may not be wired yet during very early setup; append is safe to skip
  // in that window because phase is also exposed via getPhase().
  const log = state.ctx?.log;
  if (!log) return;
  // Task 2.4 — surface user-visible phases on the activity indicator.
  // Internal phases (Understanding / Planning / Executing) are not
  // exposed; only Verifying and Summarizing map to activity states.
  // feedActivity owns the transition + event emission (deduped here).
  if (next === SessionPhase.Verifying && state.activeActivity) {
    feedActivity(state, "verifying");
  } else if (next === SessionPhase.Summarizing && state.activeActivity) {
    feedActivity(state, "summarizing");
  }
  void log
    .append({
      sessionId: state.ctx.sessionId,
      actor: "system",
      type: "agent.session.phase_changed",
      payload: { phase: next },
    })
    .catch(() => {
      // Observability must never break the turn loop.
    });
}

export function getPhase(state: SessionState): SessionPhase {
  return state.phase;
}

export function getLiveness(
  state: SessionState,
): AgentLivenessSnapshot | undefined {
  return state.activeLiveness?.snapshot();
}

export function getActivity(state: SessionState): AgentActivity | undefined {
  return state.activeActivity;
}

export function cancellationInProgress(state: SessionState): boolean {
  const s = state.activeActivity?.state;
  return s === "cancelling" || s === "cancelled";
}

export function cancelActiveTurn(state: SessionState, reason?: string): boolean {
  const active = state.activeCancel;
  if (!active) return false;
  // Terminal-window check: a cancel is only meaningful while the turn's
  // model loop is genuinely in flight (the Executing phase). Once the
  // loop has resolved and the turn is in its post-loop verifying /
  // summarizing / delivering tail there are no further cancellation
  // checks — honouring an Escape there would silently swallow it while
  // the turn completes normally. Refuse instead so the caller treats the
  // Escape as a no-op (returns false). activeCancel is normally cleared
  // in the loop's finally, but this guard makes the contract durable.
  if (state.phase !== SessionPhase.Executing) return false;
  const r = reason ?? "cancelled by operator";
  active.token.cancel(r);
  active.controller.abort(r);
  state.cancelRequestedAt = Date.now();
  if (state.activeActivity && !cancellationInProgress(state)) {
    feedActivity(state, "cancelling");
  }
  return true;
}
