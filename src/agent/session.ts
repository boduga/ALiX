// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — shared session engine for run, run --chat, and tui.
 *
 * P1: One session = one logical conversation/task, potentially spanning
 * multiple user turns. First turn includes full setup (agent init, graph,
 * context, plan). Subsequent turns reuse the session and accumulate messages.
 *
 * @module agent-session
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ToolCall, NormalizedMessage, ToolDef } from "../providers/types.js";
import type { RunResult } from "../run.js";
import type { StreamHandler } from "./stream.js";
import type { AgentContext } from "./agent.js";
import type { TaskType } from "../task-classifier.js";
import type { WorkflowRun } from "../kernel/workflow-run.js";
import type { TaskGraph, TaskNode } from "../kernel/task-graph.js";
import type { ContextBundle } from "../repomap/context-compiler.js";
import type { DeferredToolEntry } from "../mcp/tool-deferral.js";
import type { ExecutionContext } from "../observability/execution-context.js";
import type { MutationSessionState } from "../run.js";
import { initAgent } from "./agent.js";
import { runTaskLoop, type TaskLoopDeps } from "../run/task-loop.js";
import { createWorkflowRun, transitionWorkflowStatus } from "../kernel/workflow-run.js";
import { createSingleNodeGraph, transitionNodeStatus, transitionGraphStatus } from "../kernel/task-graph.js";
import { classifyTask, detectResearchDepth, isReadOnlyTask, isShellTask } from "../task-classifier.js";
import { buildToolsForProvider, buildContextBundleEventPayload, renderContextBundleForPrompt } from "./messages.js";
import { ContextCompiler } from "../repomap/context-compiler.js";
import { buildMemoryContext, buildMemoryStats } from "../utils/memory/recall.js";
import { getEncoding } from "../config/context-limits.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { evictIfNeeded } from "../skills/lifecycle.js";
import { ToolSelector } from "../mcp/tool-selector.js";
import { ToolDiscovery } from "../mcp/tool-discovery.js";
import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";
import { READ_ONLY_TOOL_NAMES, saveDecisionsToMemory } from "../run/helpers.js";
import { MinimalMetrics } from "../kernel/minimal-metrics.js";
import { TaskStateMachine, RunLimiter } from "../autonomy/state-machine.js";

// =============================================================================
// Types (verbatim from P1 brief)
// =============================================================================

export type Message = NormalizedMessage;

export interface ToolExecution {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result?: string;
  readonly error?: string;
  readonly timestamp: string;
}

export interface AgentTurnResult {
  readonly summary: string;
  readonly sessionId: string;
  readonly toolCalls: readonly ToolCall[];
  readonly streamed?: boolean;
  readonly reason?: string;
}

export interface AgentSessionState {
  readonly sessionId: string;
  readonly messages: readonly Message[];
  readonly toolHistory: readonly ToolExecution[];
  readonly turnCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentSessionConfig {
  /** Working directory (project root). */
  cwd: string;
  /** Initial task / goal description. Used for context compilation and planning. */
  task: string;
  /** Optional explicit session ID (auto-generated if omitted). */
  sessionId?: string;
  /** Permission mode: auto, ask, or bypass (defaults to config). */
  sessionMode?: "auto" | "ask" | "bypass";
  /** Read-only mode restricts tools to read/search only. */
  readOnly?: boolean;
  /** Enable streaming output. */
  streaming?: boolean;
  /** Skip plan phase (default: plan phase runs unless read-only). */
  planMode?: boolean;
  /** Load plan from file instead of generating. */
  planFilePath?: string;
  /** Resume from a prior session. */
  resumeSessionId?: string;
  /** Parent run ID for execution trace correlation. */
  parentRunId?: string;
  /** Optional stream handler for real-time output. */
  onStream?: StreamHandler;
}

export interface AgentSession {
  /** Process one user message through the agent loop. */
  processTurn(message: string): Promise<AgentTurnResult>;
  /** The underlying session ID. */
  getSessionId(): string;
  /** Snapshot of current session state. */
  getState(): AgentSessionState;
  /** Save session state to memory (stub — external via SessionStore). */
  save(): Promise<void>;
  /** Resume from a prior session (stub — reconstruct from saved state). */
  resume(sessionId: string): Promise<void>;
}

// =============================================================================
// Implementation
// =============================================================================

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  // ---- Mutable internal state (captured by closure) ----
  let initialized = false;
  let ctx: AgentContext;
  let session: { sessionId: string; actor: "system" };
  let wfRun: WorkflowRun;
  let taskGraph: TaskGraph;
  let taskNode: TaskNode;
  let wfMeta: Record<string, string>;
  let graphMeta: Record<string, string>;
  let metrics: MinimalMetrics;

  // Resolved runtime values (computed during init)
  let currentTask = config.task;
  let MAX_CONTEXT_TOKENS = 0;
  let encoding: "cl100k_base" | "o200k_base" | "char4" = "cl100k_base";
  let taskType: TaskType = "unknown";
  let depth: "quick" | "deep" = "quick";
  let shellTask = false;
  let readOnlyTask = false;
  let cappedIterations = 10;

  // Setup values
  let systemPrompt = "";
  let contextBundle: ContextBundle | undefined;
  let approvedPlanContent: string | undefined;
  let memoryContext: string | undefined;
  let memoryStats: string | undefined;

  // Tools
  let providerTools: ToolDef[] = [];
  let mcpToolIndex: DeferredToolEntry[] = [];
  let selectedTools: DeferredToolEntry[] = [];
  let mcpDiscovery: ToolDiscovery | null = null;

  // Hooks
  let hooks: { pre_task: Array<{ command: string; reason: string }>; post_task: Array<{ command: string; reason: string }> } = { pre_task: [], post_task: [] };

  // Session state (accumulated across turns)
  let messages: Message[] = [];
  let toolHistory: ToolExecution[] = [];
  let turnCount = 0;
  const createdAt = new Date().toISOString();
  let updatedAt = new Date().toISOString();
  let _sessionCompleted = false;

  // ---- Internal helpers ----

  /**
   * Initialize the session on the first processTurn call.
   * Replicates the setup in agent-loop.ts runTask().
   */
  async function initialize(): Promise<void> {
    metrics = new MinimalMetrics();
    metrics.increment("workflow_runs_total", { goal: config.task.slice(0, 50) });

    // P0: Agent init (initAgent creates provider, log, executor, MCP, scope, etc.)
    ctx = await initAgent(config.cwd, {
      cwd: config.cwd,
      task: config.task,
      sessionId: config.sessionId,
      sessionMode: config.sessionMode,
    });

    session = { sessionId: ctx.sessionId, actor: "system" as const };

    // P1: WorkflowRun + TaskGraph
    wfRun = createWorkflowRun(ctx.sessionId, currentTask);
    wfMeta = { sessionId: ctx.sessionId, workflowId: wfRun.id };
    await ctx.log.append({
      ...session, type: "workflow.created", actor: "system",
      payload: { workflowId: wfRun.id, goal: currentTask, mode: wfRun.mode },
      meta: wfMeta,
    });

    const graphResult = createSingleNodeGraph(wfRun.id, currentTask);
    taskGraph = graphResult.graph;
    taskNode = graphResult.node;
    graphMeta = { ...wfMeta, graphId: taskGraph.id, nodeId: taskNode.id };
    await ctx.log.append({
      ...session, type: "graph.created", actor: "system",
      payload: { graphId: taskGraph.id, workflowId: wfRun.id, nodeCount: 1 },
      meta: graphMeta,
    });
    await ctx.log.append({
      ...session, type: "task.ready", actor: "system",
      payload: { nodeId: taskNode.id, graphId: taskGraph.id, goal: currentTask },
      meta: graphMeta,
    });

    // Resume path -- reconstruct state from prior session
    if (config.resumeSessionId) {
      const { reconstructSession } = await import("../session/resume.js");
      const reconstructed = await reconstructSession(config.cwd, config.resumeSessionId);

      if (reconstructed.completed) {
        transitionWorkflowStatus(wfRun, "completed");
        await ctx.log.append({
          ...session, type: "workflow.completed", actor: "system",
          payload: { workflowId: wfRun.id, summary: `Session ${config.resumeSessionId} is already completed. Use a different session or start a new task.` },
          meta: wfMeta,
        });

        // Mark session as completed so processTurn returns early
        _sessionCompleted = true;
      } else {
        // Override task with original from persisted session
        const originalTask = reconstructed.messages.find(m => m.role === "user");
        if (originalTask && typeof originalTask.content === "string") {
          currentTask = originalTask.content;
        }

        // Store reconstructed state on context for downstream use
        (ctx as any)._resumedMessages = reconstructed.messages;
        (ctx as any)._scopeSnapshot = reconstructed.scopeSnapshot;
        (ctx as any)._stateSnapshot = reconstructed.stateSnapshot;
        (ctx as any)._planContent = reconstructed.planContent;
      }

      await ctx.log.append({
        ...session, actor: "system", type: "session.resumed",
        payload: { priorSessionId: config.resumeSessionId, task: currentTask },
      });
    }

    // P2: Memory context
    memoryContext = await buildMemoryContext(ctx.memoryStore);
    memoryStats = await buildMemoryStats(ctx.memoryStore);

    // P3: Skills catalog (best-effort; failures are non-fatal)
    let matchedSkills: any[] = [];
    try {
      const skillsHome = join(homedir(), ".alix", "skills");
      const { loadSkillManifests } = await import("../skills/loader.js");
      const { buildSkillCatalog } = await import("../skills/catalog.js");
      const skillManifests = await loadSkillManifests(skillsHome);
      const skillCatalog = buildSkillCatalog(skillManifests);
      const { maxStore, maxCandidates } = ctx.config.skills?.factory ?? DEFAULT_FACTORY_CONFIG;
      evictIfNeeded(skillsHome, { maxStore, maxCandidates: maxCandidates ?? 200 });
      matchedSkills = await skillCatalog.getMatchedContent(currentTask);
    } catch {
      // Skills catalog is optional
    }

    // P4: Context token limits
    const userOverride = ctx.config.model.maxContextTokens;
    if (userOverride !== undefined) {
      MAX_CONTEXT_TOKENS = userOverride;
      encoding = getEncoding(ctx.config.model.provider);
    } else {
      const { resolveContextLimit, getEncoding: getEnc } = await import("../config/context-limits.js");
      const resolved = await resolveContextLimit(ctx.config.model.provider, ctx.config.model.name, ctx.config.apiKeys);
      MAX_CONTEXT_TOKENS = resolved.maxTokens;
      encoding = resolved.encoding;
    }

    // P5: Task classification — use a placeholder when no initial task
    // (chat mode with no initial task; first processTurn message becomes the task)
    const effectiveTask = currentTask || "Interactive coding session";
    taskType = classifyTask(effectiveTask);
    depth = detectResearchDepth(effectiveTask);
    const maxIter = ctx.config.model.maxIterations ?? 10;
    shellTask = isShellTask(effectiveTask);
    readOnlyTask = isReadOnlyTask(effectiveTask) || shellTask;
    cappedIterations = shellTask
      ? Math.min(maxIter, 2)
      : config.readOnly
        ? Math.min(maxIter, 4)
        : maxIter;

    // P6: Context compilation (skip for shell / read-only tasks, and when no initial task)
    if (!shellTask && !readOnlyTask && currentTask) {
      const contextCompiler = new ContextCompiler({
        root: config.cwd,
        maxTokens: MAX_CONTEXT_TOKENS,
        eventLog: ctx.log,
        sessionId: ctx.sessionId,
      });
      await contextCompiler.warm();
      contextBundle = await contextCompiler.compileContext(currentTask, taskType, []);
      await ctx.log.append({
        ...session, type: "context.bundle_compiled", actor: "system",
        payload: buildContextBundleEventPayload(contextBundle),
      });

      // P7: Plan phase (skipped for read-only / shell / non-TTY)
      // Also skip when planMode is explicitly false.
      if (config.planMode !== false) {
        const { runPlanPhase } = await import("../run/plan-phase.js");
        const planResult = await runPlanPhase(ctx, contextBundle, currentTask, config.planFilePath);
        if (planResult.action === "rejected") {
          transitionWorkflowStatus(wfRun, "failed");
          await ctx.log.append({
            ...session, type: "workflow.failed", actor: "system",
            payload: { workflowId: wfRun.id, summary: "Plan rejected. Task cancelled." },
            meta: wfMeta,
          });
          throw new Error("Plan rejected by user");
        }
        approvedPlanContent = planResult.planContent;
      }
    }

    // P8: Tool setup
    const baseTools = buildToolsForProvider(ctx.provider);
    const toolFilter = config.readOnly
      ? new Set([...READ_ONLY_TOOL_NAMES].filter(n => n !== "alix_shell_run"))
      : shellTask
        ? READ_ONLY_TOOL_NAMES
        : null;
    providerTools = toolFilter
      ? baseTools.filter(t => toolFilter.has(t.name))
      : baseTools;

    const mcpDeferral = ctx.mcpManager?.getDeferral();
    mcpToolIndex = mcpDeferral?.buildIndex() ?? [];
    const toolSelector = new ToolSelector(mcpToolIndex, { maxTools: 20, tokenBudget: 3000 });
    selectedTools = toolSelector.select(currentTask);
    mcpDiscovery = ctx.mcpManager ? new ToolDiscovery(mcpToolIndex) : null;
    for (const entry of selectedTools) {
      TOOL_NAME_MAP[entry.name] = entry.execName;
    }
    await ctx.log.append({
      ...session, actor: "system", type: "mcp.tools_selected",
      payload: { total: mcpToolIndex.length, selected: selectedTools.length, taskPreview: currentTask.slice(0, 100) },
    });

    // P9: System prompt assembly (matches agent-loop.ts lines 274-317)
    const SYSTEM_PROMPT_BASE =
      "You are ALiX, an AI coding agent. You have access to tools. IMPORTANT: When you call a tool, wait for the result in the next response before taking further action. If a tool returns an error, fix the issue. If the tool succeeds, confirm completion. Do NOT repeat the same tool call twice without checking the result first. When the task is complete, call the done tool — do NOT keep calling tools after the goal is achieved. For read-only queries (like pwd, ls, cat, grep), call done immediately after getting the result — there is nothing to verify.";
    const lines: string[] = [
      SYSTEM_PROMPT_BASE,
      `## Workspace\nYou are working in: \`${config.cwd}\`. All file paths are relative to this directory.`,
    ];

    if (shellTask) {
      lines.push(`## Read-Only Mode
The user gave you a direct shell command. Use the \`shell_run\` tool to execute it, read the output, and call \`done\`. Do NOT read files or search the codebase unless the output clearly requires it. This task does not involve writing code or modifying files.`);
    }

    if (config.readOnly) {
      lines.push(`## Read-Only Mode
You are in read-only mode. You can read files, search the codebase, and delegate to subagents, but you CANNOT run shell commands or modify any files. Answer questions and investigate the codebase. Suggest changes verbally rather than making them.`);
    }

    if (matchedSkills.length > 0) {
      const skillSection = matchedSkills
        .map((s: any) => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
        .join("\n\n");
      lines.push(`## Available Skills\n${skillSection}`);
    }

    if (contextBundle && (contextBundle.primaryFiles.length > 0 || contextBundle.tests.length > 0 || contextBundle.supportingFiles.length > 0)) {
      lines.push(renderContextBundleForPrompt(contextBundle));
    }

    if (approvedPlanContent) {
      lines.push(`## Approved Plan\n${approvedPlanContent}`);
    }

    if (memoryStats) {
      lines.push(`## Memory Stats\n${memoryStats}`);
    }

    if (memoryContext) {
      lines.push(`## Memory\n${memoryContext}`);
    }

    systemPrompt = lines.join("\n\n");

    // P10: Discover hooks
    const { discoverHooks } = await import("../hooks/discover.js");
    const discoveredHooks = await discoverHooks(config.cwd);
    hooks = {
      pre_task: (discoveredHooks.pre_task ?? []).map((h: any) => ({ command: h.command, reason: h.reason })),
      post_task: (discoveredHooks.post_task ?? []).map((h: any) => ({ command: h.command, reason: h.reason })),
    };

    initialized = true;
  }

  /**
   * Create a fresh MutationSessionState for each turn.
   */
  function createFreshSessionState(): MutationSessionState {
    return {
      created: new Set<string>(),
      changed: new Set<string>(),
      deleted: new Set<string>(),
      fatalErrors: [] as string[],
      pendingScopeExpansion: false,
    };
  }

  /**
   * Best-effort extraction of tool calls from messages added during a turn.
   *
   * NormalizedMessage does not preserve ToolCall metadata directly, so we
   * extract tool call IDs from `<tool_result>` tags in assistant tool-result
   * messages. Full name/args resolution requires integration with the event
   * log's agent.reasoning events, which is deferred.
   */
  function extractToolCallsFromMessages(msgs: Message[]): ToolCall[] {
    const calls: ToolCall[] = [];
    const resultRe = /<tool_result\s+id="([^"]*)"/g;
    for (const msg of msgs) {
      if (typeof msg.content === "string") {
        let match: RegExpExecArray | null;
        while ((match = resultRe.exec(msg.content)) !== null) {
          calls.push({ id: match[1], name: "unknown", args: {} });
        }
      }
    }
    return calls;
  }

  // ---- Exported interface methods ----

  async function processTurn(message: string): Promise<AgentTurnResult> {
    if (!initialized) {
      await initialize();
    }

    // If the session was already completed (resumed completed session), return early
    if (_sessionCompleted) {
      return {
        summary: `Session ${ctx.sessionId} is already completed. Use a different session or start a new task.`,
        sessionId: ctx.sessionId,
        toolCalls: [],
        streamed: false,
        reason: "completed",
      };
    }

    turnCount++;
    updatedAt = new Date().toISOString();

    // Emit lifecycle event: turn started
    await ctx.log.append({
      sessionId: ctx.sessionId, actor: "system",
      type: "agent.session.turn.started",
      payload: { turn: turnCount, message },
    });

    // Push user message to accumulated messages
    messages.push({ role: "user", content: message });

    // Create fresh per-turn state (each turn gets its own iteration budget)
    const sessionState = createFreshSessionState();
    const limiter = new RunLimiter({
      maxIterations: cappedIterations,
      maxRepairs: 3,
      maxFileChanges: 0,
      maxShellCommands: 0,
      maxRuntimeMs: 0,
    });
    const stateMachine = new TaskStateMachine(limiter);

    // Build execution context for diagnostic correlation
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const taskContext: ExecutionContext = {
      runId,
      sessionId: ctx.sessionId,
      workflowId: wfRun.id,
      providerId: ctx.config.model.provider,
      model: ctx.config.model.name,
      parentRunId: config.parentRunId,
    };

    // Snapshot pre-turn message count to identify this turn's additions
    const preTurnMsgCount = messages.length;

    // Update graph status (first turn transitions from ready / created)
    transitionNodeStatus(taskNode, "running");
    if (turnCount === 1) {
      transitionGraphStatus(taskGraph, "running");
      await ctx.log.append({
        ...session, type: "task.started", actor: "system",
        payload: { nodeId: taskNode.id, graphId: taskGraph.id },
        meta: graphMeta,
      });
      await ctx.log.append({
        ...session, type: "graph.status_changed", actor: "system",
        payload: { graphId: taskGraph.id, status: "running" },
        meta: graphMeta,
      });
    }

    const startTime = Date.now();

    // Build TaskLoopDeps and run the agent loop
    let result: RunResult;
    try {
      result = await runTaskLoop({
        config: {
          model: {
            provider: ctx.config.model.provider,
            name: ctx.config.model.name,
            streaming: ctx.config.model.streaming ?? false,
          },
          permissions: {
            sessionMode: ctx.config.permissions.sessionMode,
          },
          skills: ctx.config.skills,
        },
        provider: ctx.provider,
        providerTools,
        mcpToolIndex,
        messages,
        sessionState,
        stateMachine,
        scope: ctx.scope,
        session,
        log: ctx.log,
        executor: ctx.toolExecutor,
        mcpDiscovery,
        selectedTools,
        hooks,
        maxIterations: cappedIterations,
        MAX_CONTEXT_TOKENS,
        encoding,
        task: currentTask,
        taskType,
        depth,
        readOnly: config.readOnly ?? readOnlyTask,
        shellTask: shellTask || (turnCount === 0 && currentTask === "" ? isShellTask(message) : false),
        memoryStore: ctx.memoryStore,
        sessionId: ctx.sessionId,
        sessionDir: ctx.sessionDir,
        systemPrompt,
        onStream: config.onStream,
        hookRunner: ctx.hookRunner,
        context: taskContext,
      });
    } catch (err) {
      transitionNodeStatus(taskNode, "failed");
      await ctx.log.append({
        ...session, type: "task.failed", actor: "system",
        payload: { nodeId: taskNode.id, graphId: taskGraph.id, error: String(err) },
        meta: graphMeta,
      });
      transitionWorkflowStatus(wfRun, "failed");
      await ctx.log.append({
        ...session, type: "workflow.failed", actor: "system",
        payload: { workflowId: wfRun.id, summary: String(err) },
        meta: wfMeta,
      });

      // Emit lifecycle event: turn completed (error)
      await ctx.log.append({
        sessionId: ctx.sessionId, actor: "system",
        type: "agent.session.turn.completed",
        payload: { turn: turnCount, error: String(err) },
      });
      throw err;
    }

    // Update graph status based on result reason
    const FAILURE_REASONS = new Set(["max_iterations", "max_repairs", "rejected_scope_expansion"]);
    const isFailed = FAILURE_REASONS.has(result.reason ?? "");

    if (isFailed) {
      transitionNodeStatus(taskNode, "failed");
      transitionGraphStatus(taskGraph, "failed");
      await ctx.log.append({
        ...session, type: "task.failed", actor: "system",
        payload: { nodeId: taskNode.id, graphId: taskGraph.id, reason: result.reason, summary: result.summary },
        meta: graphMeta,
      });
      await ctx.log.append({
        ...session, type: "graph.failed", actor: "system",
        payload: { graphId: taskGraph.id, workflowId: wfRun.id, reason: result.reason, summary: result.summary },
        meta: graphMeta,
      });
      await ctx.log.append({
        ...session, type: "workflow.failed", actor: "system",
        payload: { workflowId: wfRun.id, reason: result.reason, summary: result.summary },
        meta: wfMeta,
      });
    } else {
      transitionNodeStatus(taskNode, "done");
      transitionGraphStatus(taskGraph, "completed");
      await ctx.log.append({
        ...session, type: "task.done", actor: "system",
        payload: { nodeId: taskNode.id, graphId: taskGraph.id, summary: result.summary },
        meta: graphMeta,
      });
      await ctx.log.append({
        ...session, type: "graph.completed", actor: "system",
        payload: { graphId: taskGraph.id, workflowId: wfRun.id, summary: result.summary },
        meta: graphMeta,
      });
      transitionWorkflowStatus(wfRun, "completed");
      await ctx.log.append({
        ...session, type: "workflow.completed", actor: "system",
        payload: { workflowId: wfRun.id, summary: result.summary },
        meta: wfMeta,
      });
    }

    // Flush minimal metrics
    metrics.duration("workflow_duration_ms", Date.now() - startTime);
    const metricEvents = metrics.flush();
    for (const m of metricEvents) {
      await ctx.log.append({ ...session, actor: "system", type: "m09.metric", payload: m });
    }

    // Extract tool calls from this turn's new messages
    const newMessages = messages.slice(preTurnMsgCount);
    const turnToolCalls = extractToolCallsFromMessages(newMessages);

    // Update tool history
    for (const tc of turnToolCalls) {
      toolHistory.push({
        toolName: tc.name,
        args: tc.args,
        timestamp: new Date().toISOString(),
      });
    }

    updatedAt = new Date().toISOString();

    // Emit lifecycle event: turn completed
    await ctx.log.append({
      sessionId: ctx.sessionId, actor: "system",
      type: "agent.session.turn.completed",
      payload: { turn: turnCount, summary: result.summary },
    });

    return {
      summary: result.summary,
      sessionId: ctx.sessionId,
      toolCalls: turnToolCalls,
      streamed: result.streamed,
      reason: result.reason,
    };
  }

  function getSessionId(): string {
    if (!ctx) return config.sessionId ?? "";
    return ctx.sessionId;
  }

  function getState(): AgentSessionState {
    return {
      sessionId: getSessionId(),
      messages: Object.freeze([...messages]),
      toolHistory: Object.freeze([...toolHistory]),
      turnCount,
      createdAt,
      updatedAt,
    };
  }

  async function save(): Promise<void> {
    // Stub: save decisions extracted from the event log to memory.
    // Full persistence is external via a future SessionStore interface.
    if (!ctx) return;
    try {
      const sessionEvents = await ctx.log.readAll();
      await saveDecisionsToMemory(sessionEvents, ctx.memoryStore);
    } catch {
      // Best-effort
    }
  }

  async function resume(sessionId: string): Promise<void> {
    // Stub: reconstruct from a prior persisted session.
    if (!ctx) return;
    const { reconstructSession } = await import("../session/resume.js");
    const reconstructed = await reconstructSession(config.cwd, sessionId);
    if (reconstructed.completed) return;

    if (reconstructed.messages.length > 0) {
      messages = [...reconstructed.messages];
      const originalTask = reconstructed.messages.find(m => m.role === "user");
      if (originalTask && typeof originalTask.content === "string") {
        currentTask = originalTask.content;
      }
    }
    if (reconstructed.scopeSnapshot) {
      (ctx as any)._scopeSnapshot = reconstructed.scopeSnapshot;
    }
    if (reconstructed.stateSnapshot) {
      (ctx as any)._stateSnapshot = reconstructed.stateSnapshot;
    }
    if (reconstructed.planContent) {
      (ctx as any)._planContent = reconstructed.planContent;
    }

    await ctx.log.append({
      ...session, actor: "system", type: "session.resumed",
      payload: { priorSessionId: sessionId, task: currentTask },
    });
  }

  return {
    processTurn,
    getSessionId,
    getState,
    save,
    resume,
  };
}
