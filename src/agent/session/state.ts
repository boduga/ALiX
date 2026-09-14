// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — SessionState (#717 step 5b: decomposed from AgentSessionBuilder.build()).
 *
 * @module agent-session
 */

import { randomUUID } from "node:crypto";
import "node:fs";
import "node:path";
import "node:path";
import "node:os";
import "node:url";
import type { AgentIntent } from "../../run/intent-classifier.js";
import "../../events/event-log.js";

import type { ToolDef } from "../../providers/types.js";
import type { AgentContext } from "../agent.js";
import type { TaskType } from "../../task-classifier.js";
import type { WorkflowRun } from "../../kernel/workflow-run.js";
import type { TaskGraph, TaskNode } from "../../kernel/task-graph.js";
import type { ContextBundle } from "../../repomap/context-compiler.js";
import type { DeferredToolEntry } from "../../mcp/tool-deferral.js";
import type { ExecutionContext } from "../../observability/execution-context.js";
import type { TraceClient } from "../../tracing/client.js";
import { NOOP_TRACE_CLIENT } from "../../tracing/noop-client.js";
import "../agent.js";
import "../run-root.js";
import "../../run/task-loop.js";
import "../../providers/registry.js";
import type { ModelAdapter } from "../../providers/types.js";
import "../../runtime/task-router.js";
import { CancellationToken } from "../../runtime/cancellation-token.js";
import type { AgentLiveness } from "../agent-liveness.js";
import type { AgentActivity } from "../agent-activity.js";
import "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import { buildChatPrompt } from "../../runtime/route-prompts.js";
import "../../kernel/workflow-run.js";
import "../../repomap/context-compiler.js";
import { type TokenizerName } from "../../config/context-limits.js";
import "../../config/model-resolver.js";
import { type ContextBudget } from "../../config/context-budget.js";
import "../../utils/tokens.js";
import "../../skills/dispatcher.js";
import "../../skills/lifecycle.js";
import "../../mcp/tool-selector.js";
import { ToolDiscovery } from "../../mcp/tool-discovery.js";
import "../../agents/tool-name-map.js";
import { MinimalMetrics } from "../../kernel/minimal-metrics.js";
import type { PlanTask } from "../../planning/plan-task.js";
import "../system-prompt.js";
import { AgentSessionConfig, Message, SessionPhase, ToolExecution } from "./types.js";

/**
 * All mutable state owned by a single AgentSession. Hoisted out of the former
 * build() closure (#717 5b) so the session phases can live in module-level
 * factories that share one explicit object.
 *
 * Fields assigned lazily during initialize() are typed as definite values and
 * seeded with a cast so the phase code reads naturally (matching the former
 * closure's definite-assignment lets).
 */
export interface SessionState {
  readonly config: AgentSessionConfig;
  readonly traceClient: TraceClient;
  readonly resolvedSessionId: string;
  readonly createdAt: string;

  initialized: boolean;
  ctx: AgentContext;
  session: { sessionId: string; actor: "system" };
  wfRun: WorkflowRun;
  taskGraph: TaskGraph;
  taskNode: TaskNode;
  wfMeta: Record<string, string>;
  graphMeta: Record<string, string>;
  metrics: MinimalMetrics;

  currentTask: string;
  sessionGoal: string | undefined;
  currentRunContext: ExecutionContext | undefined;
  explicitSkills: string[] | undefined;
  contextBudget: ContextBudget | undefined;
  tokenizer: TokenizerName;
  taskType: TaskType;
  shellTask: boolean;
  readOnlyTask: boolean;
  cappedIterations: number;

  systemPrompt: string;
  contextBundle: ContextBundle | undefined;
  approvedPlanContent: string | undefined;
  approvedPlanTasks: readonly PlanTask[] | undefined;
  memoryContext: string | undefined;
  memoryStats: string | undefined;
  firstTurnMatchedSkills: any[];
  firstTurnExplicitSkills: any[];

  providerTools: ToolDef[];
  mcpToolIndex: DeferredToolEntry[];
  selectedTools: DeferredToolEntry[];
  mcpDiscovery: ToolDiscovery | null;

  hooks: {
    pre_task: Array<{ command: string; reason: string }>;
    post_task: Array<{ command: string; reason: string }>;
  };

  messages: Message[];
  toolHistory: ToolExecution[];
  turnCount: number;
  updatedAt: string;
  sessionCompleted: boolean;
  latestLedgerText: string | undefined;
  latestIntent: AgentIntent | undefined;
  filesTouchedCount: number;
  phase: SessionPhase;

  activeLiveness: AgentLiveness | undefined;
  activeActivity: AgentActivity | undefined;
  activityInvocationId: string | undefined;
  activityModel: { provider: string; model: string } | undefined;

  activeCancel:
    | { token: CancellationToken; controller: AbortController }
    | undefined;
  cancelRequestedAt: number | undefined;
  lastCancelSummary: string | undefined;

  chatReady: boolean;
  chatProviderInstance: ModelAdapter | null;
  chatMessages: { role: "user" | "assistant"; content: string }[];
  chatSystemPrompt: string;
  chatSearchLabel: string;
}

/** Construct the mutable state object for one session. */
export function createSessionState(config: AgentSessionConfig): SessionState {
  return {
    config,
    traceClient: config.traceClient ?? NOOP_TRACE_CLIENT,
    resolvedSessionId: config.sessionId ?? randomUUID(),
    createdAt: new Date().toISOString(),
    initialized: false,
    ctx: undefined as unknown as AgentContext,
    session: undefined as unknown as { sessionId: string; actor: "system" },
    wfRun: undefined as unknown as WorkflowRun,
    taskGraph: undefined as unknown as TaskGraph,
    taskNode: undefined as unknown as TaskNode,
    wfMeta: undefined as unknown as Record<string, string>,
    graphMeta: undefined as unknown as Record<string, string>,
    metrics: undefined as unknown as MinimalMetrics,
    currentTask: config.task,
    sessionGoal: undefined,
    currentRunContext: undefined,
    explicitSkills: undefined,
    contextBudget: undefined,
    tokenizer: "cl100k_base",
    taskType: "unknown",
    shellTask: false,
    readOnlyTask: false,
    cappedIterations: 25,
    systemPrompt: "",
    contextBundle: undefined,
    approvedPlanContent: undefined,
    approvedPlanTasks: undefined,
    memoryContext: undefined,
    memoryStats: undefined,
    firstTurnMatchedSkills: [],
    firstTurnExplicitSkills: [],
    providerTools: [],
    mcpToolIndex: [],
    selectedTools: [],
    mcpDiscovery: null,
    hooks: { pre_task: [], post_task: [] },
    messages: [],
    toolHistory: [],
    turnCount: 0,
    updatedAt: new Date().toISOString(),
    sessionCompleted: false,
    latestLedgerText: undefined,
    latestIntent: undefined,
    filesTouchedCount: 0,
    phase: SessionPhase.Idle,
    activeLiveness: undefined,
    activeActivity: undefined,
    activityInvocationId: undefined,
    activityModel: undefined,
    activeCancel: undefined,
    cancelRequestedAt: undefined,
    lastCancelSummary: undefined,
    chatReady: false,
    chatProviderInstance: null,
    chatMessages: [],
    chatSystemPrompt:
      config.chatSystemPrompt ?? buildChatPrompt("ambiguous").systemPrompt,
    chatSearchLabel: config.chatSearchLabel ?? "[Web search results]",
  };
}
