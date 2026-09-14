// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — session resume (#717 step 5b: decomposed from AgentSessionBuilder.build()).
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
import type { PlanTask } from "../../planning/plan-task.js";
import "../system-prompt.js";

import type { SessionState } from "./state.js";

export function restoreReconstructedPlanTasks(
  state: SessionState,
  reconstructed: {
    planTasks?: readonly PlanTask[];
  },
): void {
  if (reconstructed.planTasks) {
    (state.ctx as any)._planTasks = reconstructed.planTasks;
    state.approvedPlanTasks = reconstructed.planTasks;
  }
}

export async function resumeSession(
  state: SessionState,
  sessionId: string,
): Promise<void> {
  if (!state.ctx) return;

  // Prefer SessionStore if wired — that's the authoritative source.
  if (state.config.store) {
    const snapshot = await state.config.store.load(sessionId);
    if (!snapshot) {
      // Fall through to legacy reconstruction; if that also fails, the
      // caller's `processTurn` will surface a fresh-session state.
      const { reconstructSession } = await import("../../session/resume.js");
      const reconstructed = await reconstructSession(state.config.cwd, sessionId);
      if (reconstructed.messages.length > 0) {
        state.messages = [...reconstructed.messages];
        const originalTask = reconstructed.messages.find(
          (m) => m.role === "user",
        );
        if (originalTask && typeof originalTask.content === "string") {
          state.currentTask = originalTask.content;
        }
      }
      if (reconstructed.scopeSnapshot)
        (state.ctx as any)._scopeSnapshot = reconstructed.scopeSnapshot;
      if (reconstructed.stateSnapshot)
        (state.ctx as any)._stateSnapshot = reconstructed.stateSnapshot;
      if (reconstructed.planContent)
        (state.ctx as any)._planContent = reconstructed.planContent;
      restoreReconstructedPlanTasks(state, reconstructed);
      state.sessionCompleted = reconstructed.completed;
    } else {
      // Replace internal state with the snapshot.
      state.messages = [...snapshot.messages];
      state.toolHistory = [...snapshot.toolHistory];
      state.currentTask = snapshot.task;
      // createdAt is immutable (captured at session construction); we
      // adopt the snapshot's value logically but cannot reassign. The
      // runtime contract is "createdAt is the earliest save timestamp",
      // which snapshot.createdAt already encodes. We only update the
      // mutable `updatedAt` so subsequent saves reflect the resume point.
      state.updatedAt = snapshot.updatedAt;
      state.sessionCompleted = snapshot.completed === true;
      if (snapshot.scopeSnapshot !== undefined) {
        (state.ctx as any)._scopeSnapshot = snapshot.scopeSnapshot;
      }
      if (snapshot.stateSnapshot !== undefined) {
        (state.ctx as any)._stateSnapshot = snapshot.stateSnapshot;
      }
      // Bring downstream loop into alignment with the restored state.
      (state.ctx as any)._resumedMessages = [...snapshot.messages];
      // tool history isn't surfaced via ctx in the loop today; we keep
      // it on the AgentSession runtime only. processTurn will continue
      // from there.
    }
    await state.ctx.log.append({
      ...state.session,
      actor: "system",
      type: "session.resumed",
      payload: { priorSessionId: sessionId, task: state.currentTask },
    });
    return;
  }

  // Legacy path: reconstruct from the persisted session directory.
  const { reconstructSession } = await import("../../session/resume.js");
  const reconstructed = await reconstructSession(state.config.cwd, sessionId);
  if (reconstructed.completed) return;

  if (reconstructed.messages.length > 0) {
    state.messages = [...reconstructed.messages];
    const originalTask = reconstructed.messages.find(
      (m) => m.role === "user",
    );
    if (originalTask && typeof originalTask.content === "string") {
      state.currentTask = originalTask.content;
    }
  }
  if (reconstructed.scopeSnapshot) {
    (state.ctx as any)._scopeSnapshot = reconstructed.scopeSnapshot;
  }
  if (reconstructed.stateSnapshot) {
    (state.ctx as any)._stateSnapshot = reconstructed.stateSnapshot;
  }
  if (reconstructed.planContent) {
    (state.ctx as any)._planContent = reconstructed.planContent;
  }
  restoreReconstructedPlanTasks(state, reconstructed);

  await state.ctx.log.append({
    ...state.session,
    actor: "system",
    type: "session.resumed",
    payload: { priorSessionId: sessionId, task: state.currentTask },
  });
}
