// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Agent Session — turn execution (#717 step 5b: decomposed from AgentSessionBuilder.build()).
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

import type { ToolCall } from "../../providers/types.js";
import type { RunResult } from "../../run.js";
import type { StreamHandler } from "../stream.js";
import type { ExecutionContext } from "../../observability/execution-context.js";
import "../../tracing/noop-client.js";
import type { MutationSessionState } from "../../run.js";
import "../agent.js";
import { withTraceRun } from "../run-root.js";
import { runTaskLoop } from "../../run/task-loop.js";
import { createProvider } from "../../providers/registry.js";
import { taskRouter } from "../../runtime/task-router.js";
import { CancellationToken } from "../../runtime/cancellation-token.js";
import { AgentLiveness, type AgentLivenessState, type AgentProgressKind } from "../agent-liveness.js";
import { transition, formatActivityElapsed } from "../agent-activity.js";
import { LocalRuntimeExecutor, type RuntimeContext } from "../../runtime/route-executor.js";
import { executeRouteGoverned } from "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import { buildDirectPrompt } from "../../runtime/route-prompts.js";
import { transitionWorkflowStatus } from "../../kernel/workflow-run.js";
import { transitionNodeStatus, transitionGraphStatus } from "../../kernel/task-graph.js";
import {
  classifyTask,
  detectResearchDepth,
  isReadOnlyTask,
  isShellTask,
} from "../../task-classifier.js";
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
import { streamToResponse } from "../../run/helpers.js";
import "../../kernel/minimal-metrics.js";
import { TaskStateMachine, RunLimiter } from "../../autonomy/state-machine.js";
import { FAILURE_REASONS } from "../system-prompt.js";
import { buildSessionStreamHandler, emitSessionEvents, isCancellationError, livenessEventType } from "./helpers.js";
import { buildSkillsSection, resolveDirectOutputCeiling, resolveExplicitSkills, setupWorkflow, spliceExplicitIntoFirstTurn, spliceSkillsSection } from "./setup.js";
import { AgentTurnResult, Message, SessionPhase } from "./types.js";

import type { SessionState } from "./state.js";
import { advancePhase, cancellationInProgress, feedActivity, getPhase } from "./activity.js";
import { initialize } from "./init.js";

export function createFreshSessionState(): MutationSessionState {
  return {
    created: new Set<string>(),
    changed: new Set<string>(),
    deleted: new Set<string>(),
    fatalErrors: [] as string[],
    pendingScopeExpansion: false,
  };
}

export function extractToolCallsFromMessages(msgs: Message[]): ToolCall[] {
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

export async function processTurn(
  state: SessionState,
  message: string,
  options?: { skills?: string[] },
): Promise<AgentTurnResult> {
  const runId = `run-${randomUUID().slice(0, 8)}`;
  const traceRun = state.traceClient.startRun({
    runId,
    sessionId: state.resolvedSessionId,
    task: message,
    actor: "agent",
    parentRunId: state.config.parentRunId,
    startedAt: Date.now(),
  });
  // One shared terminal-outcome wrapper for all the run roots in this
  // file (see src/agent/run-root.ts): body result mapped to success/error,
  // an escaping throw classified cancellation-vs-error, endRun exactly
  // once via the finally. Tracing failures never alter the turn.
  return withTraceRun(
    state.traceClient,
    traceRun,
    "processTurn ended before its outcome could be recorded",
    (result) => ({
      status: FAILURE_REASONS.has(result.reason ?? "") ? "error" : "success",
      endedAt: Date.now(),
    }),
    () => processTurnBody(state, message, runId, options),
  );
}

export async function processTurnBody(
  state: SessionState,
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
    sessionId: state.resolvedSessionId,
    ...(state.config.parentRunId ? { parentRunId: state.config.parentRunId } : {}),
  };
  state.currentRunContext = turnContext;
  // Thread the explicit skill list (slash commands) into the next
  // initialize() pass. Undefined on the chat path — never touched there.
  state.explicitSkills = options?.skills;
  // Resolve explicit skill matches ONCE per turn. Used by direct routes
  // (to build the augmented "Answer concisely." prompt) and by the
  // subsequent-turn splice (to inject slash skills into the existing
  // system prompt). Recomputed every turn so a persistent session's
  // subsequent turns don't silently drop the selected skill (Tab 4 fix).
  const currentTurnExplicit = await resolveExplicitSkills(state.explicitSkills, state.config.cwd);
  // ── Preflight classification ─────────────────────────────────────────
  // Classify the message BEFORE any initialization. Direct routes bypass
  // the full agent lifecycle entirely. Grounded_chat routes are handled
  // by the route executor's two-step tool→synthesis pattern. All other
  // route kinds fall through to initialize() → runTaskLoop().
  // Resolve classifier provider for the hybrid fallback.
  // When configured via classifierModel, use that explicitly; otherwise
  // fall back to chatModel (cheaper path) when available. When neither
  // is set, the router stays purely deterministic — no provider cost.
  const classifierCfg = state.config.classifierModel ?? state.config.chatModel;
  const classifierProvider = classifierCfg
    ? await createProvider(classifierCfg, state.config.chatApiKey).catch(
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
    if (route.diagnostic && state.config.onRouteDiagnostic) {
      try {
        state.config.onRouteDiagnostic(route.diagnostic);
      } catch {
        /* swallow */
      }
    }

    // Arithmetic — deterministic answer, no provider call.
    if (route.answer !== undefined) {
      return {
        summary: route.answer,
        sessionId: state.resolvedSessionId,
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
      state.config.chatProvider ??
      (state.config.chatModel
        ? await createProvider(state.config.chatModel, state.config.chatApiKey).catch(
            () => null,
          )
        : null);
    if (!genProvider) {
      return {
        summary: `[chat:no-provider] ${message}`,
        sessionId: state.resolvedSessionId,
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
    const useStream = state.config.streaming !== false;
    const genMaxOutputTokens = await resolveDirectOutputCeiling(
      state.config.chatModel,
      state.config.chatApiKey,
    );
    const genResponse = await (useStream && genProvider.stream
      ? streamToResponse(genProvider, {
          systemPrompt: directSystemPrompt,
          messages: [{ role: "user", content: route.prompt }],
          maxOutputTokens: genMaxOutputTokens,
          context: turnContext,
        }, {
          writeToStdout: state.config.verbose ?? true,
          onStream: (chunk) => {
            if (chunk.type === "text" && typeof chunk.text === "string") {
              state.config.events?.onToken?.(chunk.text);
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
        sessionId: state.resolvedSessionId,
        toolCalls: [],
        streamed: false,
        reason: "direct",
      };
    }
    return {
      summary: genResponse.text || "(no response)",
      sessionId: state.resolvedSessionId,
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
    if (!state.initialized) {
      if (!state.currentTask) state.currentTask = message;
      await initialize(state);
    } else {
      advancePhase(state, SessionPhase.Understanding);
      // Subsequent-turn splice: re-inject current-turn explicit skills
      // into the system prompt (preserves first-turn auto-match via
      // `firstTurnMatchedSkills`). Without this, slash skills are
      // silently dropped after the first turn on a persistent session.
      if (currentTurnExplicit.length > 0) {
        state.systemPrompt = spliceSkillsSection(
          state.systemPrompt,
          await spliceExplicitIntoFirstTurn(
            state.firstTurnMatchedSkills,
            state.firstTurnExplicitSkills,
            currentTurnExplicit,
          ),
        );
      }
    }
    if (state.sessionCompleted) {
      return {
        summary: `Session ${state.ctx.sessionId} is already completed.`,
        sessionId: state.ctx.sessionId,
        toolCalls: [],
        streamed: false,
        reason: "completed",
      };
    }
    state.updatedAt = new Date().toISOString();

    const executor = new LocalRuntimeExecutor();
    const runtimeCtx: RuntimeContext = {
      cwd: state.config.cwd,
      sessionId: state.ctx.sessionId,
      sessionDir: state.ctx.sessionDir,
      eventLog: state.ctx.log,
      config: state.ctx.config,
      onRouteDiagnostic: state.config.onRouteDiagnostic,
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
        new ExecutionEvidenceStore(join(state.config.cwd, ".alix", "governance")),
      ),
    });
    const summary = governed.result;
    return {
      summary,
      sessionId: state.ctx.sessionId,
      toolCalls: [],
      streamed: false,
      reason: "grounded_chat",
    };
  }

  const continuingAgentSession = state.initialized;
  if (!state.initialized) {
    // Seed currentTask from the first message so the planning phase has
    // a task to work with (TUI creates sessions with an empty task).
    if (!state.currentTask) state.currentTask = message;
    await initialize(state);
    // Capture the first-turn objective exactly once, after initialize()
    // has normalized currentTask from the opening message.
    state.sessionGoal ??= state.currentTask;
  } else {
    // Lifecycle phase: subsequent turn started → Understanding. First-turn
    // initialization performs the same transition once ctx.log is available.
    advancePhase(state, SessionPhase.Understanding);
    // Subsequent-turn splice: re-inject current-turn explicit skills
    // into the system prompt (preserves first-turn auto-match via
    // `firstTurnMatchedSkills`). Without this, slash skills are
    // silently dropped after the first turn on a persistent session.
    if (currentTurnExplicit.length > 0) {
      state.systemPrompt = spliceSkillsSection(
        state.systemPrompt,
        await spliceExplicitIntoFirstTurn(
          state.firstTurnMatchedSkills,
          state.firstTurnExplicitSkills,
          currentTurnExplicit,
        ),
      );
    }
  }

  // If the session was already completed (resumed completed session), return early
  if (state.sessionCompleted) {
    return {
      summary: `Session ${state.ctx.sessionId} is already completed. Use a different session or start a new task.`,
      sessionId: state.ctx.sessionId,
      toolCalls: [],
      streamed: false,
      reason: "completed",
    };
  }

  // Each processTurn is a new execution objective even though the
  // conversation history persists. Keeping the first message here made
  // later turns inherit stale task classification/tool scoping and made
  // their audit records point at an already-completed workflow.
  state.currentTask = message;
  const turnTaskType = classifyTask(message);
  const turnDepth = detectResearchDepth(message);
  const turnShellTask = route.kind === "tool" || isShellTask(message);
  const turnReadOnlyTask = isReadOnlyTask(message) || turnShellTask;

  if (continuingAgentSession) {
    const nextWorkflow = await setupWorkflow(state.ctx, state.session.sessionId, message);
    state.wfRun = nextWorkflow.wfRun;
    state.taskGraph = nextWorkflow.taskGraph;
    state.taskNode = nextWorkflow.taskNode;
    state.wfMeta = nextWorkflow.wfMeta;
    state.graphMeta = nextWorkflow.graphMeta;
  }

  state.updatedAt = new Date().toISOString();

  // Emit lifecycle event: turn started
  await state.ctx.log.append({
    sessionId: state.ctx.sessionId,
    actor: "system",
    type: "agent.session.turn.started",
    payload: { turn: state.turnCount, message },
  });

  // Push user message to accumulated messages
  state.messages.push({ role: "user", content: message });

  // Create fresh per-turn state (each turn gets its own iteration budget)
  const sessionState = createFreshSessionState();
  const limiter = new RunLimiter({
    maxIterations: state.cappedIterations,
    maxRepairs: 3,
    maxFileChanges: 0,
    maxShellCommands: 0,
    maxRuntimeMs: 0,
  });
  const stateMachine = new TaskStateMachine(limiter);

  // Build execution context for diagnostic correlation. runId is the
  // turn root established at processTurn entry (R1) — same identity used
  // for the trace and for model-span resolution via getRun(context.runId).
  const resolved = resolveModelConfig(state.ctx.config);
  const taskContext: ExecutionContext = {
    runId,
    sessionId: state.ctx.sessionId,
    workflowId: state.wfRun.id,
    providerId: resolved.provider,
    model: resolved.name,
    parentRunId: state.config.parentRunId,
  };

  // Snapshot pre-turn message count to identify this turn's additions
  const preTurnMsgCount = state.messages.length;

  // Update graph status (first turn transitions from ready / created)
  transitionNodeStatus(state.taskNode, "running");
  transitionGraphStatus(state.taskGraph, "running");
  await state.ctx.log.append({
    ...state.session,
    type: "task.started",
    actor: "system",
    payload: { nodeId: state.taskNode.id, graphId: state.taskGraph.id },
    meta: state.graphMeta,
  });
  await state.ctx.log.append({
    ...state.session,
    type: "graph.status_changed",
    actor: "system",
    payload: { graphId: state.taskGraph.id, status: "running" },
    meta: state.graphMeta,
  });

  const startTime = Date.now();

  // Lifecycle phase: about to call runTaskLoop → Executing. Tool-call
  // events (tool.*) are emitted inside runTaskLoop itself; this hook fires
  // immediately before the call so observers see the phase move from
  // Planning to Executing as the task loop enters its execution path.
  advancePhase(state, SessionPhase.Executing);

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
  state.activeLiveness = liveness;

  // ── Operator cancellation (Task 6.1) ──────────────────────────────
  // Each loop-bound turn owns a CancellationToken + AbortController pair.
  // cancelActiveTurn() flips the token (checked at loop safe points) and
  // aborts the signal (raced against the in-flight provider request /
  // stream). Armed here — the instant the loop path begins — and cleared
  // in the finally below. A fresh pair per turn so a stale cancel can
  // never bleed into the next invocation.
  const cancelController = new AbortController();
  const cancelToken = new CancellationToken();
  state.activeCancel = { token: cancelToken, controller: cancelController };
  state.cancelRequestedAt = undefined;
  state.lastCancelSummary = undefined;

  // ── Live user-facing activity feed ────────────────────────────────
  // Derives the AgentActivity record from existing runtime seams (turn
  // start, tool progress, streamed model chunks, phase transitions, and
  // the liveness watchdog) rather than a second polling architecture.
  // Every state change emits an `agent.session.activity` event carrying
  // the full record so later tasks can render / observe it.
  state.activityInvocationId = `${runId}-${randomUUID().slice(0, 8)}`;
  state.activityModel = { provider: resolved.provider, model: resolved.name };
  // Task 2.1 — invocation begins: THINKING with timestamps stamped now.
  feedActivity(state, "thinking");
  // True once the model has emitted a visible text chunk for the CURRENT
  // model-output phase. Reset when that phase ends (a tool begins), so a
  // later tool completion returns the indicator to thinking while the
  // model silently resumes. Set again by the next phase's first chunk.
  let activityStreaming = false;

  const sessionOnStream = buildSessionStreamHandler(state.config.onStream, state.config.events);
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
      if (state.activeActivity && !cancellationInProgress(state)) {
        if (state.activeActivity.state !== "streaming") {
          feedActivity(state, "streaming");
        } else {
          state.activeActivity = transition(
            state.activeActivity,
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
    void state.ctx.log
      .append({
        sessionId: state.ctx.sessionId,
        actor: "system",
        type: livenessEventType(snap.state),
        payload: {
          runId,
          lastProgressAt: new Date(snap.lastProgressAt).toISOString(),
          idleMs: snap.idleMs,
          lastProgressKind: snap.lastProgressKind,
          lastProgressDescription: snap.lastProgressDescription,
          phase: getPhase(state),
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
    state.metrics.gauge("agent_last_progress_age_ms", snap.idleMs);
    if (snap.state === "warning" || snap.state === "stalled") {
      state.metrics.increment("agent_stall_warning_total", { state: snap.state });
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
      state.activeActivity &&
      state.activeActivity.state !== "tool_running" &&
      !cancellationInProgress(state)
    ) {
      if (state.activeActivity.state !== "possibly_stalled") {
        feedActivity(state, "possibly_stalled");
      }
    } else if (state.activeActivity && !cancellationInProgress(state)) {
      if (state.activeActivity.state === "possibly_stalled") {
        feedActivity(state, activityStreaming ? "streaming" : "thinking");
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
    const metricEvents = state.metrics.flush();
    for (const m of metricEvents) {
      await state.ctx.log.append({
        ...state.session,
        actor: "system",
        type: "observability.metric",
        payload: m,
      });
    }
  };
  const recordTerminalOutcome = (
    outcomeState: "completed" | "failed" | "cancelled",
  ): void => {
    // Duration spans the live activity record (invocation start, stamped
    // at THINKING) through the terminal outcome, so thinking/verifying/
    // summarizing phases are included — not just the runTaskLoop window.
    // Only bounded dimensions are labels: state (completed/failed/
    // cancelled). The per-invocation invocationId is NOT a metric label
    // (high-cardinality); it rides on the activity event payload instead.
    const invocationStartedAt = state.activeActivity?.startedAt;
    if (invocationStartedAt !== undefined) {
      state.metrics.duration("agent_activity_duration_ms", Date.now() - invocationStartedAt, {
        state: outcomeState,
      });
    }
  };
  try {
    result = await runTaskLoop({
      config: {
        // Canonical `models` only — the loop resolves via resolveModelConfig.
        models: state.ctx.config.models,
        permissions: {
          sessionMode: state.ctx.config.permissions.sessionMode,
        },
        skills: state.ctx.config.skills,
        context: state.ctx.config.context,
      },
      provider: state.ctx.provider,
      providerTools: state.providerTools,
      mcpToolIndex: state.mcpToolIndex,
      // Agent executions are objective-scoped. Keep the accumulated
      // conversation for the session UI/audit trail, but give the task
      // loop only the current objective. The lightweight chat path below
      // still receives full chat history, so conversational continuity is
      // preserved where it belongs without allowing completed agent turns
      // to leak into a later task's summary.
      messages: [{ role: "user", content: message }],
      sessionState,
      stateMachine,
      scope: state.ctx.scope,
      session: state.session,
      log: state.ctx.log,
      executor: state.ctx.toolExecutor,
      mcpDiscovery: state.mcpDiscovery,
      selectedTools: state.selectedTools,
      hooks: state.hooks,
      maxIterations: turnShellTask ? Math.min(state.cappedIterations, 2) : state.cappedIterations,
      contextBudget: state.contextBudget!,
      tokenizer: state.tokenizer,
      task: message,
      taskType: turnTaskType,
      sessionGoal: state.sessionGoal,
      depth: turnDepth,
      readOnly: state.config.readOnly ?? turnReadOnlyTask,
      shellTask: turnShellTask,
      memoryStore: state.ctx.memoryStore,
      sessionId: state.ctx.sessionId,
      sessionDir: state.ctx.sessionDir,
      systemPrompt: state.systemPrompt,
      onStream: livenessOnStream,
      hookRunner: state.ctx.hookRunner,
      context: taskContext,
      verbose: state.config.verbose,
      onLedgerUpdate: (text: string) => { state.latestLedgerText = text; },
      onCurrentIntentUpdate: (intent: AgentIntent) => { state.latestIntent = intent; },
      // Task 6.1 — propagate the shared cancellation primitives into the
      // loop. The loop checks the token at its safe points and races the
      // signal against the in-flight provider request/stream.
      cancellationToken: cancelToken,
      cancelSignal: cancelController.signal,
      onProgress: (kind: AgentProgressKind, description?: string) => {
        liveness.mark(kind, description);
        // Tool progress racing an in-flight cancel must not regress the
        // indicator away from cancelling/cancelled.
        if (cancellationInProgress(state)) return;
        if (kind === "model_requested" && state.activeActivity) {
          // A provider/model call has started and no content has arrived
          // yet — the closest reachable mapping of the design's
          // "provider accepted request, waiting for content" row. Only
          // when the current model phase is not already streaming; the
          // first visible chunk moves the indicator to STREAMING.
          if (!activityStreaming) feedActivity(state, "waiting_for_provider");
        } else if (kind === "tool_started" && state.activeActivity) {
          // Task 2.2 — a tool begins executing: TOOL_RUNNING with its name.
          // Round 1 — stamp toolStartedAt so the tool timer starts at TOOL
          // start (not the invocation start, which includes thinking time).
          // Beginning the tool also ENDS the model-output phase, so the
          // streaming latch resets: when the tool completes the indicator
          // returns to THINKING while the model silently resumes.
          activityStreaming = false;
          feedActivity(state, "tool_running", { toolName: description, toolStartedAt: Date.now() });
        } else if (kind === "tool_completed" && state.activeActivity) {
          // Tool finished → back to THINKING unless the model is already
          // streaming (subsequent model text takes over the indicator).
          if (!activityStreaming) feedActivity(state, "thinking");
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
      transitionNodeStatus(state.taskNode, "cancelled");
      transitionGraphStatus(state.taskGraph, "cancelled");
      transitionWorkflowStatus(state.wfRun, "cancelled");
      // Cancelled audit rows mirror the failure paths (task.failed +
      // graph.failed + workflow.failed on result-failure; task.failed +
      // workflow.failed on a thrown failure) so the JSONL trail is
      // symmetric: node, then graph, then workflow — each with the same
      // correlation the sibling failure rows carry.
      await state.ctx.log.append({
        ...state.session,
        type: "task.cancelled",
        actor: "system",
        payload: {
          nodeId: state.taskNode.id,
          graphId: state.taskGraph.id,
          error: String(err),
          summary: String(err),
        },
        meta: state.graphMeta,
      });
      await state.ctx.log.append({
        ...state.session,
        type: "graph.cancelled",
        actor: "system",
        payload: {
          graphId: state.taskGraph.id,
          workflowId: state.wfRun.id,
          error: String(err),
          summary: String(err),
        },
        meta: state.graphMeta,
      });
      await state.ctx.log.append({
        ...state.session,
        type: "workflow.cancelled",
        actor: "system",
        payload: {
          workflowId: state.wfRun.id,
          nodeId: state.taskNode.id,
          graphId: state.taskGraph.id,
          summary: String(err),
        },
        meta: state.wfMeta,
      });
      state.metrics.increment("agent_invocation_cancelled_total");
      recordTerminalOutcome("cancelled");
      // Terminal activity state: the live "Cancelling…" record resolves to
      // `cancelled` so the gauge/event history show the true outcome.
      if (state.activeActivity && state.activeActivity.state !== "cancelled") {
        feedActivity(state, "cancelled");
      }
      // Surface the elapsed-from-start summary ("Cancelled after 4m 12s")
      // for the TUI's summary line. Anchored at the operator's cancel
      // request; falls back to now (execution-initiated cancellation).
      const cancelledAt = state.cancelRequestedAt ?? Date.now();
      const invocationStartedAt = state.activeActivity?.startedAt;
      state.lastCancelSummary =
        invocationStartedAt !== undefined
          ? `Cancelled after ${formatActivityElapsed(cancelledAt - invocationStartedAt)}`
          : "Cancelled";
      // Emit lifecycle event: turn completed (cancelled)
      await state.ctx.log.append({
        sessionId: state.ctx.sessionId,
        actor: "system",
        type: "agent.session.turn.completed",
        payload: { turn: state.turnCount, cancelled: true, error: String(err) },
      });
    } else {
      transitionNodeStatus(state.taskNode, "failed");
      await state.ctx.log.append({
        ...state.session,
        type: "task.failed",
        actor: "system",
        payload: {
          nodeId: state.taskNode.id,
          graphId: state.taskGraph.id,
          error: String(err),
        },
        meta: state.graphMeta,
      });
      transitionWorkflowStatus(state.wfRun, "failed");
      await state.ctx.log.append({
        ...state.session,
        type: "workflow.failed",
        actor: "system",
        payload: { workflowId: state.wfRun.id, summary: String(err) },
        meta: state.wfMeta,
      });

      // Emit lifecycle event: turn completed (error)
      await state.ctx.log.append({
        sessionId: state.ctx.sessionId,
        actor: "system",
        type: "agent.session.turn.completed",
        payload: { turn: state.turnCount, error: String(err) },
      });
      state.metrics.increment("agent_invocation_failed_total");
      recordTerminalOutcome("failed");
      // Terminal activity state: the live record resolves to `failed` so
      // the gauge/event history show the true outcome (mirrors the
      // cancelled branch's feed above). The success-path flush below is
      // never reached when the loop throws, so this feed lands in the
      // shared catch-path flush.
      if (state.activeActivity && state.activeActivity.state !== "failed") {
        feedActivity(state, "failed");
      }
    }
    // Persist the failure/cancellation-path rows: the success-path flush
    // below is never reached when the loop throws.
    await flushMetrics();
    state.turnCount++;
    state.activeActivity = undefined;
    throw err;
  } finally {
    clearInterval(livenessWatchdog);
    state.activeLiveness = undefined;
    state.activeCancel = undefined;
    state.cancelRequestedAt = undefined;
  }

  // Cumulative file count for the TUI header. sessionState is local to
  // processTurn (a fresh MutationSessionState is allocated per turn), so we
  // sum its three file sets and add to the closure counter.
  state.filesTouchedCount +=
    sessionState.changed.size + sessionState.created.size + sessionState.deleted.size;

  // Verifying phase begins as the task loop's verifier pass completes; the TUI
  // shows "Verifying" between this transition and the eventual "Summarizing"
  // once summary lines are emitted. During the actual verifier pass, the TUI
  // still shows "Executing": the verifier lives inside runTaskLoop, so this is
  // the post-verify-pre-result proxy boundary within the two-file scope.
  advancePhase(state, SessionPhase.Verifying);

  // Update graph status based on result reason
  const isFailed = FAILURE_REASONS.has(result.reason ?? "");

  // Preserve a truthful conversational boundary for the next turn. The
  // loop works on an assembled local message array, so its summary must
  // be explicitly committed to the session-owned history here.
  state.messages.push({ role: "assistant", content: result.summary });

  if (isFailed) {
    transitionNodeStatus(state.taskNode, "failed");
    transitionGraphStatus(state.taskGraph, "failed");
    await state.ctx.log.append({
      ...state.session,
      type: "task.failed",
      actor: "system",
      payload: {
        nodeId: state.taskNode.id,
        graphId: state.taskGraph.id,
        reason: result.reason,
        summary: result.summary,
      },
      meta: state.graphMeta,
    });
    await state.ctx.log.append({
      ...state.session,
      type: "graph.failed",
      actor: "system",
      payload: {
        graphId: state.taskGraph.id,
        workflowId: state.wfRun.id,
        reason: result.reason,
        summary: result.summary,
      },
      meta: state.graphMeta,
    });
    await state.ctx.log.append({
      ...state.session,
      type: "workflow.failed",
      actor: "system",
      payload: {
        workflowId: state.wfRun.id,
        reason: result.reason,
        summary: result.summary,
      },
      meta: state.wfMeta,
    });
  } else {
    transitionNodeStatus(state.taskNode, "done");
    transitionGraphStatus(state.taskGraph, "completed");
    await state.ctx.log.append({
      ...state.session,
      type: "task.done",
      actor: "system",
      payload: {
        nodeId: state.taskNode.id,
        graphId: state.taskGraph.id,
        summary: result.summary,
      },
      meta: state.graphMeta,
    });
    await state.ctx.log.append({
      ...state.session,
      type: "graph.completed",
      actor: "system",
      payload: {
        graphId: state.taskGraph.id,
        workflowId: state.wfRun.id,
        summary: result.summary,
      },
      meta: state.graphMeta,
    });
    transitionWorkflowStatus(state.wfRun, "completed");
    await state.ctx.log.append({
      ...state.session,
      type: "workflow.completed",
      actor: "system",
      payload: { workflowId: state.wfRun.id, summary: result.summary },
      meta: state.wfMeta,
    });
  }

  // Extract tool calls from this turn's new messages
  const newMessages = state.messages.slice(preTurnMsgCount);
  const turnToolCalls = extractToolCallsFromMessages(newMessages);

  // Update tool history
  for (const tc of turnToolCalls) {
    state.toolHistory.push({
      toolName: tc.name,
      args: tc.args,
      timestamp: new Date().toISOString(),
    });
  }

  state.updatedAt = new Date().toISOString();

  // Lifecycle phase: summary produced → Summarizing. The summary emitted
  // here is the user-visible synthesis of the turn; the phase flips before
  // the turn-completed audit event so observers see Summarizing line up
  // with the response delivery path.
  advancePhase(state, SessionPhase.Summarizing);

  // Emit lifecycle event: turn completed
  await state.ctx.log.append({
    sessionId: state.ctx.sessionId,
    actor: "system",
    type: "agent.session.turn.completed",
    payload: { turn: state.turnCount, summary: result.summary },
  });

  // Fire session events (spec §13): one per tool call + tool result in this turn.
  emitSessionEvents(state.config.events, turnToolCalls, state.messages, state.toolHistory);

  state.turnCount++;

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
  // advancePhase(state, SessionPhase.Idle); // deferred

  // Phase 9 observability — terminal outcome on the resolved path. A
  // result-reason failure (max_iterations / max_repairs / scope / budget)
  // increments agent_invocation_failed_total exactly once; cancellations
  // only reach this point through the catch path above. The completed/
  // failed duration sample is recorded while the activity record is still
  // live so startedAt (invocation start) is available. This sits AFTER the
  // Summarizing phase feed (above) so the summarizing state-gauge sample
  // lands in the same flush.
  if (isFailed) {
    state.metrics.increment("agent_invocation_failed_total");
    recordTerminalOutcome("failed");
    // Terminal activity state: a result-reason failure resolves to
    // `failed` so the gauge/event history show the true outcome (the
    // cancelled path feeds `cancelled`; the success path feeds
    // `completed`). Fed BEFORE the flush so the gauge sample lands.
    if (state.activeActivity && state.activeActivity.state !== "failed") {
      feedActivity(state, "failed");
    }
  } else {
    recordTerminalOutcome("completed");
    if (state.activeActivity && state.activeActivity.state !== "completed") {
      feedActivity(state, "completed");
    }
  }

  // Flush minimal metrics (workflow duration + activity/liveness rows)
  state.metrics.duration("workflow_duration_ms", Date.now() - startTime);
  await flushMetrics();

  state.activeActivity = undefined;

  return {
    summary: result.summary,
    sessionId: state.ctx.sessionId,
    toolCalls: turnToolCalls,
    streamed: result.streamed,
    reason: result.reason,
    ...(result.contextBudgetOverflow
      ? { contextBudgetOverflow: result.contextBudgetOverflow }
      : {}),
    ...(state.approvedPlanContent !== undefined
      ? { planContent: state.approvedPlanContent }
      : {}),
    ...(state.approvedPlanTasks ? { planTasks: state.approvedPlanTasks } : {}),
  };
}
