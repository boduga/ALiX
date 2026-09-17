// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — session initialization (#717 step 5b: decomposed from AgentSessionBuilder.build()).
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
import { transitionWorkflowStatus } from "../../kernel/workflow-run.js";
import "../../repomap/context-compiler.js";
import "../../config/context-limits.js";
import { resolveModelConfig } from "../../config/model-resolver.js";
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
import { resolveExplicitSkills, setupContextAndPlan, setupContextLimits, setupHooks, setupMemory, setupResume, setupSession, setupSkills, setupSystemPrompt, setupTools, setupWorkflow } from "./setup.js";
import { SessionPhase } from "./types.js";

import type { SessionState } from "./state.js";
import { advancePhase } from "./activity.js";

export async function initialize(state: SessionState): Promise<void> {
  // P0: Session init
  const p0 = await setupSession(state.config.cwd, state.config.task, {
    sessionId: state.resolvedSessionId,
    sessionMode: state.config.sessionMode,
    approvalStore: state.config.approvalStore,
    suppressConfigWarnings: state.config.suppressConfigWarnings,
  });
  state.ctx = p0.ctx;
  state.metrics = p0.metrics;
  advancePhase(state, SessionPhase.Understanding);
  state.session = { sessionId: state.ctx.sessionId, actor: "system" as const };

  // P1: Workflow
  const p1 = await setupWorkflow(state.ctx, state.session.sessionId, state.currentTask);
  state.wfRun = p1.wfRun;
  state.taskGraph = p1.taskGraph;
  state.taskNode = p1.taskNode;
  state.wfMeta = p1.wfMeta;
  state.graphMeta = p1.graphMeta;

  // P2: Resume
  if (state.config.resumeSessionId) {
    const p2 = await setupResume(state.ctx, state.config.cwd, state.config.resumeSessionId);
    if (p2.completed) {
      transitionWorkflowStatus(state.wfRun, "completed");
      await state.ctx.log.append({
        ...state.session,
        type: "workflow.completed",
        actor: "system",
        payload: {
          workflowId: state.wfRun.id,
          summary: `Session ${state.config.resumeSessionId} is already completed. Use a different session or start a new task.`,
        },
        meta: state.wfMeta,
      });
      state.sessionCompleted = true;
    } else {
      if (p2.currentTask !== undefined) state.currentTask = p2.currentTask;
      if (p2.resumedMessages)
        (state.ctx as any)._resumedMessages = p2.resumedMessages;
      if (p2.scopeSnapshot) (state.ctx as any)._scopeSnapshot = p2.scopeSnapshot;
      if (p2.stateSnapshot) (state.ctx as any)._stateSnapshot = p2.stateSnapshot;
      if (p2.planContent) (state.ctx as any)._planContent = p2.planContent;
      if (p2.planTasks) {
        (state.ctx as any)._planTasks = p2.planTasks;
        state.approvedPlanTasks = p2.planTasks as readonly PlanTask[];
      }
    }
    await state.ctx.log.append({
      ...state.session,
      actor: "system",
      type: "session.resumed",
      payload: {
        priorSessionId: state.config.resumeSessionId,
        task: state.currentTask,
      },
    });
  }

  // P3: Memory
  const p3 = await setupMemory(state.ctx.memoryStore);
  state.memoryContext = p3.memoryContext;
  state.memoryStats = p3.memoryStats;

  // P4: Skills
  const matchedSkills = await setupSkills(
    state.currentTask,
    state.ctx.config.skills?.factory,
    state.explicitSkills,
    { projectDir: state.config.cwd },
  );
  // Persist for per-turn splicing in processTurn (subsequent-turn path).
  state.firstTurnMatchedSkills = matchedSkills;
  state.firstTurnExplicitSkills = await resolveExplicitSkills(state.explicitSkills, state.config.cwd);

  // P5: Context limits + task classification — resolve the runtime model
  // from the canonical `models` object (§10.1/§10.2).
  const p5 = await setupContextLimits(
    resolveModelConfig(state.ctx.config),
    state.ctx.config.apiKeys,
    state.currentTask,
    state.config.readOnly,
    state.ctx.config.context?.budget,
  );
  state.contextBudget = p5.contextBudget;
  state.tokenizer = p5.tokenizer;
  state.taskType = p5.taskType;
  state.shellTask = p5.shellTask;
  state.readOnlyTask = p5.readOnlyTask;
  state.cappedIterations = p5.cappedIterations;

  // P6: Context compilation + Plan
  if (!state.shellTask && !state.readOnlyTask && state.currentTask) {
    const p6 = await setupContextAndPlan(
      state.ctx,
      state.config.cwd,
      state.contextBudget!,
      state.currentTask,
      state.taskType,
      state.ctx.sessionId,
      {
        planMode: state.config.planMode,
        planFilePath: state.config.planFilePath,
        planApprovalMode: state.config.planApprovalMode,
        planApprovalGate: state.config.planApprovalGate,
        // Run identity for the plan-phase model call (R1, §18 coverage).
        context: state.currentRunContext,
      },
    );
    state.contextBundle = p6.contextBundle;

    if (p6.approvedPlanContent) {
      advancePhase(state, SessionPhase.Planning);
    }

    if (p6.planRejected) {
      transitionWorkflowStatus(state.wfRun, "failed");
      await state.ctx.log.append({
        ...state.session,
        type: "workflow.failed",
        actor: "system",
        payload: {
          workflowId: state.wfRun.id,
          summary: "Plan rejected. Task cancelled.",
        },
        meta: state.wfMeta,
      });
      throw new Error("Plan rejected by user");
    }

    if (p6.approvedPlanContent) {
      state.approvedPlanContent = p6.approvedPlanContent;
      state.approvedPlanTasks = p6.approvedPlanTasks;
    }
  }

  // P7: Tools
  const p7 = await setupTools(state.ctx, state.currentTask, state.config.readOnly, state.shellTask);
  state.providerTools = p7.providerTools;
  state.mcpToolIndex = p7.mcpToolIndex;
  state.selectedTools = p7.selectedTools;
  state.mcpDiscovery = p7.mcpDiscovery;
  await state.ctx.log.append({
    ...state.session,
    actor: "system",
    type: "mcp.tools_selected",
    payload: {
      total: state.mcpToolIndex.length,
      selected: state.selectedTools.length,
      taskPreview: state.currentTask.slice(0, 100),
    },
  });

  // P8: System prompt
  state.systemPrompt = await setupSystemPrompt(state.config.cwd, {
    readOnly: state.config.readOnly,
    shellTask: state.shellTask,
    matchedSkills,
    contextBundle: state.contextBundle,
    approvedPlanContent: state.approvedPlanContent,
    memoryContext: state.memoryContext,
    memoryStats: state.memoryStats,
  });

  // P9: Hooks
  state.hooks = await setupHooks(state.config.cwd);

  state.initialized = true;
}
