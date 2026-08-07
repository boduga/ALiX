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
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { AgentIntent } from "../run/intent-classifier.js";
import type { EventLog } from "../events/event-log.js";

// ---------------------------------------------------------------------------
// Cached package-version lookup. Walked once at module-load time so all
// callers (AgentSession.getVersion, DaemonAgentSession.getVersion, etc.)
// share a single synchronous read.
// ---------------------------------------------------------------------------
const VERSION_WALK_MAX_DEPTH = 6;
const VERSION_FALLBACK = "0.0.0";
let cachedVersion: string | null = null;
export function readVersionCached(): string {
  if (cachedVersion !== null) return cachedVersion;
  // Try walking from CWD first
  const fromCwd = walkForPackageJson(process.cwd());
  if (fromCwd) {
    cachedVersion = fromCwd;
    return cachedVersion;
  }
  // Fall back to walking from this module's location (handles daemon
  // running from /tmp where the project isn't on disk)
  try {
    const moduleDir = nodePath.dirname(fileURLToPath(import.meta.url));
    const fromModule = walkForPackageJson(moduleDir);
    if (fromModule) {
      cachedVersion = fromModule;
      return cachedVersion;
    }
  } catch {
    /* import.meta.url unavailable */
  }
  cachedVersion = VERSION_FALLBACK;
  return cachedVersion;
}

function walkForPackageJson(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < VERSION_WALK_MAX_DEPTH; i++) {
    const candidate = nodePath.join(dir, "package.json");
    if (nodeFs.existsSync(candidate)) {
      try {
        const pkg = JSON.parse(nodeFs.readFileSync(candidate, "utf8")) as { name?: string; version?: string };
        if (pkg.version) return pkg.version;
      } catch {
        /* malformed */
      }
    }
    const parent = nodePath.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
import type {
  ToolCall,
  NormalizedMessage,
  ToolDef,
} from "../providers/types.js";
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
import { createProvider } from "../providers/registry.js";
import type { ModelAdapter } from "../providers/types.js";
import { taskRouter } from "../runtime/task-router.js";
import {
  LocalRuntimeExecutor,
  executeRoute,
  type RuntimeContext,
} from "../runtime/route-executor.js";
import { executeRouteGoverned } from "../runtime/governed-route-executor.js";
import type { TaskRoute } from "../runtime/task-router.js";
import { buildDirectPrompt, buildChatPrompt } from "../runtime/route-prompts.js";
import {
  createWorkflowRun,
  transitionWorkflowStatus,
} from "../kernel/workflow-run.js";
import {
  createSingleNodeGraph,
  transitionNodeStatus,
  transitionGraphStatus,
} from "../kernel/task-graph.js";
import {
  classifyTask,
  detectResearchDepth,
  isReadOnlyTask,
  isShellTask,
} from "../task-classifier.js";
import {
  buildToolsForProvider,
  buildContextBundleEventPayload,
  renderContextBundleForPrompt,
} from "./messages.js";
import { ContextCompiler } from "../repomap/context-compiler.js";
import {
  buildMemoryContext,
  buildMemoryStats,
} from "../utils/memory/recall.js";
import { getEncoding } from "../config/context-limits.js";
import { DEFAULT_FACTORY_CONFIG } from "../skills/dispatcher.js";
import { evictIfNeeded } from "../skills/lifecycle.js";
import type { SkillEntry } from "../skills/catalog.js";
import { ToolSelector } from "../mcp/tool-selector.js";
import { ToolDiscovery } from "../mcp/tool-discovery.js";
import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";
import { READ_ONLY_TOOL_NAMES, saveDecisionsToMemory, streamToResponse } from "../run/helpers.js";
import { MinimalMetrics } from "../kernel/minimal-metrics.js";
import { TaskStateMachine, RunLimiter } from "../autonomy/state-machine.js";
import type { PlanTask } from "../planning/plan-task.js";
import { SYSTEM_PROMPT_BASE, FAILURE_REASONS, SHELL_TASK_PROMPT, READ_ONLY_MODE_PROMPT } from "./system-prompt.js";

/**
 * Lifecycle phases for an agent session. The active phase is observed
 * by the TUI (and any other consumer) but only mutated by the session
 * itself. Originally defined in tui/state.ts — moved here to fix the
 * triangular dependency where agent code imported from the UI layer.
 * tui/state.ts now re-exports this from here.
 *
 * String-valued enum so Object.values(SessionPhase).length === 6
 * (TypeScript numeric enums emit reverse-mappings, doubling the count).
 */
export enum SessionPhase {
  Understanding = "Understanding",
  Planning = "Planning",
  Executing = "Executing",
  Verifying = "Verifying",
  Summarizing = "Summarizing",
  Idle = "Idle",
}

// =============================================================================
// Types (verbatim from P1 brief)
// =============================================================================

/**
 * Typed interface for the internal context fields accessed via `(ctx as any)`
 * in this module. Replaces ad-hoc `as any` casts with a well-defined contract
 * so callers can use `(ctx as unknown as InternalCtxFields).field` instead.
 */
interface InternalCtxFields {
  sessionId: string;
  config: {
    permissions: { sessionMode: "auto" | "ask" | "bypass" };
    model: { provider: string; name: string; streaming: boolean };
  };
  log: EventLog;
  provider: ModelAdapter;
  _planTasks?: readonly PlanTask[];
  _resumedMessages?: readonly NormalizedMessage[];
  _scopeSnapshot?: any;
  _stateSnapshot?: any;
  _planContent?: string;
}

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
  /**
   * Plan markdown content from the most recent plan phase (Task 6). Populated
   * when the run included a plan phase; omitted when the session was resumed
   * with no plan content or the plan was rejected.
   *
   * Backwards compatible — existing callers that ignore this field continue
   * to work. New consumers (TUI plan rendering) can use it to surface the
   * approved plan without re-reading the file from disk.
   */
  readonly planContent?: string;
  /**
   * Structured plan tasks paired with `planContent` (Task 6). When omitted,
   * callers should fall back to `parsePlanTasks(planContent, sessionId)` —
   * but in practice the agent loop populates this whenever planContent is
   * present.
   */
  readonly planTasks?: readonly PlanTask[];
}

/**
 * Result of a single tool execution (per spec §13).
 * Emitted via `AgentSessionEvents.onToolResult` after each tool completes.
 */
export interface ToolResult {
  /** ID matching the originating `ToolCall.id`. */
  readonly toolCallId: string;
  /** Tool output content (string format used by tool result messages). */
  readonly content: string;
  /** True when the tool reported an error or denial. */
  readonly isError?: boolean;
}

/**
 * Streaming event subscription for `AgentSession` (per spec §13).
 *
 * Renderers (chat, REPL, TUI, API) subscribe independently to the same
 * runtime events emitted by the session.
 */
export interface AgentSessionEvents {
  /** Called for each streamed text token as it arrives from the provider. */
  onToken(token: string): void;
  /** Called when a tool call is emitted by the model. */
  onToolCall(call: ToolCall): void;
  /** Called after a tool result is available for a given tool call. */
  onToolResult(result: ToolResult): void;
}

export interface AgentSessionState {
  readonly sessionId: string;
  readonly messages: readonly Message[];
  readonly toolHistory: readonly ToolExecution[];
  readonly turnCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Most recent rendered progress ledger text, if any. */
  readonly progressLedger?: string;
  /** Most recent agent intent classification (research/mutation/validation). */
  readonly currentIntent?: AgentIntent;
  /** Cumulative count of files touched (created/changed/deleted) across all turns. */
  readonly filesTouched?: number;
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
  /**
   * Plan approval mode for the plan-display surface (TUI handles
   * approval inline; CLI is interactive-by-default but can defer).
   * "deferred" lets the caller render the plan after the fact instead
   * of blocking on a TTY prompt inside `runPlanPhase`.
   */
  planApprovalMode?: "interactive" | "deferred";
  /**
   * Optional gate that owns the plan-approval decision in the TUI.
   * When provided alongside `planApprovalMode: "interactive"`, the
   * in-TUI plan-approval card drives the operator's yes/no/edit/detail
   * decision. Mirrors the same opt on `RunOpts` for the CLI path.
   */
  planApprovalGate?: import("../run/plan-approval-gate.js").PlanApprovalGate;
  /** Load plan from file instead of generating. */
  planFilePath?: string;
  /** Resume from a prior session. */
  resumeSessionId?: string;
  /** Parent run ID for execution trace correlation. */
  parentRunId?: string;
  /** Optional stream handler for real-time output. */
  onStream?: StreamHandler;
  /** Optional session events subscription (per spec §13). */
  events?: AgentSessionEvents;
  /**
   * Optional approval store for tool-call approval workflows.
   * When omitted, the runtime denies tool execution with
   * 'Approval required but no approval store configured'.
   */
  approvalStore?: import("../approvals/approval-store.js").ApprovalStore;
  /**
   * Optional pre-built model adapter for the lightweight chat path
   * (`processChat`). When omitted, `processChat` falls back to either
   * `chatModel`/`chatApiKey` env-style config or a clear placeholder
   * summary — never throws.
   */
  chatProvider?: ModelAdapter;
  /** Provider id + optional model name, used to lazily build a chat
   *  provider when `chatProvider` is not supplied. */
  chatModel?: { provider: string; model?: string };
  /** API key for the lazy chat provider. */
  chatApiKey?: string;
  /**
   * Optional model override for the hybrid classifier fallback.
   * Shape mirrors `chatModel` — `{ provider, model? }`. When omitted,
   * the classifier falls back to `chatModel`, then to pure deterministic.
   */
  classifierModel?: { provider: string; model?: string };
  /**
   * When true, tool outputs are streamed to stdout during execution.
   * Defaults to true for CLI mode; set to false in TUI mode to prevent
   * raw tool output from flashing over the dashboard.
   */
  verbose?: boolean;
  /**
   * Optional system prompt override for the chat path. Defaults to a
   * short, tool-free instruction set when omitted.
   */
  chatSystemPrompt?: string;
  /**
   * Optional search hook used by the chat path to inject real-time
   * context ahead of the model call. Receives the user's raw message,
   * returns a string of formatted search results. On failure, the chat
   * path proceeds without search context (the response still lands).
   */
  chatSearchTool?: (query: string) => Promise<string>;
  /**
   * Label used to wrap the search context in the user message so the
   * model can tell what's pre-fetched vs the user's own words. Defaults
   * to `[Web search results]`.
   */
  chatSearchLabel?: string;
  /**
   * Optional SessionStore for durable persistence (per spec §4). When set,
   * `save()` and `resume()` route through the store; when omitted, the
   * legacy in-memory stubs are used (no behavioral change for existing
   * callers).
   */
  store?: import("./session-store.js").SessionStore;
  /**
   * Optional callback for routing diagnostics. Fired when the action
   * classifier routes a prompt through the direct-path (arithmetic,
   * generation) or the tool/agent workflow. Receives the RouteDiagnostic
   * object describing the classification decision.
   */
  onRouteDiagnostic?: (
    diagnostic: import("../runtime/task-router.js").RouteDiagnostic,
  ) => void;
}

// =============================================================================
// Builder strategy types
// =============================================================================

export interface PlanConfig {
  approvalMode: "interactive" | "deferred";
  gate?: import("../run/plan-approval-gate.js").PlanApprovalGate;
}

export interface ChatConfig {
  chatSearchTool?: (query: string) => Promise<string>;
}

export interface PersistenceConfig {
  approvalStore?: import("../approvals/approval-store.js").ApprovalStore;
}

export interface EventConfig {
  onStream?: (token: string) => void;
  onToolCall?: (call: import("../providers/types.js").ToolCall) => void;
}

export interface ToolConfig {
  tools?: import("../providers/types.js").ToolDef[];
}

export interface AgentSession {
  /** Process one user message through the agent loop. */
  processTurn(message: string, options?: { skills?: string[] }): Promise<AgentTurnResult>;
  /**
   * Process one user message through the lightweight chat path.
   *
   * `processChat` is the no-tool-loop conversational entrypoint used by the
   * TUI's chat tab. Returns the same `AgentTurnResult` shape as
   * `processTurn` so callers can treat both paths uniformly, but the
   * underlying runtime is required to skip planning, tool execution,
   * and verification — chat is for talk, agent is for work.
   *
   * The agent tab still uses `processTurn`. Operators opt into the
   * execution class by choosing the tab — there is no hidden
   * escalation from chat to agent.
   */
  processChat(message: string): Promise<AgentTurnResult>;
  /** The underlying session ID. */
  getSessionId(): string;
  /** Current permissions mode (auto/ask/bypass). Optional — older
   *  implementations that pre-date the mode field can omit it. */
  getMode?(): "auto" | "ask" | "bypass";
  /** Set the current permission mode at runtime. Optional — sessions
   *  that pre-date this capability can omit it. The TUI's Shift+Tab
   *  uses this to cycle auto → ask → bypass → auto. */
  setMode?(mode: "auto" | "ask" | "bypass"): void;
  /** Current package version. Optional — same compatibility note. */
  getVersion?(): string;
  /** Snapshot of current session state. */
  getState(): AgentSessionState;
  /**
   * Current lifecycle phase. AgentSession owns the value; observers read only.
   * Optional in the interface because session lifecycles that pre-date the
   * phase contract (e.g. lightweight test stubs) can opt out. The factory
   * implementation always provides it.
   */
  getPhase?(): SessionPhase;
  /** Save session state to memory (stub — external via SessionStore). */
  save(): Promise<void>;
  /** Resume from a prior session (stub — reconstruct from saved state). */
  resume(sessionId: string): Promise<void>;
  /**
   * Inject the plan-approval gate used by `runPlanPhase` when
   * `planApprovalMode === "interactive"`. Optional in the interface
   * for backwards compatibility — older implementations (e.g. test
   * stubs) can omit it and fall back to the legacy TTY prompt path.
   */
  setPlanApprovalGate?(
    gate: import("../run/plan-approval-gate.js").PlanApprovalGate | null,
  ): void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Wrap a `StreamHandler` so it also fires `AgentSessionEvents.onToken` for
 * each text chunk (per spec §13). When `events` is undefined, the original
 * handler is returned unchanged. The original handler is always invoked so
 * existing token-level consumers (e.g. raw stdout writers) keep working.
 */
export function buildSessionStreamHandler(
  onStream: StreamHandler | undefined,
  events: AgentSessionEvents | undefined,
): StreamHandler | undefined {
  if (!events) return onStream;
  if (!onStream) {
    return (chunk) => {
      if (chunk.type === "text" && typeof chunk.text === "string") {
        events.onToken(chunk.text);
      }
    };
  }
  return (chunk) => {
    onStream(chunk);
    if (chunk.type === "text" && typeof chunk.text === "string") {
      events.onToken(chunk.text);
    }
  };
}

/**
 * Fire `AgentSessionEvents.onToolCall` / `onToolResult` for the current turn
 * (per spec §13). No-op when `events` is undefined.
 *
 * Tool calls: emitted in the order they were extracted from message tags
 * (one entry per tool invocation, identified by toolCallId).
 * Tool results: emitted for every `<tool_result>` block in the current
 * message history, in message order. Only results added during this turn
 * fire (caller passes `newMessages` slice).
 */
export function emitSessionEvents(
  events: AgentSessionEvents | undefined,
  turnToolCalls: readonly ToolCall[],
  messages: readonly Message[],
  toolHistory: readonly ToolExecution[],
): void {
  if (!events) return;
  for (const tc of turnToolCalls) {
    events.onToolCall(tc);
  }
  // Derive tool results from the message log. Extract from messages only —
  // this gives the most recent result per toolCallId without depending on
  // internal tool-history shape.
  const results = extractToolResultsFromMessages(messages);
  for (const result of results) {
    events.onToolResult(result);
  }
  // Avoid unused-var lint: toolHistory is reserved for future richer signal
  // extraction (e.g. error categorisation from execution records).
  void toolHistory;
}

// Internal helper — exported so tests can call it directly.
export function extractToolResultsFromMessages(
  msgs: readonly Message[],
): ToolResult[] {
  const results: ToolResult[] = [];
  const re = /<tool_result\s+id="([^"]*)">([\s\S]*?)<\/tool_result>/g;
  for (const msg of msgs) {
    if (msg.role !== "user") continue;
    if (typeof msg.content !== "string") continue;
    let match: RegExpExecArray | null;
    while ((match = re.exec(msg.content)) !== null) {
      const id = match[1];
      const body = match[2].trim();
      const isError =
        /^Error[:\s]/i.test(body) ||
        body.toLowerCase().includes("access denied");
      results.push({ toolCallId: id, content: body, isError });
    }
  }
  return results;
}

export class AgentSessionBuilder {
  private config: Partial<AgentSessionConfig>;

  constructor(config?: AgentSessionConfig) {
    this.config = config ?? {};
  }

  /** Set plan-phase configuration: approval mode and optional gate. */
  withPlan(cfg: { approvalMode?: "interactive" | "deferred"; gate?: import("../run/plan-approval-gate.js").PlanApprovalGate }): this {
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
  withPersistence(cfg: { approvalStore?: import("../approvals/approval-store.js").ApprovalStore; eventLog?: import("../tui/runtime-collector.js").RuntimeCollector }): this {
    (this.config as any).approvalStore = cfg.approvalStore;
    (this.config as any).eventLog = cfg.eventLog;
    return this;
  }

  /** Set event subscription configuration: streaming and diagnostic callbacks. */
  withEvents(cfg: AgentSessionEvents): this {
    (this.config as any).onStream = cfg.onToken ? (token: string) => cfg.onToken(token) : undefined;
    (this.config as any).onToolCall = cfg.onToolCall ? (call: import("../providers/types.js").ToolCall) => cfg.onToolCall(call) : undefined;
    return this;
  }

  /** Set tool configuration: custom tool descriptors. */
  withTools(cfg: { tools?: import("../providers/types.js").ToolDef[] }): this {
    if (cfg.tools) (this.config as any).tools = cfg.tools;
    return this;
  }

  build(): AgentSession {
    const config = this.config as AgentSessionConfig;

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
    let wfRun: WorkflowRun;
    let taskGraph: TaskGraph;
    let taskNode: TaskNode;
    let wfMeta: Record<string, string>;
    let graphMeta: Record<string, string>;
    let metrics: MinimalMetrics;

    // Resolved runtime values (computed during init)
    let currentTask = config.task;
    // Explicit skills injected by the caller for this turn (slash commands).
    // Agent-tab only — the chat path (processChat) never sets this.
    let explicitSkills: string[] | undefined;
    let MAX_CONTEXT_TOKENS = 0;
    let encoding: "cl100k_base" | "o200k_base" | "char4" = "cl100k_base";
    let taskType: TaskType = "unknown";
    let depth: "quick" | "deep" = "quick";
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

    // ---- Internal helpers ----

    /**
     * Initialize the session on the first processTurn call.
     * Replicates the setup in agent-loop.ts runTask().
     */
    async function initialize(): Promise<void> {
      // P0: Session init
      const p0 = await setupSession(config.cwd, config.task, {
        sessionId: config.sessionId,
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
      );
      // Persist for per-turn splicing in processTurn (subsequent-turn path).
      firstTurnMatchedSkills = matchedSkills;
      firstTurnExplicitSkills = await resolveExplicitSkills(explicitSkills);

      // P5: Context limits + task classification
      const p5 = await setupContextLimits(
        ctx.config.model,
        ctx.config.apiKeys,
        currentTask,
        config.readOnly,
      );
      MAX_CONTEXT_TOKENS = p5.MAX_CONTEXT_TOKENS;
      encoding = p5.encoding;
      taskType = p5.taskType;
      depth = p5.depth;
      shellTask = p5.shellTask;
      readOnlyTask = p5.readOnlyTask;
      cappedIterations = p5.cappedIterations;

      // P6: Context compilation + Plan
      if (!shellTask && !readOnlyTask && currentTask) {
        const p6 = await setupContextAndPlan(
          ctx,
          config.cwd,
          MAX_CONTEXT_TOKENS,
          currentTask,
          taskType,
          ctx.sessionId,
          {
            planMode: config.planMode,
            planFilePath: config.planFilePath,
            planApprovalMode: config.planApprovalMode,
            planApprovalGate: config.planApprovalGate,
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
     * Advance the lifecycle phase. No-op if already in the target phase.
     * Best-effort emits an `agent.session.phase_changed` event so observers
     * (TUI, audit) can react without subscribing to the closure.
     */
    function advancePhase(next: SessionPhase): void {
      if (phase === next) return;
      phase = next;
      // ctx may not be wired yet during very early setup; append is safe to skip
      // in that window because phase is also exposed via getPhase().
      const log = ctx?.log;
      if (!log) return;
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

    // ---- Exported interface methods ----

    async function processTurn(
      message: string,
      options?: { skills?: string[] },
    ): Promise<AgentTurnResult> {
      // Thread the explicit skill list (slash commands) into the next
      // initialize() pass. Undefined on the chat path — never touched there.
      explicitSkills = options?.skills;
      // Resolve explicit skill matches ONCE per turn. Used by direct routes
      // (to build the augmented "Answer concisely." prompt) and by the
      // subsequent-turn splice (to inject slash skills into the existing
      // system prompt). Recomputed every turn so a persistent session's
      // subsequent turns don't silently drop the selected skill (Tab 4 fix).
      const currentTurnExplicit = await resolveExplicitSkills(explicitSkills);
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
            sessionId: config.sessionId ?? "",
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
            sessionId: config.sessionId ?? "",
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
        // arrive. The direct route runs before initialize() so
        // ctx.config.model.streaming isn't available yet — the closure-
        // captured top-level `config.streaming` is the resolved source.
        // `streamToResponse` fail-softs to a blocking complete() on
        // mid-stream error, matching runTaskLoop's behavior.
        const useStream = config.streaming !== false;
        const genResponse = await (useStream && genProvider.stream
          ? streamToResponse(genProvider, {
              systemPrompt: directSystemPrompt,
              messages: [{ role: "user", content: route.prompt }],
              maxOutputTokens: 512,
            }, {
              onStream: (chunk) => {
                if (chunk.type === "text") config.events?.onToken?.(chunk.text);
              },
            })
          : genProvider.complete({
              systemPrompt: directSystemPrompt,
              messages: [{ role: "user", content: route.prompt }],
              maxOutputTokens: 512,
            })
        ).catch((err: unknown) => {
          _providerError = err instanceof Error ? err.message : String(err);
          return null;
        });
        if (!genResponse) {
          return {
            summary: `[chat:provider-error] ${_providerError ?? message}`,
            sessionId: config.sessionId ?? "",
            toolCalls: [],
            streamed: false,
            reason: "direct",
          };
        }
        return {
          summary: genResponse.text || "(no response)",
          sessionId: config.sessionId ?? "",
          toolCalls: [],
          // The chat/direct route calls streamToResponse when streaming is on,
          // so the result reflects the actual path used. runTaskLoop and the
          // agent loop set this the same way (config.model.streaming).
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
        };
        // Governed execution (#404): every routed task flows through the
        // ExecutionIntent lifecycle (created→approved→running→terminal) via
        // executeRouteGoverned, which composes the unchanged executeRoute
        // dispatcher. Governed evidence is persisted to the X3b
        // ExecutionEvidenceStore (fire-and-forget; a store failure never
        // stalls the route). The route result is returned as before.
        const { PersistenceEvidenceEmitter } = await import(
          "../runtime/execution-persistence.js"
        );
        const { ExecutionEvidenceStore } = await import(
          "../runtime/execution-evidence-store.js"
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

      if (!initialized) {
        // Seed currentTask from the first message so the planning phase has
        // a task to work with (TUI creates sessions with an empty task).
        if (!currentTask) currentTask = message;
        await initialize();
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
      }

      const startTime = Date.now();

      // Lifecycle phase: about to call runTaskLoop → Executing. Tool-call
      // events (tool.*) are emitted inside runTaskLoop itself; this hook fires
      // immediately before the call so observers see the phase move from
      // Planning to Executing as the task loop enters its execution path.
      advancePhase(SessionPhase.Executing);

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
          shellTask:
            shellTask ||
            (turnCount === 0 && currentTask === ""
              ? isShellTask(message)
              : false),
          memoryStore: ctx.memoryStore,
          sessionId: ctx.sessionId,
          sessionDir: ctx.sessionDir,
          systemPrompt,
          onStream: buildSessionStreamHandler(config.onStream, config.events),
          hookRunner: ctx.hookRunner,
          context: taskContext,
          verbose: config.verbose,
          onLedgerUpdate: (text: string) => { _latestLedgerText = text; },
          onCurrentIntentUpdate: (intent: AgentIntent) => { _latestIntent = intent; },
        });
      } catch (err) {
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
        turnCount++;
        throw err;
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

      // Flush minimal metrics
      metrics.duration("workflow_duration_ms", Date.now() - startTime);
      const metricEvents = metrics.flush();
      for (const m of metricEvents) {
        await ctx.log.append({
          ...session,
          actor: "system",
          type: "m09.metric",
          payload: m,
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

      return {
        summary: result.summary,
        sessionId: ctx.sessionId,
        toolCalls: turnToolCalls,
        streamed: result.streamed,
        reason: result.reason,
        ...(approvedPlanContent !== undefined
          ? { planContent: approvedPlanContent }
          : {}),
        ...(approvedPlanTasks ? { planTasks: approvedPlanTasks } : {}),
      };
    }

    function getSessionId(): string {
      if (!ctx) return config.sessionId ?? "";
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
          const { reconstructSession } = await import("../session/resume.js");
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
      const { reconstructSession } = await import("../session/resume.js");
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
    const CHAT_MAX_OUTPUT_TOKENS = 512;
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

    async function processChat(message: string): Promise<AgentTurnResult> {
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
          maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
        });
        const text = response.text?.trim() ?? "";
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
async function setupSession(
  cwd: string,
  task: string,
  opts?: {
    sessionId?: string;
    sessionMode?: "auto" | "ask" | "bypass";
    approvalStore?: import("../approvals/approval-store.js").ApprovalStore;
  },
): Promise<{ ctx: AgentContext; metrics: MinimalMetrics }> {
  const metrics = new MinimalMetrics();
  metrics.increment("workflow_runs_total", { goal: task.slice(0, 50) });
  const ctx = await initAgent(cwd, {
    cwd,
    task,
    sessionId: opts?.sessionId,
    sessionMode: opts?.sessionMode,
    approvalStore: opts?.approvalStore,
  });
  return { ctx, metrics };
}

/**
 * P1: WorkflowRun + TaskGraph setup.
 */
async function setupWorkflow(
  ctx: AgentContext,
  sessionId: string,
  task: string,
): Promise<{
  wfRun: WorkflowRun;
  taskGraph: TaskGraph;
  taskNode: TaskNode;
  wfMeta: Record<string, string>;
  graphMeta: Record<string, string>;
}> {
  const session = { sessionId, actor: "system" as const };
  const wfRun = createWorkflowRun(sessionId, task);
  const wfMeta = { sessionId, workflowId: wfRun.id };
  await ctx.log.append({
    ...session,
    type: "workflow.created",
    actor: "system",
    payload: { workflowId: wfRun.id, goal: task, mode: wfRun.mode },
    meta: wfMeta,
  });
  const graphResult = createSingleNodeGraph(wfRun.id, task);
  const taskGraph = graphResult.graph;
  const taskNode = graphResult.node;
  const graphMeta = { ...wfMeta, graphId: taskGraph.id, nodeId: taskNode.id };
  await ctx.log.append({
    ...session,
    type: "graph.created",
    actor: "system",
    payload: { graphId: taskGraph.id, workflowId: wfRun.id, nodeCount: 1 },
    meta: graphMeta,
  });
  await ctx.log.append({
    ...session,
    type: "task.ready",
    actor: "system",
    payload: { nodeId: taskNode.id, graphId: taskGraph.id, goal: task },
    meta: graphMeta,
  });
  return { wfRun, taskGraph, taskNode, wfMeta, graphMeta };
}

/**
 * P2: Resume from prior session.
 */
async function setupResume(
  ctx: AgentContext,
  cwd: string,
  resumeSessionId: string,
): Promise<{
  completed: boolean;
  currentTask?: string;
  resumedMessages?: readonly NormalizedMessage[];
  scopeSnapshot?: any;
  stateSnapshot?: any;
  planContent?: string;
  planTasks?: readonly PlanTask[];
}> {
  const { reconstructSession } = await import("../session/resume.js");
  const reconstructed = await reconstructSession(cwd, resumeSessionId);

  if (reconstructed.completed) {
    return { completed: true };
  }

  const originalTask = reconstructed.messages.find((m) => m.role === "user");
  const newTask =
    originalTask && typeof originalTask.content === "string"
      ? originalTask.content
      : undefined;

  return {
    completed: false,
    currentTask: newTask,
    resumedMessages: reconstructed.messages,
    scopeSnapshot: reconstructed.scopeSnapshot,
    stateSnapshot: reconstructed.stateSnapshot,
    planContent: reconstructed.planContent ?? undefined,
    planTasks: reconstructed.planTasks,
  };
}

/**
 * P3: Build memory context/stats.
 */
async function setupMemory(
  memoryStore: any,
): Promise<{
  memoryContext: string | undefined;
  memoryStats: string | undefined;
}> {
  const [memoryContext, memoryStats] = await Promise.all([
    buildMemoryContext(memoryStore),
    buildMemoryStats(memoryStore),
  ]);
  return { memoryContext, memoryStats };
}

/**
 * Resolve explicit skill names (slash-command injection) to body-loaded
 * `LoadedSkill[]`. Per-name resolution is NON-FATAL (missing → warn + skip),
 * but body loading is TRANSACTIONAL: any rejection from `Promise.all`
 * drops the WHOLE explicit set — never a half-injected subset.
 *
 * Pure helper — does no auto-matching (that's `setupSkills`' job). Re-used
 * by the per-turn path in `processTurn` so direct routes and subsequent
 * turns of an initialized session can splice explicit skills into their
 * own system prompts without re-running the full initialize() pipeline.
 */
export async function resolveExplicitSkills(
  explicitSkills?: string[],
): Promise<any[]> {
  if (!explicitSkills || explicitSkills.length === 0) return [];
  try {
    const skillsHome = join(homedir(), ".alix", "skills");
    const { loadSkillManifests, loadSkillContent } = await import("../skills/loader.js");
    const { buildSkillCatalog } = await import("../skills/catalog.js");
    const skillManifests = await loadSkillManifests(skillsHome);
    const skillCatalog = buildSkillCatalog(skillManifests);
    const entries: SkillEntry[] = [];
    for (const ref of explicitSkills) {
      const entry = skillCatalog.getByTriggerOrName(ref);
      if (!entry) {
        console.warn(`Skill "${ref}" isn't installed. Continuing without it.`);
        continue;
      }
      entries.push(entry);
    }
    try {
      const loaded = await Promise.all(
        entries.map(async (e) => {
          const content = await loadSkillContent(e.path);
          return content ? { manifest: content.manifest, body: content.body, path: e.path } : null;
        }),
      );
      const out: any[] = [];
      for (const s of loaded) if (s) out.push(s);
      return out;
    } catch {
      // Transactional: any body-load failure drops the WHOLE explicit set —
      // never a half-injected subset.
      return [];
    }
  } catch {
    return [];
  }
}

/**
 * P4: Skills catalog (best-effort; failures are non-fatal).
 *
 * Merged union: explicit skill names (slash-command injection) ADD to,
 * never replace, automatic matching. Union → dedupe by `canonicalSkillId`
 * (the SOLE dedup authority) → inject. Explicit body loading is
 * transactional: per-name resolution is non-fatal (missing → warn + skip),
 * but any body-load failure drops the ENTIRE explicit set (never a
 * half-injected subset). The explicit-resolution step is delegated to
 * `resolveExplicitSkills` so per-turn paths can reuse it without going
 * through this union helper.
 *
 * `opts.autoMatch === false` skips automatic matching (used by callers that
 * want purely explicit injection; the chat path never passes skills at all).
 */
export async function setupSkills(
  task: string,
  factoryConfig?: { maxStore: number; maxCandidates: number },
  explicitSkills?: string[],
  opts?: { autoMatch?: boolean },
): Promise<any[]> {
  try {
    const skillsHome = join(homedir(), ".alix", "skills");
    const { loadSkillManifests } = await import("../skills/loader.js");
    const { buildSkillCatalog } = await import("../skills/catalog.js");
    const { canonicalSkillId } = await import("../skills/slash.js");
    const skillManifests = await loadSkillManifests(skillsHome);
    const skillCatalog = buildSkillCatalog(skillManifests);
    const { maxStore, maxCandidates } = factoryConfig ?? DEFAULT_FACTORY_CONFIG;
    evictIfNeeded(skillsHome, {
      maxStore,
      maxCandidates: maxCandidates ?? 200,
    });

    // Explicit: resolve per-name (non-fatal), load transactionally (all-or-nothing).
    const explicit = await resolveExplicitSkills(explicitSkills);

    // Auto-match (preserved; skipped when the caller opts out, e.g. chat path).
    const autoMatched = opts?.autoMatch === false ? [] : await skillCatalog.getMatchedContent(task);

    // Union → dedupe by canonicalSkillId (explicit body wins on duplicate).
    const byId = new Map<string, any>();
    for (const s of [...explicit, ...autoMatched]) {
      byId.set(canonicalSkillId(s.manifest), s);
    }
    return [...byId.values()];
  } catch {
    return [];
  }
}

/**
 * P5: Context token limits + task classification.
 */
async function setupContextLimits(
  modelConfig: {
    provider: string;
    name: string;
    maxContextTokens?: number;
    maxIterations?: number;
  },
  apiKeys?: any,
  task?: string,
  readOnly?: boolean,
): Promise<{
  MAX_CONTEXT_TOKENS: number;
  encoding: "cl100k_base" | "o200k_base" | "char4";
  taskType: TaskType;
  depth: "quick" | "deep";
  shellTask: boolean;
  readOnlyTask: boolean;
  cappedIterations: number;
}> {
  const userOverride = modelConfig.maxContextTokens;
  let MAX_CONTEXT_TOKENS: number;
  let encoding: "cl100k_base" | "o200k_base" | "char4";
  if (userOverride !== undefined) {
    MAX_CONTEXT_TOKENS = userOverride;
    encoding = getEncoding(modelConfig.provider);
  } else {
    const { resolveContextLimit } = await import("../config/context-limits.js");
    const resolved = await resolveContextLimit(
      modelConfig.provider,
      modelConfig.name,
      apiKeys,
    );
    MAX_CONTEXT_TOKENS = resolved.maxTokens;
    encoding = resolved.encoding;
  }

  const effectiveTask = task || "Interactive coding session";
  const taskType = classifyTask(effectiveTask);
  const depth = detectResearchDepth(effectiveTask);
  const maxIter = modelConfig.maxIterations ?? 25;
  const shellTask = isShellTask(effectiveTask);
  const readOnlyTask = isReadOnlyTask(effectiveTask) || shellTask;
  const cappedIterations = shellTask
    ? Math.min(maxIter, 2)
    : readOnly
      ? Math.min(maxIter, 4)
      : maxIter;

  return {
    MAX_CONTEXT_TOKENS,
    encoding,
    taskType,
    depth,
    shellTask,
    readOnlyTask,
    cappedIterations,
  };
}

/**
 * P6: Context compilation + Plan phase.
 */
async function setupContextAndPlan(
  ctx: AgentContext,
  cwd: string,
  maxTokens: number,
  task: string,
  taskType: TaskType,
  sessionId: string,
  opts?: {
    planMode?: boolean;
    planFilePath?: string;
    planApprovalMode?: "interactive" | "deferred";
    planApprovalGate?: any;
  },
): Promise<{
  contextBundle?: ContextBundle;
  planRejected?: boolean;
  approvedPlanContent?: string;
  approvedPlanTasks?: readonly PlanTask[];
}> {
  const contextCompiler = new ContextCompiler({
    root: cwd,
    maxTokens,
    eventLog: ctx.log,
    sessionId,
  });
  await contextCompiler.warm();
  const contextBundle = await contextCompiler.compileContext(
    task,
    taskType,
    [],
  );
  await ctx.log.append({
    sessionId,
    actor: "system",
    type: "context.bundle_compiled",
    payload: buildContextBundleEventPayload(contextBundle),
  });

  if (opts?.planMode === false) {
    return { contextBundle };
  }

  const { runPlanPhase } = await import("../run/plan-phase.js");
  const planResult = await runPlanPhase(
    ctx,
    contextBundle,
    task,
    opts?.planFilePath,
    {
      approvalMode: opts?.planApprovalMode ?? "interactive",
      gate: opts?.planApprovalGate,
    },
  );

  if (planResult.action === "rejected") {
    return { contextBundle, planRejected: true };
  }

  return {
    contextBundle,
    planRejected: false,
    approvedPlanContent: planResult.planContent,
    approvedPlanTasks: planResult.planTasks,
  };
}

/**
 * P7: Tool setup.
 */
async function setupTools(
  ctx: AgentContext,
  task: string,
  readOnly?: boolean,
  shellTask?: boolean,
): Promise<{
  providerTools: ToolDef[];
  mcpToolIndex: DeferredToolEntry[];
  selectedTools: DeferredToolEntry[];
  mcpDiscovery: ToolDiscovery | null;
}> {
  const baseTools = buildToolsForProvider(ctx.provider);
  const toolFilter = readOnly
    ? new Set([...READ_ONLY_TOOL_NAMES].filter((n) => n !== "alix_shell_run"))
    : shellTask
      ? READ_ONLY_TOOL_NAMES
      : null;
  const providerTools = toolFilter
    ? baseTools.filter((t) => toolFilter.has(t.name))
    : baseTools;

  const mcpDeferral = ctx.mcpManager?.getDeferral();
  const mcpToolIndex = mcpDeferral?.buildIndex() ?? [];
  const toolSelector = new ToolSelector(mcpToolIndex, {
    maxTools: 20,
    tokenBudget: 3000,
  });
  const selectedTools = toolSelector.select(task);
  const mcpDiscovery = ctx.mcpManager ? new ToolDiscovery(mcpToolIndex) : null;
  for (const entry of selectedTools) {
    TOOL_NAME_MAP[entry.name] = entry.execName;
  }

  return { providerTools, mcpToolIndex, selectedTools, mcpDiscovery };
}

/** Render the "Available Skills" system-prompt section, or "" for none. */
export function buildSkillsSection(skills: any[]): string {
  if (skills.length === 0) return "";
  const skillSection = skills
    .map((s: any) => `## Skill: ${s.manifest.trigger ?? s.manifest.name}\n${s.body}`)
    .join("\n\n");
  return `## Available Skills\n${skillSection}`;
}

/**
 * Replace (or strip) the "## Available Skills" section in `systemPrompt` with
 * a fresh section built from `skills`. If no skills section exists and
 * `skills` is non-empty, the new section is appended.
 *
 * Used by the per-turn paths in `processTurn`:
 *   - Direct routes: the hardcoded "Answer concisely." prompt has no skills
 *     section; the splice APPENDS one when explicit skills are present.
 *   - Subsequent turns on an initialized session: the system prompt was
 *     built in `initialize()` with the first turn's skills section; the
 *     splice REPLACES it with `firstTurnMatchedSkills + currentTurnExplicit`
 *     (deduped upstream) so first-turn auto-matched skills are preserved
 *     and current-turn explicit skills are injected.
 *
 * Section boundaries are detected via the `## Available Skills` start marker
 * and the next top-level `## ` section header (markdown level-2 headings).
 * Sub-headers inside the skills section (`## Skill: /name`) are NOT treated
 * as section boundaries.
 */
export function spliceSkillsSection(systemPrompt: string, skills: any[]): string {
  const newSection = buildSkillsSection(skills);
  if (skills.length === 0) {
    // Strip any existing skills section.
    return stripSkillsSection(systemPrompt);
  }
  // If no existing section, append.
  const startIdx = systemPrompt.indexOf("## Available Skills");
  if (startIdx === -1) {
    return systemPrompt.replace(/\s+$/, "") + "\n\n" + newSection;
  }
  // Find the end of the skills section: the next top-level `## ` header at
  // line start, or end-of-string. `## Skill: ` (skill sub-headers inside the
  // section) and `## Available Skills` (the start marker) are NOT section
  // boundaries.
  let endIdx = systemPrompt.length;
  const tail = systemPrompt.slice(startIdx);
  const nextSection = tail.match(/\n## (?!Available Skills\b|Skill: )/);
  if (nextSection && nextSection.index !== undefined) {
    endIdx = startIdx + nextSection.index;
  }
  const before = systemPrompt.slice(0, startIdx).replace(/\n+$/, "");
  const after = systemPrompt.slice(endIdx);
  // Rejoin: before + newSection + (after, if any).
  if (after.length === 0) {
    return before + "\n\n" + newSection;
  }
  return before + "\n\n" + newSection + "\n\n" + after.replace(/^\n+/, "");
}

/** Internal helper: strip the "## Available Skills" section if present. */
function stripSkillsSection(systemPrompt: string): string {
  const startIdx = systemPrompt.indexOf("## Available Skills");
  if (startIdx === -1) return systemPrompt;
  let endIdx = systemPrompt.length;
  const tail = systemPrompt.slice(startIdx);
  const nextSection = tail.match(/\n## (?!Available Skills\b|Skill: )/);
  if (nextSection && nextSection.index !== undefined) {
    endIdx = startIdx + nextSection.index;
  }
  const before = systemPrompt.slice(0, startIdx).replace(/\n+$/, "");
  const after = systemPrompt.slice(endIdx).replace(/^\n+/, "");
  if (after.length === 0) return before + "\n";
  return before + "\n\n" + after;
}

/**
 * Merge `currentTurnExplicit` with `firstTurnMatchedSkills` for the
 * subsequent-turn splice in `processTurn`:
 *   - First-turn AUTO-matched skills are preserved.
 *   - First-turn EXPLICIT skills are replaced by `currentTurnExplicit`
 *     (subtract by canonical-id, then add current-turn).
 *   - If a current-turn explicit skill has the same canonical id as a
 *     first-turn explicit, it wins (it's the current value).
 *   - Dedupe is by `canonicalSkillId` (the SOLE dedup authority).
 *
 * Exported for direct testing of the dedupe logic.
 */
export async function spliceExplicitIntoFirstTurn(
  firstTurnMatchedSkills: any[],
  firstTurnExplicitSkills: any[],
  currentTurnExplicit: any[],
): Promise<any[]> {
  const { canonicalSkillId } = await import("../skills/slash.js");
  const explicitIds = new Set(
    firstTurnExplicitSkills.map((s) => canonicalSkillId(s.manifest)),
  );
  // Keep only first-turn skills that are NOT first-turn explicit (i.e., the
  // auto-matched subset of firstTurnMatchedSkills).
  const autoOnlyFromFirstTurn = firstTurnMatchedSkills.filter(
    (s) => !explicitIds.has(canonicalSkillId(s.manifest)),
  );
  // Union: autoOnlyFromFirstTurn + currentTurnExplicit, deduped by canonical id.
  const byId = new Map<string, any>();
  for (const s of [...autoOnlyFromFirstTurn, ...currentTurnExplicit]) {
    byId.set(canonicalSkillId(s.manifest), s);
  }
  return [...byId.values()];
}

/**
 * P8: System prompt assembly.
 */
async function setupSystemPrompt(
  cwd: string,
  opts: {
    readOnly?: boolean;
    shellTask: boolean;
    matchedSkills: any[];
    contextBundle?: ContextBundle;
    approvedPlanContent?: string;
    memoryContext?: string;
    memoryStats?: string;
  },
): Promise<string> {
  const lines: string[] = [
    SYSTEM_PROMPT_BASE,
    `## Workspace\nYou are working in: \`${cwd}\`. All file paths are relative to this directory.`,
  ];

  if (opts.shellTask) {
    lines.push(SHELL_TASK_PROMPT);
  }

  if (opts.readOnly) {
    lines.push(READ_ONLY_MODE_PROMPT);
  }

  if (opts.matchedSkills.length > 0) {
    lines.push(buildSkillsSection(opts.matchedSkills));
  }

  if (
    opts.contextBundle &&
    (opts.contextBundle.primaryFiles.length > 0 ||
      opts.contextBundle.tests.length > 0 ||
      opts.contextBundle.supportingFiles.length > 0)
  ) {
    lines.push(renderContextBundleForPrompt(opts.contextBundle));
  }

  if (opts.approvedPlanContent) {
    lines.push(`## Approved Plan\n${opts.approvedPlanContent}`);
  }

  if (opts.memoryStats) {
    lines.push(`## Memory Stats\n${opts.memoryStats}`);
  }

  if (opts.memoryContext) {
    lines.push(`## Memory\n${opts.memoryContext}`);
  }

  return lines.join("\n\n");
}

/**
 * P9: Discover hooks.
 */
async function setupHooks(cwd: string): Promise<{
  pre_task: Array<{ command: string; reason: string }>;
  post_task: Array<{ command: string; reason: string }>;
}> {
  const { discoverHooks } = await import("../hooks/discover.js");
  const discoveredHooks = await discoverHooks(cwd);
  return {
    pre_task: (discoveredHooks.pre_task ?? []).map((h: any) => ({
      command: h.command,
      reason: h.reason,
    })),
    post_task: (discoveredHooks.post_task ?? []).map((h: any) => ({
      command: h.command,
      reason: h.reason,
    })),
  };
}

// =============================================================================
// Simplified factory — delegates to fluent builder for backward compatibility
// =============================================================================

export function createAgentSession(config: AgentSessionConfig): AgentSession {
  return new AgentSessionBuilder(config).build();
}
