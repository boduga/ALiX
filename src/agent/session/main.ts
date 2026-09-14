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
import "node:fs";
import "node:path";
import { join } from "node:path";
import "node:os";
import "node:url";
import type { AgentIntent } from "../../run/intent-classifier.js";
import "../../events/event-log.js";

import type { ToolCall, ToolDef } from "../../providers/types.js";
import type { RunResult } from "../../run.js";
import type { StreamHandler } from "../stream.js";
import type { AgentContext } from "../agent.js";
import type { TaskType } from "../../task-classifier.js";
import type { WorkflowRun } from "../../kernel/workflow-run.js";
import type { TaskGraph, TaskNode } from "../../kernel/task-graph.js";
import type { ContextBundle } from "../../repomap/context-compiler.js";
import type { DeferredToolEntry } from "../../mcp/tool-deferral.js";
import type { ExecutionContext } from "../../observability/execution-context.js";
import type { TraceClient } from "../../tracing/client.js";
import { NOOP_TRACE_CLIENT } from "../../tracing/noop-client.js";
import type { MutationSessionState } from "../../run.js";
import "../agent.js";
import { withTraceRun } from "../run-root.js";
import { runTaskLoop } from "../../run/task-loop.js";
import { createProvider } from "../../providers/registry.js";
import type { ModelAdapter } from "../../providers/types.js";
import { taskRouter } from "../../runtime/task-router.js";
import { CancellationToken } from "../../runtime/cancellation-token.js";
import {
  AgentLiveness,
  type AgentLivenessSnapshot,
  type AgentLivenessState,
  type AgentProgressKind,
} from "../agent-liveness.js";
import {
  createAgentActivity,
  transition,
  formatActivityElapsed,
  type AgentActivity,
  type AgentActivityState,
  type ActivityTransitionOpts,
} from "../agent-activity.js";
import { LocalRuntimeExecutor, type RuntimeContext } from "../../runtime/route-executor.js";
import { executeRouteGoverned } from "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import { buildDirectPrompt, buildChatPrompt } from "../../runtime/route-prompts.js";
import { transitionWorkflowStatus } from "../../kernel/workflow-run.js";
import { transitionNodeStatus, transitionGraphStatus } from "../../kernel/task-graph.js";
import {
  classifyTask,
  detectResearchDepth,
  isReadOnlyTask,
  isShellTask,
} from "../../task-classifier.js";
import "../../repomap/context-compiler.js";
import { type TokenizerName } from "../../config/context-limits.js";
import { resolveModelConfig } from "../../config/model-resolver.js";
import { type ContextBudget } from "../../config/context-budget.js";
import "../../utils/tokens.js";
import "../../skills/dispatcher.js";
import "../../skills/lifecycle.js";
import "../../mcp/tool-selector.js";
import { ToolDiscovery } from "../../mcp/tool-discovery.js";
import "../../agents/tool-name-map.js";
import { saveDecisionsToMemory, streamToResponse, continueTruncatedGeneration, TRUNCATION_CONTINUATION_LIMIT } from "../../run/helpers.js";
import { MinimalMetrics } from "../../kernel/minimal-metrics.js";
import { TaskStateMachine, RunLimiter } from "../../autonomy/state-machine.js";
import type { PlanTask } from "../../planning/plan-task.js";
import { FAILURE_REASONS } from "../system-prompt.js";
import { buildSessionStreamHandler, emitSessionEvents, isCancellationError, livenessEventType, readVersionCached } from "./helpers.js";
import { buildSkillsSection, resolveDirectOutputCeiling, resolveExplicitSkills, setupContextAndPlan, setupContextLimits, setupHooks, setupMemory, setupResume, setupSession, setupSkills, setupSystemPrompt, setupTools, setupWorkflow, spliceExplicitIntoFirstTurn, spliceSkillsSection } from "./setup.js";
import { AgentSession, AgentSessionConfig, AgentSessionEvents, AgentSessionState, AgentTurnResult, Message, SessionPhase, ToolExecution } from "./types.js";

export class AgentSessionBuilder {
  private config: Partial<AgentSessionConfig>;

  constructor(config?: AgentSessionConfig) {
    this.config = config ?? {};
  }

  /** Set plan-phase configuration: approval mode and optional gate. */
  withPlan(cfg: { approvalMode?: "interactive" | "deferred"; gate?: import("../../run/plan-approval-gate.js").PlanApprovalGate }): this {
    if (cfg.approvalMode !== undefined) this.config.planApprovalMode = cfg.approvalMode;
    (this.config as any).gate = cfg.gate;
    return this;
  }

  /** Set chat configuration: search tool for workspace queries. */
  withChat(cfg: { chatSearchTool?: (q: string) => Promise<string> }): this {
    (this.config as any).chatSearchTool = cfg.chatSearchTool;
    return this;
  }

  /** Set persistence configuration: approval store and event log. */
  withPersistence(cfg: { approvalStore?: import("../../approvals/approval-store.js").ApprovalStore; eventLog?: import("../../tui/runtime-collector.js").RuntimeCollector }): this {
    (this.config as any).approvalStore = cfg.approvalStore;
    (this.config as any).eventLog = cfg.eventLog;
    return this;
  }

  /** Set event subscription configuration: streaming and diagnostic callbacks. */
  withEvents(cfg: AgentSessionEvents): this {
    (this.config as any).onStream = cfg.onToken ? (token: string) => cfg.onToken(token) : undefined;
    (this.config as any).onToolCall = cfg.onToolCall ? (call: import("../../providers/types.js").ToolCall) => cfg.onToolCall(call) : undefined;
    return this;
  }

  /** Set tool configuration: custom tool descriptors. */
  withTools(cfg: { tools?: import("../../providers/types.js").ToolDef[] }): this {
    if (cfg.tools) (this.config as any).tools = cfg.tools;
    return this;
  }

  build(): AgentSession {
    const config = this.config as AgentSessionConfig;

    // Root tracing facade for this session's processTurn/processChat closures
    // (Task 10). The composition root threads the process TraceClient; when
    // absent (tracing disabled, the default) the inert Noop client is used so
    // every lifecycle call is a cheap no-op and behavior is byte-identical.
    const traceClient: TraceClient = config.traceClient ?? NOOP_TRACE_CLIENT;

    // ---- Mutable internal state (captured by closure) ----
    let initialized = false;
    let ctx: AgentContext;

    function restoreReconstructedPlanTasks(reconstructed: {
      planTasks?: readonly PlanTask[];
    }): void {
      if (reconstructed.planTasks) {
        (ctx as any)._planTasks = reconstructed.planTasks;
        approvedPlanTasks = reconstructed.planTasks;
      }
    }
    let session: { sessionId: string; actor: "system" };
    // The session id as known BEFORE initialize(): config-provided, else one
    // generated once at build time. initialize() threads this into setupSession
    // so ctx.sessionId stays consistent, and every trace root / direct-route
    // result created before the lazy initialize() (processTurn/processChat)
    // carries the real session id instead of "" — otherwise CLI runs lose
    // Langfuse session grouping (v3 parity).
    const resolvedSessionId = config.sessionId ?? randomUUID();
    let wfRun: WorkflowRun;
    let taskGraph: TaskGraph;
    let taskNode: TaskNode;
    let wfMeta: Record<string, string>;
    let graphMeta: Record<string, string>;
    let metrics: MinimalMetrics;

    // Resolved runtime values (computed during init)
    let currentTask = config.task;
    // First-turn session objective, captured once initialize() completes.
    // Threaded into the task loop as `sessionGoal` so bare continuation
    // turns ("continue", "proceed") are verified against the original
    // objective instead of passing with no-ops. Stays undefined for
    // sessions that never complete a first turn (legacy behavior).
    let sessionGoal: string | undefined;
    // The turn's ExecutionContext, set at the top of each processTurnBody
    // invocation so initialize() → setupContextAndPlan → runPlanPhase can
    // thread the same runId/sessionId into every plan-phase provider request.
    let currentRunContext: ExecutionContext | undefined;
    // Explicit skills injected by the caller for this turn (slash commands).
    // Agent-tab only — the chat path (processChat) never sets this.
    let explicitSkills: string[] | undefined;
    let contextBudget: ContextBudget | undefined;
    let tokenizer: TokenizerName = "cl100k_base";
    let taskType: TaskType = "unknown";
    let shellTask = false;
    let readOnlyTask = false;
    let cappedIterations = 25;

    // Setup values
    let systemPrompt = "";
    let contextBundle: ContextBundle | undefined;
    let approvedPlanContent: string | undefined;
    let approvedPlanTasks: readonly PlanTask[] | undefined;
    let memoryContext: string | undefined;
    let memoryStats: string | undefined;
    /**
     * First-turn matched skills (explicit + auto union). Preserved across
     * subsequent turns so the per-turn splice in `processTurn` can re-inject
     * current-turn explicit skills without losing first-turn auto-matched ones.
     * Populated in `initialize()` after the first `setupSkills` call.
     */
    let firstTurnMatchedSkills: any[] = [];
    /**
     * First-turn explicit skill matches only (no auto). Needed by the
     * subsequent-turn splice to REPLACE first-turn explicit with current-turn
     * explicit without affecting first-turn auto-matched skills.
     * Populated in `initialize()` alongside `firstTurnMatchedSkills`.
     */
    let firstTurnExplicitSkills: any[] = [];

    // Tools
    let providerTools: ToolDef[] = [];
    let mcpToolIndex: DeferredToolEntry[] = [];
    let selectedTools: DeferredToolEntry[] = [];
    let mcpDiscovery: ToolDiscovery | null = null;

    // Hooks
    let hooks: {
      pre_task: Array<{ command: string; reason: string }>;
      post_task: Array<{ command: string; reason: string }>;
    } = { pre_task: [], post_task: [] };

    // Session state (accumulated across turns)
    let messages: Message[] = [];
    let toolHistory: ToolExecution[] = [];
    let turnCount = 0;
    const createdAt = new Date().toISOString();
    let updatedAt = new Date().toISOString();
    let _sessionCompleted = false;
    /** Latest rendered progress ledger text, updated by runTaskLoop each iteration. */
    let _latestLedgerText: string | undefined;
    let _latestIntent: AgentIntent | undefined;
    let _filesTouchedCount = 0;
    // Lifecycle phase owned by AgentSession. Observers (TUI) may read via
    // getPhase() but must never mutate — see SessionPhase doc in tui/state.ts.
    // Initial value is Idle so freshly created sessions surface as Idle in the UI
    // before any turn has run.
    let phase: SessionPhase = SessionPhase.Idle;

    // Turn-scoped progress-based liveness tracker. Created when the agent
    // loop begins executing and observed via getLiveness(); replaced on each
    // subsequent turn so startedAt reflects the current run. Undefined
    // between turns / while idle.
    let activeLiveness: AgentLiveness | undefined;

    // Turn-scoped user-facing activity record. Created when the agent loop
    // begins executing and replaced on each turn; undefined between turns.
    // Orthogonal to activeLiveness: activity is what the user *sees*
    // (thinking / running tool / streaming), liveness is whether execution
    // is making progress (healthy / warning / stalled).
    let activeActivity: AgentActivity | undefined;

    // Turn-scoped activity invocation metadata. Refreshed at the top of each
    // processTurn (alongside activeActivity) so a fresh tenant record can be
    // created by feedActivity when a turn has not produced one yet.
    let activityInvocationId: string | undefined;
    let activityModel: { provider: string; model: string } | undefined;

    // Turn-scoped operator-cancellation state (Task 6.1). Armed when the
    // agent loop begins executing; cleared when the turn unwinds. Only one
    // turn executes at a time (matching activeActivity / activeLiveness), so
    // a single slot suffices. cancelActiveTurn flips both the cooperative
    // token (checked at loop safe points) and the abort signal (raced
    // against the in-flight provider request/stream).
    let activeCancel:
      | { token: CancellationToken; controller: AbortController }
      | undefined;
    /** Wall-clock moment the operator requested the cancel (elapsed anchor). */
    let cancelRequestedAt: number | undefined;
    /** User-facing "Cancelled after Ns" summary of the last cancelled turn. */
    let lastCancelSummary: string | undefined;

    // ---- Internal helpers ----

    /**
     * Initialize the session on the first processTurn call.
     * Replicates the setup in agent-loop.ts runTask().
     */
    async function initialize(): Promise<void> {
      // P0: Session init
      const p0 = await setupSession(config.cwd, config.task, {
        sessionId: resolvedSessionId,
        sessionMode: config.sessionMode,
        approvalStore: config.approvalStore,
      });
      ctx = p0.ctx;
      metrics = p0.metrics;
      advancePhase(SessionPhase.Understanding);
      session = { sessionId: ctx.sessionId, actor: "system" as const };

      // P1: Workflow
      const p1 = await setupWorkflow(ctx, session.sessionId, currentTask);
      wfRun = p1.wfRun;
      taskGraph = p1.taskGraph;
      taskNode = p1.taskNode;
      wfMeta = p1.wfMeta;
      graphMeta = p1.graphMeta;

      // P2: Resume
      if (config.resumeSessionId) {
        const p2 = await setupResume(ctx, config.cwd, config.resumeSessionId);
        if (p2.completed) {
          transitionWorkflowStatus(wfRun, "completed");
          await ctx.log.append({
            ...session,
            type: "workflow.completed",
            actor: "system",
            payload: {
              workflowId: wfRun.id,
              summary: `Session ${config.resumeSessionId} is already completed. Use a different session or start a new task.`,
            },
            meta: wfMeta,
          });
          _sessionCompleted = true;
        } else {
          if (p2.currentTask !== undefined) currentTask = p2.currentTask;
          if (p2.resumedMessages)
            (ctx as any)._resumedMessages = p2.resumedMessages;
          if (p2.scopeSnapshot) (ctx as any)._scopeSnapshot = p2.scopeSnapshot;
          if (p2.stateSnapshot) (ctx as any)._stateSnapshot = p2.stateSnapshot;
          if (p2.planContent) (ctx as any)._planContent = p2.planContent;
          if (p2.planTasks) {
            (ctx as any)._planTasks = p2.planTasks;
            approvedPlanTasks = p2.planTasks as readonly PlanTask[];
          }
        }
        await ctx.log.append({
          ...session,
          actor: "system",
          type: "session.resumed",
          payload: {
            priorSessionId: config.resumeSessionId,
            task: currentTask,
          },
        });
      }

      // P3: Memory
      const p3 = await setupMemory(ctx.memoryStore);
      memoryContext = p3.memoryContext;
      memoryStats = p3.memoryStats;

      // P4: Skills
      const matchedSkills = await setupSkills(
        currentTask,
        ctx.config.skills?.factory,
        explicitSkills,
        { projectDir: config.cwd },
      );
      // Persist for per-turn splicing in processTurn (subsequent-turn path).
      firstTurnMatchedSkills = matchedSkills;
      firstTurnExplicitSkills = await resolveExplicitSkills(explicitSkills, config.cwd);

      // P5: Context limits + task classification — resolve the runtime model
      // from the canonical `models` object (§10.1/§10.2).
      const p5 = await setupContextLimits(
        resolveModelConfig(ctx.config),
        ctx.config.apiKeys,
        currentTask,
        config.readOnly,
        ctx.config.context?.budget,
      );
      contextBudget = p5.contextBudget;
      tokenizer = p5.tokenizer;
      taskType = p5.taskType;
      shellTask = p5.shellTask;
      readOnlyTask = p5.readOnlyTask;
      cappedIterations = p5.cappedIterations;

      // P6: Context compilation + Plan
      if (!shellTask && !readOnlyTask && currentTask) {
        const p6 = await setupContextAndPlan(
          ctx,
          config.cwd,
          contextBudget!,
          currentTask,
          taskType,
          ctx.sessionId,
          {
            planMode: config.planMode,
            planFilePath: config.planFilePath,
            planApprovalMode: config.planApprovalMode,
            planApprovalGate: config.planApprovalGate,
            // Run identity for the plan-phase model call (R1, §18 coverage).
            context: currentRunContext,
          },
        );
        contextBundle = p6.contextBundle;

        if (p6.approvedPlanContent) {
          advancePhase(SessionPhase.Planning);
        }

        if (p6.planRejected) {
          transitionWorkflowStatus(wfRun, "failed");
          await ctx.log.append({
            ...session,
            type: "workflow.failed",
            actor: "system",
            payload: {
              workflowId: wfRun.id,
              summary: "Plan rejected. Task cancelled.",
            },
            meta: wfMeta,
          });
          throw new Error("Plan rejected by user");
        }

        if (p6.approvedPlanContent) {
          approvedPlanContent = p6.approvedPlanContent;
          approvedPlanTasks = p6.approvedPlanTasks;
        }
      }

      // P7: Tools
      const p7 = await setupTools(ctx, currentTask, config.readOnly, shellTask);
      providerTools = p7.providerTools;
      mcpToolIndex = p7.mcpToolIndex;
      selectedTools = p7.selectedTools;
      mcpDiscovery = p7.mcpDiscovery;
      await ctx.log.append({
        ...session,
        actor: "system",
        type: "mcp.tools_selected",
        payload: {
          total: mcpToolIndex.length,
          selected: selectedTools.length,
          taskPreview: currentTask.slice(0, 100),
        },
      });

      // P8: System prompt
      systemPrompt = await setupSystemPrompt(config.cwd, {
        readOnly: config.readOnly,
        shellTask,
        matchedSkills,
        contextBundle,
        approvedPlanContent,
        memoryContext,
        memoryStats,
      });

      // P9: Hooks
      hooks = await setupHooks(config.cwd);

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

    /**
     * Emit the user-facing activity indicator state. Transitions the live
     * record (or creates a fresh one for the current invocation) and appends
     * an `agent.session.activity` event carrying the full record. Shared by
     * the turn loop (thinking / streaming / tool_running / watchdog recovery)
     * and advancePhase (verifying / summarizing) so the transition+emit
     * sequence lives in exactly one place.
     */
    const feedActivity = (
      next: AgentActivityState,
      opts?: ActivityTransitionOpts,
    ): void => {
      // ctx may not be wired yet during very early setup (initialize's
      // internal phases never surface an activity record anyway).
      const log = ctx?.log;
      if (!log) return;
      const now = Date.now();
      const nextRecord = activeActivity
        ? transition(activeActivity, next, now, opts)
        : createAgentActivity(next, activityInvocationId ?? "unassigned", now, {
            provider: activityModel?.provider,
            model: activityModel?.model,
            ...opts,
          });
      activeActivity = nextRecord;
      void log
        .append({
          sessionId: ctx.sessionId,
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
      metrics.gauge("agent_activity_state", 1, {
        state: next,
      });
    };

    /**
     * Advance the lifecycle phase. No-op if already in the target phase.
     * Best-effort emits an `agent.session.phase_changed` event so observers
     * (TUI, audit) can react without subscribing to the closure.
     */
    function advancePhase(next: SessionPhase): void {
      if (phase === next) return;
      phase = next;
      // A phase transition is genuine execution progress.
      activeLiveness?.mark("phase_changed", next);
      // ctx may not be wired yet during very early setup; append is safe to skip
      // in that window because phase is also exposed via getPhase().
      const log = ctx?.log;
      if (!log) return;
      // Task 2.4 — surface user-visible phases on the activity indicator.
      // Internal phases (Understanding / Planning / Executing) are not
      // exposed; only Verifying and Summarizing map to activity states.
      // feedActivity owns the transition + event emission (deduped here).
      if (next === SessionPhase.Verifying && activeActivity) {
        feedActivity("verifying");
      } else if (next === SessionPhase.Summarizing && activeActivity) {
        feedActivity("summarizing");
      }
      void log
        .append({
          sessionId: ctx.sessionId,
          actor: "system",
          type: "agent.session.phase_changed",
          payload: { phase: next },
        })
        .catch(() => {
          // Observability must never break the turn loop.
        });
    }

    /**
     * Observe the current lifecycle phase. TUI-only contract: the value is
     * owned by AgentSession; consumers must not mutate.
     */
    function getPhase(): SessionPhase {
      return phase;
    }

    /**
     * Observe the active turn's progress-based liveness snapshot. Returns
     * undefined while no agent loop is executing (idle, planning, summarising).
     * Read-only — the tracker is owned by the turn.
     */
    function getLiveness(): AgentLivenessSnapshot | undefined {
      return activeLiveness?.snapshot();
    }

    /** Observe the active invocation's live activity record. */
    function getActivity(): AgentActivity | undefined {
      return activeActivity;
    }

    /**
     * True once an operator/execution cancel has been requested for the
     * active invocation (cancelling in progress or already cancelled). The
     * competing activity feeds (streaming chunk, tool progress, watchdog
     * stall mapping) must not regress the indicator once cancel is underway.
     */
    function cancellationInProgress(): boolean {
      const s = activeActivity?.state;
      return s === "cancelling" || s === "cancelled";
    }

    /**
     * Operator cancel (Task 6.1): flip the shared per-turn token and abort
     * the provider/stream signal. The live surface flips to `cancelling`
     * ("Cancelling…") so the operator sees the request is being honoured
     * while the turn unwinds. No-op (false) when no cancellable turn runs.
     */
    function cancelActiveTurn(reason?: string): boolean {
      const active = activeCancel;
      if (!active) return false;
      // Terminal-window check: a cancel is only meaningful while the turn's
      // model loop is genuinely in flight (the Executing phase). Once the
      // loop has resolved and the turn is in its post-loop verifying /
      // summarizing / delivering tail there are no further cancellation
      // checks — honouring an Escape there would silently swallow it while
      // the turn completes normally. Refuse instead so the caller treats the
      // Escape as a no-op (returns false). activeCancel is normally cleared
      // in the loop's finally, but this guard makes the contract durable.
      if (phase !== SessionPhase.Executing) return false;
      const r = reason ?? "cancelled by operator";
      active.token.cancel(r);
      active.controller.abort(r);
      cancelRequestedAt = Date.now();
      if (activeActivity && !cancellationInProgress()) {
        feedActivity("cancelling");
      }
      return true;
    }

    /** Human-readable "Cancelled after Ns" for the most recent cancelled turn. */
    function getLastCancelSummary(): string | undefined {
      return lastCancelSummary;
    }

    // ---- Exported interface methods ----

    /**
     * processTurn — root-instrumented turn entry (Task 10, R1).
     *
     * The trace root lives at the TRUE entry of processTurn — BEFORE the
     * classifier, direct-generation, grounded-chat and plan-phase work that
     * all precede the agent-loop runId inside processTurnBody. ONE run-<uuid8>
     * is hoisted here and reused as the body's runId (same identity → model
     * spans in the loop resolve via getRun(context.runId)); every terminal
     * path (recon §3 a–i) endRuns exactly once through the finally below.
     * When tracing is disabled (Noop) these are cheap no-ops and behavior is
     * byte-identical to the uninstrumented path.
     */
    async function processTurn(
      message: string,
      options?: { skills?: string[] },
    ): Promise<AgentTurnResult> {
      const runId = `run-${randomUUID().slice(0, 8)}`;
      const traceRun = traceClient.startRun({
        runId,
        sessionId: resolvedSessionId,
        task: message,
        actor: "agent",
        parentRunId: config.parentRunId,
        startedAt: Date.now(),
      });
      // One shared terminal-outcome wrapper for all the run roots in this
      // file (see src/agent/run-root.ts): body result mapped to success/error,
      // an escaping throw classified cancellation-vs-error, endRun exactly
      // once via the finally. Tracing failures never alter the turn.
      return withTraceRun(
        traceClient,
        traceRun,
        "processTurn ended before its outcome could be recorded",
        (result) => ({
          status: FAILURE_REASONS.has(result.reason ?? "") ? "error" : "success",
          endedAt: Date.now(),
        }),
        () => processTurnBody(message, runId, options),
      );
    }

    /**
     * processTurnBody — the original processTurn execution body, unchanged
     * except that its per-turn `runId` now arrives from the root wrapper.
     */
    async function processTurnBody(
      message: string,
      runId: string,
      options?: { skills?: string[] },
    ): Promise<AgentTurnResult> {
      // The turn's execution context (same identity the root wrapper's startRun
      // used). Threaded into classifier, direct-generation, grounded-chat and
      // plan-phase provider requests so their model spans resolve to this run
      // via getRun(request.context.runId) (R1, design §18).
      const turnContext: ExecutionContext = {
        runId,
        sessionId: resolvedSessionId,
        ...(config.parentRunId ? { parentRunId: config.parentRunId } : {}),
      };
      currentRunContext = turnContext;
      // Thread the explicit skill list (slash commands) into the next
      // initialize() pass. Undefined on the chat path — never touched there.
      explicitSkills = options?.skills;
      // Resolve explicit skill matches ONCE per turn. Used by direct routes
      // (to build the augmented "Answer concisely." prompt) and by the
      // subsequent-turn splice (to inject slash skills into the existing
      // system prompt). Recomputed every turn so a persistent session's
      // subsequent turns don't silently drop the selected skill (Tab 4 fix).
      const currentTurnExplicit = await resolveExplicitSkills(explicitSkills, config.cwd);
      // ── Preflight classification ─────────────────────────────────────────
      // Classify the message BEFORE any initialization. Direct routes bypass
      // the full agent lifecycle entirely. Grounded_chat routes are handled
      // by the route executor's two-step tool→synthesis pattern. All other
      // route kinds fall through to initialize() → runTaskLoop().
      // Resolve classifier provider for the hybrid fallback.
      // When configured via classifierModel, use that explicitly; otherwise
      // fall back to chatModel (cheaper path) when available. When neither
      // is set, the router stays purely deterministic — no provider cost.
      const classifierCfg = config.classifierModel ?? config.chatModel;
      const classifierProvider = classifierCfg
        ? await createProvider(classifierCfg, config.chatApiKey).catch(
            () => null,
          )
        : null;

      const route = await taskRouter(message, {
        classifierProvider: classifierProvider ?? undefined,
        // Enables model-based classifier spans under the run's trace when the
        // low-confidence fallback fires (R1, §18 coverage for the classifier).
        context: turnContext,
      });
      if (route.kind === "direct") {
        // Fire the diagnostic callback if one is wired (Task 4).
        // Callback failures are swallowed — diagnostics are observability,
        // never a control surface.
        if (route.diagnostic && config.onRouteDiagnostic) {
          try {
            config.onRouteDiagnostic(route.diagnostic);
          } catch {
            /* swallow */
          }
        }

        // Arithmetic — deterministic answer, no provider call.
        if (route.answer !== undefined) {
          return {
            summary: route.answer,
            sessionId: resolvedSessionId,
            toolCalls: [],
            streamed: false,
            reason: "direct",
          };
        }

        // Standalone generation — exactly one provider call, no tool loop.
        // Resolve the provider: check chatProvider first, then chatModel,
        // falling back to the existing [chat:no-provider] placeholder when
        // no provider is available (never falls through to the agent loop).
        const genProvider =
          config.chatProvider ??
          (config.chatModel
            ? await createProvider(config.chatModel, config.chatApiKey).catch(
                () => null,
              )
            : null);
        if (!genProvider) {
          return {
            summary: `[chat:no-provider] ${message}`,
            sessionId: resolvedSessionId,
            toolCalls: [],
            streamed: false,
            reason: "direct",
          };
        }
        let _providerError: string | undefined;
        // Direct routes bypass `initialize()` so `setupSkills` never runs for
        // them. Splice the current-turn explicit skills into the hardcoded
        // prompt so slash-command injection works on the direct path too.
        // Layer 3 prompt construction (T16 #393): consume the canonical-intent
        // label from the route diagnostic — do NOT re-classify raw prompt text.
        const directBasePrompt = buildDirectPrompt(
          route.diagnostic.classification,
        ).systemPrompt;
        const directSystemPrompt =
          currentTurnExplicit.length > 0
            ? `${directBasePrompt}\n\n${buildSkillsSection(currentTurnExplicit)}`
            : directBasePrompt;
        // Stream live when enabled (matches the loader default and the
        // runTaskLoop path) so the in-process TUI shows tokens as they
        // arrive. The direct route runs before initialize() so the
        // context's model isn't resolved yet — the closure-captured
        // top-level `config.streaming` (from the resolved model) is the
        // source. `streamToResponse` fail-softs to a blocking complete() on
        // mid-stream error, matching runTaskLoop's behavior.
        const useStream = config.streaming !== false;
        const genMaxOutputTokens = await resolveDirectOutputCeiling(
          config.chatModel,
          config.chatApiKey,
        );
        const genResponse = await (useStream && genProvider.stream
          ? streamToResponse(genProvider, {
              systemPrompt: directSystemPrompt,
              messages: [{ role: "user", content: route.prompt }],
              maxOutputTokens: genMaxOutputTokens,
              context: turnContext,
            }, {
              onStream: (chunk) => {
                if (chunk.type === "text" && typeof chunk.text === "string") {
                  config.events?.onToken?.(chunk.text);
                }
              },
            })
          : genProvider.complete({
              systemPrompt: directSystemPrompt,
              messages: [{ role: "user", content: route.prompt }],
              maxOutputTokens: genMaxOutputTokens,
              context: turnContext,
            })
        ).catch((err: unknown) => {
          _providerError = err instanceof Error ? err.message : String(err);
          return null;
        });
        if (!genResponse) {
          return {
            summary: `[chat:provider-error] ${_providerError ?? message}`,
            sessionId: resolvedSessionId,
            toolCalls: [],
            streamed: false,
            reason: "direct",
          };
        }
        return {
          summary: genResponse.text || "(no response)",
          sessionId: resolvedSessionId,
          toolCalls: [],
          // The chat/direct route calls streamToResponse when streaming is on,
          // so the result reflects the actual path used. runTaskLoop and the
          // agent loop set this the same way (from the resolved model).
          streamed: useStream && Boolean(genProvider.stream),
          reason: "direct",
        };
      }

      // ── Grounded chat — init then route executor ─────────────────────────
      // External retrieval prompts need the two-step tool→synthesis pattern
      // (search the web, then have the model synthesize an answer). The route
      // executor handles this; the full agent loop would return raw tool output.
      // We initialize first to get ctx (needed for the RuntimeContext), then
      // delegate to the executor and return immediately — no agent loop.
      if (route.kind === "grounded_chat") {
        if (!initialized) {
          if (!currentTask) currentTask = message;
          await initialize();
        } else {
          advancePhase(SessionPhase.Understanding);
          // Subsequent-turn splice: re-inject current-turn explicit skills
          // into the system prompt (preserves first-turn auto-match via
          // `firstTurnMatchedSkills`). Without this, slash skills are
          // silently dropped after the first turn on a persistent session.
          if (currentTurnExplicit.length > 0) {
            systemPrompt = spliceSkillsSection(
              systemPrompt,
              await spliceExplicitIntoFirstTurn(
                firstTurnMatchedSkills,
                firstTurnExplicitSkills,
                currentTurnExplicit,
              ),
            );
          }
        }
        if (_sessionCompleted) {
          return {
            summary: `Session ${ctx.sessionId} is already completed.`,
            sessionId: ctx.sessionId,
            toolCalls: [],
            streamed: false,
            reason: "completed",
          };
        }
        updatedAt = new Date().toISOString();

        const executor = new LocalRuntimeExecutor();
        const runtimeCtx: RuntimeContext = {
          cwd: config.cwd,
          sessionId: ctx.sessionId,
          sessionDir: ctx.sessionDir,
          eventLog: ctx.log,
          config: ctx.config,
          onRouteDiagnostic: config.onRouteDiagnostic,
          // Thread the turn's run identity so grounded-chat model calls and
          // tool spans resolve under the run's trace (R1, §18/§21 coverage).
          context: turnContext,
        };
        // Governed execution (#404): every routed task flows through the
        // ExecutionIntent lifecycle (created→approved→running→terminal) via
        // executeRouteGoverned, which composes the unchanged executeRoute
        // dispatcher. Governed evidence is persisted to the X3b
        // ExecutionEvidenceStore (fire-and-forget; a store failure never
        // stalls the route). The route result is returned as before.
        const { PersistenceEvidenceEmitter } = await import(
          "../../runtime/execution-persistence.js"
        );
        const { ExecutionEvidenceStore } = await import(
          "../../runtime/execution-evidence-store.js"
        );
        const governed = await executeRouteGoverned(route, runtimeCtx, executor, {
          emitter: new PersistenceEvidenceEmitter(
            new ExecutionEvidenceStore(join(config.cwd, ".alix", "governance")),
          ),
        });
        const summary = governed.result;
        return {
          summary,
          sessionId: ctx.sessionId,
          toolCalls: [],
          streamed: false,
          reason: "grounded_chat",
        };
      }

      const continuingAgentSession = initialized;
      if (!initialized) {
        // Seed currentTask from the first message so the planning phase has
        // a task to work with (TUI creates sessions with an empty task).
        if (!currentTask) currentTask = message;
        await initialize();
        // Capture the first-turn objective exactly once, after initialize()
        // has normalized currentTask from the opening message.
        sessionGoal ??= currentTask;
      } else {
        // Lifecycle phase: subsequent turn started → Understanding. First-turn
        // initialization performs the same transition once ctx.log is available.
        advancePhase(SessionPhase.Understanding);
        // Subsequent-turn splice: re-inject current-turn explicit skills
        // into the system prompt (preserves first-turn auto-match via
        // `firstTurnMatchedSkills`). Without this, slash skills are
        // silently dropped after the first turn on a persistent session.
        if (currentTurnExplicit.length > 0) {
          systemPrompt = spliceSkillsSection(
            systemPrompt,
            await spliceExplicitIntoFirstTurn(
              firstTurnMatchedSkills,
              firstTurnExplicitSkills,
              currentTurnExplicit,
            ),
          );
        }
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

      // Each processTurn is a new execution objective even though the
      // conversation history persists. Keeping the first message here made
      // later turns inherit stale task classification/tool scoping and made
      // their audit records point at an already-completed workflow.
      currentTask = message;
      const turnTaskType = classifyTask(message);
      const turnDepth = detectResearchDepth(message);
      const turnShellTask = route.kind === "tool" || isShellTask(message);
      const turnReadOnlyTask = isReadOnlyTask(message) || turnShellTask;

      if (continuingAgentSession) {
        const nextWorkflow = await setupWorkflow(ctx, session.sessionId, message);
        wfRun = nextWorkflow.wfRun;
        taskGraph = nextWorkflow.taskGraph;
        taskNode = nextWorkflow.taskNode;
        wfMeta = nextWorkflow.wfMeta;
        graphMeta = nextWorkflow.graphMeta;
      }

      updatedAt = new Date().toISOString();

      // Emit lifecycle event: turn started
      await ctx.log.append({
        sessionId: ctx.sessionId,
        actor: "system",
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

      // Build execution context for diagnostic correlation. runId is the
      // turn root established at processTurn entry (R1) — same identity used
      // for the trace and for model-span resolution via getRun(context.runId).
      const resolved = resolveModelConfig(ctx.config);
      const taskContext: ExecutionContext = {
        runId,
        sessionId: ctx.sessionId,
        workflowId: wfRun.id,
        providerId: resolved.provider,
        model: resolved.name,
        parentRunId: config.parentRunId,
      };

      // Snapshot pre-turn message count to identify this turn's additions
      const preTurnMsgCount = messages.length;

      // Update graph status (first turn transitions from ready / created)
      transitionNodeStatus(taskNode, "running");
      transitionGraphStatus(taskGraph, "running");
      await ctx.log.append({
        ...session,
        type: "task.started",
        actor: "system",
        payload: { nodeId: taskNode.id, graphId: taskGraph.id },
        meta: graphMeta,
      });
      await ctx.log.append({
        ...session,
        type: "graph.status_changed",
        actor: "system",
        payload: { graphId: taskGraph.id, status: "running" },
        meta: graphMeta,
      });

      const startTime = Date.now();

      // Lifecycle phase: about to call runTaskLoop → Executing. Tool-call
      // events (tool.*) are emitted inside runTaskLoop itself; this hook fires
      // immediately before the call so observers see the phase move from
      // Planning to Executing as the task loop enters its execution path.
      advancePhase(SessionPhase.Executing);

      // Build TaskLoopDeps and run the agent loop
      let result: RunResult;
      // ── Progress-based liveness watchdog ──────────────────────────────
      // The agent loop has NO wall-clock lifetime. The watchdog measures the
      // idle window since the last progress mark and, on state transition,
      // emits agent.liveness.warning / agent.liveness.recovered /
      // agent.liveness.stalled events so an operator can see a suspected
      // stall resolve. It NEVER terminates the run — a turn lives until its
      // terminal state or explicit operator cancel.
      const liveness = new AgentLiveness();
      activeLiveness = liveness;

      // ── Operator cancellation (Task 6.1) ──────────────────────────────
      // Each loop-bound turn owns a CancellationToken + AbortController pair.
      // cancelActiveTurn() flips the token (checked at loop safe points) and
      // aborts the signal (raced against the in-flight provider request /
      // stream). Armed here — the instant the loop path begins — and cleared
      // in the finally below. A fresh pair per turn so a stale cancel can
      // never bleed into the next invocation.
      const cancelController = new AbortController();
      const cancelToken = new CancellationToken();
      activeCancel = { token: cancelToken, controller: cancelController };
      cancelRequestedAt = undefined;
      lastCancelSummary = undefined;

      // ── Live user-facing activity feed ────────────────────────────────
      // Derives the AgentActivity record from existing runtime seams (turn
      // start, tool progress, streamed model chunks, phase transitions, and
      // the liveness watchdog) rather than a second polling architecture.
      // Every state change emits an `agent.session.activity` event carrying
      // the full record so later tasks can render / observe it.
      activityInvocationId = `${runId}-${randomUUID().slice(0, 8)}`;
      activityModel = { provider: resolved.provider, model: resolved.name };
      // Task 2.1 — invocation begins: THINKING with timestamps stamped now.
      feedActivity("thinking");
      // True once the model has emitted a visible text chunk for the CURRENT
      // model-output phase. Reset when that phase ends (a tool begins), so a
      // later tool completion returns the indicator to thinking while the
      // model silently resumes. Set again by the next phase's first chunk.
      let activityStreaming = false;

      const sessionOnStream = buildSessionStreamHandler(config.onStream, config.events);
      // The activity/liveness feed attaches to EVERY provider stream — CLI,
      // REPL and daemon callers do not supply config.onStream, so without this
      // the indicator would stall on waiting_for_provider and liveness would
      // never be marked outside the TUI. The caller's own handler is only
      // forwarded to when one was supplied.
      const livenessOnStream: StreamHandler = (chunk) => {
        if (chunk.type === "reasoning" && typeof chunk.text === "string") {
          // Private reasoning (e.g. a long DeepSeek reasoning phase) is a
          // real progress signal but is NEVER visible: mark liveness so
          // the watchdog does not report a healthy thought-phase as a
          // stall, and do NOT feed streaming / forward the trace onward.
          liveness.mark("model_chunk");
          return;
        }
        // Every streamed text token means the model is alive — mark
        // progress (AgentLiveness debounces the hot per-chunk flow).
        if (chunk.type === "text" && typeof chunk.text === "string") {
          liveness.mark("model_chunk");
          // Task 2.3 — first visible chunk: WAITING_FOR_PROVIDER → STREAMING;
          // every accepted chunk refreshes lastProgressAt (via transition()).
          // A chunk racing an in-flight cancel must not regress the
          // indicator away from cancelling/cancelled.
          if (activeActivity && !cancellationInProgress()) {
            if (activeActivity.state !== "streaming") {
              feedActivity("streaming");
            } else {
              activeActivity = transition(
                activeActivity,
                "streaming",
                Date.now(),
              );
            }
          }
          activityStreaming = true;
        }
        if (sessionOnStream) sessionOnStream(chunk);
      };
      let lastLivenessState: AgentLivenessState = "healthy";
      const livenessWatchdog = setInterval(() => {
        const snap = liveness.snapshot();
        if (snap.state === lastLivenessState) return;
        lastLivenessState = snap.state;
        void ctx.log
          .append({
            sessionId: ctx.sessionId,
            actor: "system",
            type: livenessEventType(snap.state),
            payload: {
              runId,
              lastProgressAt: new Date(snap.lastProgressAt).toISOString(),
              idleMs: snap.idleMs,
              lastProgressKind: snap.lastProgressKind,
              lastProgressDescription: snap.lastProgressDescription,
              phase: getPhase(),
            },
          })
          .catch(() => {
            // Observability must never break the turn loop.
          });
        // Phase 9 observability — the watchdog is the natural owner of the
        // progress-age gauge (it is the only site where idleMs is measured).
        // Sample the age once per liveness-state transition (bounded, never
        // per tick) and count each warning/stalled transition as one stall
        // warning. A stall warning is NOT an invocation failure — failures
        // and cancellations are counted only at their terminal outcome.
        // The age sample carries NO invocationId label (a fresh per-invocation
        // UUID is unbounded high-cardinality; the invocationId stays on the
        // activity event payload, never on the metric row).
        metrics.gauge("agent_last_progress_age_ms", snap.idleMs);
        if (snap.state === "warning" || snap.state === "stalled") {
          metrics.increment("agent_stall_warning_total", { state: snap.state });
        }
        // Reflect suspected stalls in the activity record: warning / stalled →
        // possibly_stalled (diagnostic, never terminal); recovery → back to
        // thinking (or streaming if text is already arriving). A stall must
        // not override an in-flight operator cancel (cancelling/cancelled).
        // A LIVE tool is itself evidence of progress: it emits a tool_started
        // mark at dispatch and a tool_completed mark at the end — a long-but-
        // alive child produces no intermediate marks — so the watchdog must
        // never relabel an actively-running tool as a possible stall. The
        // tool's own timeoutMs/commandTimeoutMs is its safety bound. Only the
        // liveness tracker's own warning/stalled states are watchdog-side;
        // the ACTIVITY state stays tool_running while the tool is live.
        if (
          snap.state !== "healthy" &&
          activeActivity &&
          activeActivity.state !== "tool_running" &&
          !cancellationInProgress()
        ) {
          if (activeActivity.state !== "possibly_stalled") {
            feedActivity("possibly_stalled");
          }
        } else if (activeActivity && !cancellationInProgress()) {
          if (activeActivity.state === "possibly_stalled") {
            feedActivity(activityStreaming ? "streaming" : "thinking");
          }
        }
        // Non-ref'ing: a completed turn must never be kept alive by the
        // watchdog, and a stale interval must not keep emitting stall events
        // for a turn that already ended (clearInterval covers the happy path;
        // this guarantees the process can exit and no post-completion spam).
      }, 5_000).unref();

      // Phase 9 observability helpers. `flushMetrics` persists the buffered
      // rows to the event log once per turn on BOTH the success and the
      // thrown-failure path (previously the failure path dropped the buffer);
      // `recordTerminalOutcome` emits the agent_activity_duration_ms sample
      // at the invocation's terminal state.
      const flushMetrics = async (): Promise<void> => {
        const metricEvents = metrics.flush();
        for (const m of metricEvents) {
          await ctx.log.append({
            ...session,
            actor: "system",
            type: "observability.metric",
            payload: m,
          });
        }
      };
      const recordTerminalOutcome = (
        state: "completed" | "failed" | "cancelled",
      ): void => {
        // Duration spans the live activity record (invocation start, stamped
        // at THINKING) through the terminal outcome, so thinking/verifying/
        // summarizing phases are included — not just the runTaskLoop window.
        // Only bounded dimensions are labels: state (completed/failed/
        // cancelled). The per-invocation invocationId is NOT a metric label
        // (high-cardinality); it rides on the activity event payload instead.
        const invocationStartedAt = activeActivity?.startedAt;
        if (invocationStartedAt !== undefined) {
          metrics.duration("agent_activity_duration_ms", Date.now() - invocationStartedAt, {
            state,
          });
        }
      };
      try {
        result = await runTaskLoop({
          config: {
            // Canonical `models` only — the loop resolves via resolveModelConfig.
            models: ctx.config.models,
            permissions: {
              sessionMode: ctx.config.permissions.sessionMode,
            },
            skills: ctx.config.skills,
            context: ctx.config.context,
          },
          provider: ctx.provider,
          providerTools,
          mcpToolIndex,
          // Agent executions are objective-scoped. Keep the accumulated
          // conversation for the session UI/audit trail, but give the task
          // loop only the current objective. The lightweight chat path below
          // still receives full chat history, so conversational continuity is
          // preserved where it belongs without allowing completed agent turns
          // to leak into a later task's summary.
          messages: [{ role: "user", content: message }],
          sessionState,
          stateMachine,
          scope: ctx.scope,
          session,
          log: ctx.log,
          executor: ctx.toolExecutor,
          mcpDiscovery,
          selectedTools,
          hooks,
          maxIterations: turnShellTask ? Math.min(cappedIterations, 2) : cappedIterations,
          contextBudget: contextBudget!,
          tokenizer,
          task: message,
          taskType: turnTaskType,
          sessionGoal,
          depth: turnDepth,
          readOnly: config.readOnly ?? turnReadOnlyTask,
          shellTask: turnShellTask,
          memoryStore: ctx.memoryStore,
          sessionId: ctx.sessionId,
          sessionDir: ctx.sessionDir,
          systemPrompt,
          onStream: livenessOnStream,
          hookRunner: ctx.hookRunner,
          context: taskContext,
          verbose: config.verbose,
          onLedgerUpdate: (text: string) => { _latestLedgerText = text; },
          onCurrentIntentUpdate: (intent: AgentIntent) => { _latestIntent = intent; },
          // Task 6.1 — propagate the shared cancellation primitives into the
          // loop. The loop checks the token at its safe points and races the
          // signal against the in-flight provider request/stream.
          cancellationToken: cancelToken,
          cancelSignal: cancelController.signal,
          onProgress: (kind: AgentProgressKind, description?: string) => {
            liveness.mark(kind, description);
            // Tool progress racing an in-flight cancel must not regress the
            // indicator away from cancelling/cancelled.
            if (cancellationInProgress()) return;
            if (kind === "model_requested" && activeActivity) {
              // A provider/model call has started and no content has arrived
              // yet — the closest reachable mapping of the design's
              // "provider accepted request, waiting for content" row. Only
              // when the current model phase is not already streaming; the
              // first visible chunk moves the indicator to STREAMING.
              if (!activityStreaming) feedActivity("waiting_for_provider");
            } else if (kind === "tool_started" && activeActivity) {
              // Task 2.2 — a tool begins executing: TOOL_RUNNING with its name.
              // Round 1 — stamp toolStartedAt so the tool timer starts at TOOL
              // start (not the invocation start, which includes thinking time).
              // Beginning the tool also ENDS the model-output phase, so the
              // streaming latch resets: when the tool completes the indicator
              // returns to THINKING while the model silently resumes.
              activityStreaming = false;
              feedActivity("tool_running", { toolName: description, toolStartedAt: Date.now() });
            } else if (kind === "tool_completed" && activeActivity) {
              // Tool finished → back to THINKING unless the model is already
              // streaming (subsequent model text takes over the indicator).
              if (!activityStreaming) feedActivity("thinking");
            }
          },
        });
      } catch (err) {
        // ── Operator / execution cancellation vs genuine failure (Task 6.3) ──
        // A cancelled turn is a distinct terminal outcome: it must never be
        // marked failed (graph/workflow), never counted as failed, and never
        // reported as a timeout. Cancellation and failure are mutually
        // exclusive; neither is a stall warning (a warning/stalled transition
        // was already counted at the watchdog and must NOT be counted again).
        if (isCancellationError(err)) {
          transitionNodeStatus(taskNode, "cancelled");
          transitionGraphStatus(taskGraph, "cancelled");
          transitionWorkflowStatus(wfRun, "cancelled");
          // Cancelled audit rows mirror the failure paths (task.failed +
          // graph.failed + workflow.failed on result-failure; task.failed +
          // workflow.failed on a thrown failure) so the JSONL trail is
          // symmetric: node, then graph, then workflow — each with the same
          // correlation the sibling failure rows carry.
          await ctx.log.append({
            ...session,
            type: "task.cancelled",
            actor: "system",
            payload: {
              nodeId: taskNode.id,
              graphId: taskGraph.id,
              error: String(err),
              summary: String(err),
            },
            meta: graphMeta,
          });
          await ctx.log.append({
            ...session,
            type: "graph.cancelled",
            actor: "system",
            payload: {
              graphId: taskGraph.id,
              workflowId: wfRun.id,
              error: String(err),
              summary: String(err),
            },
            meta: graphMeta,
          });
          await ctx.log.append({
            ...session,
            type: "workflow.cancelled",
            actor: "system",
            payload: {
              workflowId: wfRun.id,
              nodeId: taskNode.id,
              graphId: taskGraph.id,
              summary: String(err),
            },
            meta: wfMeta,
          });
          metrics.increment("agent_invocation_cancelled_total");
          recordTerminalOutcome("cancelled");
          // Terminal activity state: the live "Cancelling…" record resolves to
          // `cancelled` so the gauge/event history show the true outcome.
          if (activeActivity && activeActivity.state !== "cancelled") {
            feedActivity("cancelled");
          }
          // Surface the elapsed-from-start summary ("Cancelled after 4m 12s")
          // for the TUI's summary line. Anchored at the operator's cancel
          // request; falls back to now (execution-initiated cancellation).
          const cancelledAt = cancelRequestedAt ?? Date.now();
          const invocationStartedAt = activeActivity?.startedAt;
          lastCancelSummary =
            invocationStartedAt !== undefined
              ? `Cancelled after ${formatActivityElapsed(cancelledAt - invocationStartedAt)}`
              : "Cancelled";
          // Emit lifecycle event: turn completed (cancelled)
          await ctx.log.append({
            sessionId: ctx.sessionId,
            actor: "system",
            type: "agent.session.turn.completed",
            payload: { turn: turnCount, cancelled: true, error: String(err) },
          });
        } else {
          transitionNodeStatus(taskNode, "failed");
          await ctx.log.append({
            ...session,
            type: "task.failed",
            actor: "system",
            payload: {
              nodeId: taskNode.id,
              graphId: taskGraph.id,
              error: String(err),
            },
            meta: graphMeta,
          });
          transitionWorkflowStatus(wfRun, "failed");
          await ctx.log.append({
            ...session,
            type: "workflow.failed",
            actor: "system",
            payload: { workflowId: wfRun.id, summary: String(err) },
            meta: wfMeta,
          });

          // Emit lifecycle event: turn completed (error)
          await ctx.log.append({
            sessionId: ctx.sessionId,
            actor: "system",
            type: "agent.session.turn.completed",
            payload: { turn: turnCount, error: String(err) },
          });
          metrics.increment("agent_invocation_failed_total");
          recordTerminalOutcome("failed");
          // Terminal activity state: the live record resolves to `failed` so
          // the gauge/event history show the true outcome (mirrors the
          // cancelled branch's feed above). The success-path flush below is
          // never reached when the loop throws, so this feed lands in the
          // shared catch-path flush.
          if (activeActivity && activeActivity.state !== "failed") {
            feedActivity("failed");
          }
        }
        // Persist the failure/cancellation-path rows: the success-path flush
        // below is never reached when the loop throws.
        await flushMetrics();
        turnCount++;
        activeActivity = undefined;
        throw err;
      } finally {
        clearInterval(livenessWatchdog);
        activeLiveness = undefined;
        activeCancel = undefined;
        cancelRequestedAt = undefined;
      }

      // Cumulative file count for the TUI header. sessionState is local to
      // processTurn (a fresh MutationSessionState is allocated per turn), so we
      // sum its three file sets and add to the closure counter.
      _filesTouchedCount +=
        sessionState.changed.size + sessionState.created.size + sessionState.deleted.size;

      // Verifying phase begins as the task loop's verifier pass completes; the TUI
      // shows "Verifying" between this transition and the eventual "Summarizing"
      // once summary lines are emitted. During the actual verifier pass, the TUI
      // still shows "Executing": the verifier lives inside runTaskLoop, so this is
      // the post-verify-pre-result proxy boundary within the two-file scope.
      advancePhase(SessionPhase.Verifying);

      // Update graph status based on result reason
      const isFailed = FAILURE_REASONS.has(result.reason ?? "");

      // Preserve a truthful conversational boundary for the next turn. The
      // loop works on an assembled local message array, so its summary must
      // be explicitly committed to the session-owned history here.
      messages.push({ role: "assistant", content: result.summary });

      if (isFailed) {
        transitionNodeStatus(taskNode, "failed");
        transitionGraphStatus(taskGraph, "failed");
        await ctx.log.append({
          ...session,
          type: "task.failed",
          actor: "system",
          payload: {
            nodeId: taskNode.id,
            graphId: taskGraph.id,
            reason: result.reason,
            summary: result.summary,
          },
          meta: graphMeta,
        });
        await ctx.log.append({
          ...session,
          type: "graph.failed",
          actor: "system",
          payload: {
            graphId: taskGraph.id,
            workflowId: wfRun.id,
            reason: result.reason,
            summary: result.summary,
          },
          meta: graphMeta,
        });
        await ctx.log.append({
          ...session,
          type: "workflow.failed",
          actor: "system",
          payload: {
            workflowId: wfRun.id,
            reason: result.reason,
            summary: result.summary,
          },
          meta: wfMeta,
        });
      } else {
        transitionNodeStatus(taskNode, "done");
        transitionGraphStatus(taskGraph, "completed");
        await ctx.log.append({
          ...session,
          type: "task.done",
          actor: "system",
          payload: {
            nodeId: taskNode.id,
            graphId: taskGraph.id,
            summary: result.summary,
          },
          meta: graphMeta,
        });
        await ctx.log.append({
          ...session,
          type: "graph.completed",
          actor: "system",
          payload: {
            graphId: taskGraph.id,
            workflowId: wfRun.id,
            summary: result.summary,
          },
          meta: graphMeta,
        });
        transitionWorkflowStatus(wfRun, "completed");
        await ctx.log.append({
          ...session,
          type: "workflow.completed",
          actor: "system",
          payload: { workflowId: wfRun.id, summary: result.summary },
          meta: wfMeta,
        });
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

      // Lifecycle phase: summary produced → Summarizing. The summary emitted
      // here is the user-visible synthesis of the turn; the phase flips before
      // the turn-completed audit event so observers see Summarizing line up
      // with the response delivery path.
      advancePhase(SessionPhase.Summarizing);

      // Emit lifecycle event: turn completed
      await ctx.log.append({
        sessionId: ctx.sessionId,
        actor: "system",
        type: "agent.session.turn.completed",
        payload: { turn: turnCount, summary: result.summary },
      });

      // Fire session events (spec §13): one per tool call + tool result in this turn.
      emitSessionEvents(config.events, turnToolCalls, messages, toolHistory);

      turnCount++;

      // Lifecycle phase: turn delivered → Idle transition deferred.
      // Per the task brief, the Idle transition requires a 60s no-further-turns
      // idle timer. That timer is app-level state (it spans multiple
      // processTurn calls) and is therefore deferred to the TUI/REPL polling
      // path that already owns session liveness — see follow-up task. Newly
      // created sessions stay in Idle until processTurn is called (the brief's
      // initial-phase guarantee).
      //
      // NOTE: We do NOT advance to Idle here on turn completion. Monotonic
      // forward contract holds: a fresh turn starts in Idle (initial), advances
      // through Understanding→Planning→Executing→Verifying→Summarizing, and
      // remains in Summarizing until the 60s idle window closes.
      // advancePhase(SessionPhase.Idle); // deferred

      // Phase 9 observability — terminal outcome on the resolved path. A
      // result-reason failure (max_iterations / max_repairs / scope / budget)
      // increments agent_invocation_failed_total exactly once; cancellations
      // only reach this point through the catch path above. The completed/
      // failed duration sample is recorded while the activity record is still
      // live so startedAt (invocation start) is available. This sits AFTER the
      // Summarizing phase feed (above) so the summarizing state-gauge sample
      // lands in the same flush.
      if (isFailed) {
        metrics.increment("agent_invocation_failed_total");
        recordTerminalOutcome("failed");
        // Terminal activity state: a result-reason failure resolves to
        // `failed` so the gauge/event history show the true outcome (the
        // cancelled path feeds `cancelled`; the success path feeds
        // `completed`). Fed BEFORE the flush so the gauge sample lands.
        if (activeActivity && activeActivity.state !== "failed") {
          feedActivity("failed");
        }
      } else {
        recordTerminalOutcome("completed");
        if (activeActivity && activeActivity.state !== "completed") {
          feedActivity("completed");
        }
      }

      // Flush minimal metrics (workflow duration + activity/liveness rows)
      metrics.duration("workflow_duration_ms", Date.now() - startTime);
      await flushMetrics();

      activeActivity = undefined;

      return {
        summary: result.summary,
        sessionId: ctx.sessionId,
        toolCalls: turnToolCalls,
        streamed: result.streamed,
        reason: result.reason,
        ...(result.contextBudgetOverflow
          ? { contextBudgetOverflow: result.contextBudgetOverflow }
          : {}),
        ...(approvedPlanContent !== undefined
          ? { planContent: approvedPlanContent }
          : {}),
        ...(approvedPlanTasks ? { planTasks: approvedPlanTasks } : {}),
      };
    }

    function getSessionId(): string {
      if (!ctx) return resolvedSessionId;
      return ctx.sessionId;
    }

    function getMode(): "auto" | "ask" | "bypass" {
      return ctx?.config.permissions.sessionMode ?? config.sessionMode ?? "auto";
    }

    function setMode(mode: "auto" | "ask" | "bypass"): void {
      // Mutate both the in-flight config (if a ctx has been built) and
      // the seed config so subsequent initAgent calls pick up the new mode.
      if (config) config.sessionMode = mode;
      if (ctx) ctx.config.permissions.sessionMode = mode;
    }

    function getVersion(): string {
      return readVersionCached();
    }

    function getState(): AgentSessionState {
      return {
        sessionId: getSessionId(),
        messages: Object.freeze([...messages]),
        toolHistory: Object.freeze([...toolHistory]),
        turnCount,
        createdAt,
        updatedAt,
        progressLedger: _latestLedgerText,
        currentIntent: _latestIntent,
        filesTouched: _filesTouchedCount,
      };
    }

    async function save(): Promise<void> {
      if (!ctx) return;
      // Always run the legacy memory-decision extraction (best-effort).
      try {
        const sessionEvents = await ctx.log.readAll();
        await saveDecisionsToMemory(sessionEvents, ctx.memoryStore);
      } catch {
        // Best-effort — never let persistence fail a save().
      }

      // If a SessionStore is wired, persist a full snapshot so /resume works.
      if (config.store) {
        try {
          const state = getState();
          const snapshot = {
            sessionId: ctx.sessionId,
            task: currentTask,
            sessionMode: ctx.config.permissions.sessionMode ?? "auto",
            messages: state.messages,
            toolHistory: state.toolHistory,
            turnCount: state.turnCount,
            createdAt: state.createdAt,
            updatedAt: state.updatedAt,
            scopeSnapshot: (ctx as any)._scopeSnapshot,
            stateSnapshot: (ctx as any)._stateSnapshot,
            completed: _sessionCompleted,
          };
          await config.store.save(snapshot);
        } catch (err) {
          // Log but don't throw — memory write above is the legacy contract.
          console.error("SessionStore.save failed:", err);
        }
      }
    }

    async function resume(sessionId: string): Promise<void> {
      if (!ctx) return;

      // Prefer SessionStore if wired — that's the authoritative source.
      if (config.store) {
        const snapshot = await config.store.load(sessionId);
        if (!snapshot) {
          // Fall through to legacy reconstruction; if that also fails, the
          // caller's `processTurn` will surface a fresh-session state.
          const { reconstructSession } = await import("../../session/resume.js");
          const reconstructed = await reconstructSession(config.cwd, sessionId);
          if (reconstructed.messages.length > 0) {
            messages = [...reconstructed.messages];
            const originalTask = reconstructed.messages.find(
              (m) => m.role === "user",
            );
            if (originalTask && typeof originalTask.content === "string") {
              currentTask = originalTask.content;
            }
          }
          if (reconstructed.scopeSnapshot)
            (ctx as any)._scopeSnapshot = reconstructed.scopeSnapshot;
          if (reconstructed.stateSnapshot)
            (ctx as any)._stateSnapshot = reconstructed.stateSnapshot;
          if (reconstructed.planContent)
            (ctx as any)._planContent = reconstructed.planContent;
          restoreReconstructedPlanTasks(reconstructed);
          _sessionCompleted = reconstructed.completed;
        } else {
          // Replace internal state with the snapshot.
          messages = [...snapshot.messages];
          toolHistory = [...snapshot.toolHistory];
          currentTask = snapshot.task;
          // createdAt is immutable (captured at session construction); we
          // adopt the snapshot's value logically but cannot reassign. The
          // runtime contract is "createdAt is the earliest save timestamp",
          // which snapshot.createdAt already encodes. We only update the
          // mutable `updatedAt` so subsequent saves reflect the resume point.
          updatedAt = snapshot.updatedAt;
          _sessionCompleted = snapshot.completed === true;
          if (snapshot.scopeSnapshot !== undefined) {
            (ctx as any)._scopeSnapshot = snapshot.scopeSnapshot;
          }
          if (snapshot.stateSnapshot !== undefined) {
            (ctx as any)._stateSnapshot = snapshot.stateSnapshot;
          }
          // Bring downstream loop into alignment with the restored state.
          (ctx as any)._resumedMessages = [...snapshot.messages];
          // tool history isn't surfaced via ctx in the loop today; we keep
          // it on the AgentSession runtime only. processTurn will continue
          // from there.
        }
        await ctx.log.append({
          ...session,
          actor: "system",
          type: "session.resumed",
          payload: { priorSessionId: sessionId, task: currentTask },
        });
        return;
      }

      // Legacy path: reconstruct from the persisted session directory.
      const { reconstructSession } = await import("../../session/resume.js");
      const reconstructed = await reconstructSession(config.cwd, sessionId);
      if (reconstructed.completed) return;

      if (reconstructed.messages.length > 0) {
        messages = [...reconstructed.messages];
        const originalTask = reconstructed.messages.find(
          (m) => m.role === "user",
        );
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
      restoreReconstructedPlanTasks(reconstructed);

      await ctx.log.append({
        ...session,
        actor: "system",
        type: "session.resumed",
        payload: { priorSessionId: sessionId, task: currentTask },
      });
    }

    /**
     * Chat-only path — no tool loop, no planning, no verification. Lazily
     * initializes a lightweight provider (no workflow/MCP), maintains
     * conversation history in closure, and returns the assistant's reply
     * as `summary`. When no provider is configured (no `chatProvider`,
     * `chatModel`, or fallback), surfaces a clear placeholder so the
     * TUI scrollback never stays empty on submit.
     */
    let chatReady = false;
    let chatProviderInstance: ModelAdapter | null = null;
    let chatMessages: { role: "user" | "assistant"; content: string }[] = [];
    // T17 (#394): chat prompt construction now derives from `buildChatPrompt`
    // — the Layer 3 builder keyed on canonical-intent labels. `processChat`
    // does not yet track per-turn intent, so we use `"ambiguous"` as the
    // default. The string is textually identical to the previous inline
    // default, so behavior is unchanged. Future tickets (T19) thread real
    // intent into the chat path.
    const CHAT_DEFAULT_SYSTEM_PROMPT = buildChatPrompt("ambiguous").systemPrompt;
    const chatSystemPrompt =
      config.chatSystemPrompt ?? CHAT_DEFAULT_SYSTEM_PROMPT;
    const CHAT_SEARCH_TIMEOUT_MS = 2000;
    const searchLabel = config.chatSearchLabel ?? "[Web search results]";

    /** Run a search against the configured chatSearchTool, with a 4s budget. */
    async function runSearch(query: string): Promise<string> {
      if (!config.chatSearchTool) return "";
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(""), CHAT_SEARCH_TIMEOUT_MS);
      });
      try {
        const result = await Promise.race([
          config.chatSearchTool(query),
          timeout,
        ]);
        return result ?? "";
      } catch {
        return "";
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function ensureChatProvider(): Promise<ModelAdapter | null> {
      if (chatReady) return chatProviderInstance;
      chatReady = true;
      if (config.chatProvider) {
        chatProviderInstance = config.chatProvider;
        return chatProviderInstance;
      }
      if (!config.chatModel) return null;
      try {
        chatProviderInstance = await createProvider(
          config.chatModel,
          config.chatApiKey,
        );
        return chatProviderInstance;
      } catch {
        chatProviderInstance = null;
        return null;
      }
    }

    /**
     * processChat — root-instrumented lightweight chat entry (Task 10, R3).
     *
     * processChat has no native runId, so each invocation synthesizes ONE
     * `run-<uuid8>` and starts a run trace BEFORE any provider work. The
     * synthetic ExecutionContext{runId, sessionId} is threaded into every
     * physical `complete()` call (initial + each truncation continuation), so
     * a single invocation — provider call #1, continuation provider call #2,
     * retries — stays under exactly one synthetic runId and one trace
     * (chat continuation invariant, design §17). endRun fires exactly once in
     * all three returns (no-provider / success / chat-error) via the finally.
     * When tracing is disabled (Noop) these are cheap no-ops.
     */
    async function processChat(message: string): Promise<AgentTurnResult> {
      const sessionId = session?.sessionId ?? "chat";
      const runId = `run-${randomUUID().slice(0, 8)}`;
      const chatContext: ExecutionContext = { runId, sessionId };
      const traceRun = traceClient.startRun({
        runId,
        sessionId,
        task: message,
        actor: "chat",
        startedAt: Date.now(),
      });
      // Shared terminal-outcome wrapper (src/agent/run-root.ts): maps the body
      // result to success/error, classifies an escaping throw via
      // isCancellationError (operator cancellation is a normal terminal, never
      // a failure), and endRuns exactly once via the finally.
      return withTraceRun(
        traceClient,
        traceRun,
        "processChat ended before its outcome could be recorded",
        (result) =>
          // chat-error is the chat path's own caught-terminal (the body never
          // throws); anything else — including the no-provider placeholder —
          // is a successful invocation.
          result.reason === "chat-error"
            ? { status: "error", error: result.summary, endedAt: Date.now() }
            : { status: "success", endedAt: Date.now() },
        () => processChatBody(message, chatContext),
      );
    }

    /**
     * processChatBody — the original processChat execution body, unchanged
     * except it threads the synthetic chat ExecutionContext into each
     * provider `complete()` request for model-span resolution (T11).
     */
    async function processChatBody(
      message: string,
      chatContext: ExecutionContext,
    ): Promise<AgentTurnResult> {
      const sessionId = session?.sessionId ?? "chat";
      const provider = await ensureChatProvider();
      if (!provider) {
        return {
          summary: `[chat:no-provider] ${message}`,
          sessionId,
          toolCalls: [],
          reason: "chat",
        };
      }

      chatMessages.push({ role: "user", content: message });
      try {
        // Run search BEFORE the model call so the assistant sees fresh
        // context. If search fails or times out, we proceed without it —
        // the chat path never throws because of a search hiccup.
        let effectiveUserContent: string = message;
        if (config.chatSearchTool) {
          const searchContext = await runSearch(message);
          if (searchContext) {
            effectiveUserContent = `${message}\n\n${searchLabel}\n${searchContext}`;
            chatMessages[chatMessages.length - 1] = {
              role: "user",
              content: effectiveUserContent,
            };
          }
        }

        const response = await provider.complete({
          systemPrompt: chatSystemPrompt,
          // Defensive copy so the provider's view of the conversation
          // doesn't change after we push the assistant reply below.
          messages: chatMessages.slice(),
          context: chatContext,
          maxOutputTokens: await resolveDirectOutputCeiling(
            config.chatModel,
            config.chatApiKey,
          ),
        });
        let text = response.text?.trim() ?? "";
        // Truncation continuation: a `finish_reason=length` on a single-shot
        // chat call means the model ran out of output budget mid-answer. Keep
        // generating in follow-up turns so the user never sees a silently cut
        // reply. Delegated to the shared continueTruncatedGeneration helper
        // (src/run/helpers.ts — the same contract the task loop uses): only
        // the LAST partial segment is re-fed as context, never the cumulative
        // text, so continuation context grows linearly instead of quadratically.
        if (response.finishReason === "length" && text.length > 0) {
          const merged = await continueTruncatedGeneration({
            initialText: text,
            messages: chatMessages,
            maxContinuations: TRUNCATION_CONTINUATION_LIMIT,
            generateNext: async (msgs) => {
              const next = await provider.complete({
                systemPrompt: chatSystemPrompt,
                messages: msgs,
                // Thread the synthetic run context so continuation spans
                // resolve to the same run/trace as the initial call (R1).
                context: chatContext,
                maxOutputTokens: await resolveDirectOutputCeiling(
                  config.chatModel,
                  config.chatApiKey,
                ),
              });
              return {
                text: (next.text ?? "").trim(),
                finishReason: next.finishReason,
                toolCalls: next.toolCalls ?? [],
              };
            },
          });
          text = merged.text;
        }
        // The chat history records ONE clean assistant reply (the fully merged
        // answer), never the intermediate partials / continuation prompts.
        chatMessages.push({ role: "assistant", content: text });
        return {
          summary: text || `[chat] ${message}`,
          sessionId,
          toolCalls: [],
          reason: "chat",
          ...(response.usage ? { usage: response.usage as any } : {}),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Drop the user message we optimistically appended so the next turn
        // doesn't see a phantom exchange.
        chatMessages.pop();
        return {
          summary: `[chat error] ${message}`,
          sessionId,
          toolCalls: [],
          reason: "chat-error",
        };
      }
    }

    return {
      processTurn,
      processChat,
      getSessionId,
      getMode,
      setMode,
      getVersion,
      getState,
      getPhase,
      getLiveness,
      getActivity,
      cancelActiveTurn,
      getLastCancelSummary,
      save,
      resume,
      setPlanApprovalGate: (gate) => {
        config.planApprovalGate = gate ?? undefined;
      },
    };
  } // closes build()
} // closes AgentSessionBuilder

// =============================================================================
// Extracted phase functions — each takes only what it needs and returns what
// it produces. No closure dependencies (module-level, stateless).
// =============================================================================

/**
 * P0: Initialize agent (ctx, metrics).
 */
