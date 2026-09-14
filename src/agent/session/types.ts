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

import "node:crypto";
import "node:fs";
import "node:path";
import "node:path";
import "node:os";
import "node:url";
import type { AgentIntent } from "../../run/intent-classifier.js";
import "../../events/event-log.js";

import type { ToolCall, NormalizedMessage } from "../../providers/types.js";
import type { StreamHandler } from "../stream.js";
import type { TraceClient } from "../../tracing/client.js";
import "../../tracing/noop-client.js";
import "../agent.js";
import "../run-root.js";
import "../../run/task-loop.js";
import "../../providers/registry.js";
import type { ModelAdapter } from "../../providers/types.js";
import "../../runtime/task-router.js";
import { type AgentLivenessSnapshot } from "../agent-liveness.js";
import { type AgentActivity } from "../agent-activity.js";
import "../../runtime/governed-route-executor.js";
import "../../runtime/task-router.js";
import "../../repomap/context-compiler.js";
import "../../config/model-resolver.js";
import { type ContextBudgetOverflowError } from "../../config/context-budget.js";
import "../../utils/tokens.js";
import "../../skills/dispatcher.js";
import "../../skills/lifecycle.js";
import "../../mcp/tool-selector.js";
import "../../mcp/tool-discovery.js";
import "../../agents/tool-name-map.js";
import "../../kernel/minimal-metrics.js";
import type { PlanTask } from "../../planning/plan-task.js";

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
   * Diagnostic payload for an irreducible context-budget overflow (C2 #18).
   * In-process only — consumers must use the typed readonly fields, never
   * Error methods/stack/instanceof. Omitted on any other outcome.
   */
  readonly contextBudgetOverflow?: ContextBudgetOverflowError;
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
  planApprovalGate?: import("../../run/plan-approval-gate.js").PlanApprovalGate;
  /** Load plan from file instead of generating. */
  planFilePath?: string;
  /** Resume from a prior session. */
  resumeSessionId?: string;
  /** Parent run ID for execution trace correlation. */
  parentRunId?: string;
  /**
   * Process-level tracing facade (from `createTraceClient(config.tracing)` at
   * the composition root). One root trace per `processTurn`/`processChat`
   * invocation. Omit for tracing disabled (default) — the inert Noop client
   * is used and behavior is unchanged.
   */
  traceClient?: TraceClient;
  /** Optional stream handler for real-time output. */
  onStream?: StreamHandler;
  /** Optional session events subscription (per spec §13). */
  events?: AgentSessionEvents;
  /**
   * Optional approval store for tool-call approval workflows.
   * When omitted, the runtime denies tool execution with
   * 'Approval required but no approval store configured'.
   */
  approvalStore?: import("../../approvals/approval-store.js").ApprovalStore;
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
  store?: import("../session-store.js").SessionStore;
  /**
   * Optional callback for routing diagnostics. Fired when the action
   * classifier routes a prompt through the direct-path (arithmetic,
   * generation) or the tool/agent workflow. Receives the RouteDiagnostic
   * object describing the classification decision.
   */
  onRouteDiagnostic?: (
    diagnostic: import("../../runtime/task-router.js").RouteDiagnostic,
  ) => void;
}

// =============================================================================
// Builder strategy types
// =============================================================================

export interface PlanConfig {
  approvalMode: "interactive" | "deferred";
  gate?: import("../../run/plan-approval-gate.js").PlanApprovalGate;
}

export interface ChatConfig {
  chatSearchTool?: (query: string) => Promise<string>;
}

export interface PersistenceConfig {
  approvalStore?: import("../../approvals/approval-store.js").ApprovalStore;
}

export interface EventConfig {
  onStream?: (token: string) => void;
  onToolCall?: (call: import("../../providers/types.js").ToolCall) => void;
}

export interface ToolConfig {
  tools?: import("../../providers/types.js").ToolDef[];
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
  /**
   * Progress-based liveness of the active turn. Undefined when no agent loop
   * is executing. Read-only; the tracker is owned by the turn. Absent in
   * pre-liveness implementations (test stubs) and consumers must handle
   * undefined.
   */
  getLiveness?(): AgentLivenessSnapshot | undefined;
  /**
   * Live user-facing activity record for the active invocation. Undefined
   * when no agent loop is executing (idle, planning, summarising). Read-only;
   * the record is owned by the turn. Absent in pre-activity implementations
   * (test stubs) and consumers must handle undefined.
   */
  getActivity?(): AgentActivity | undefined;
  /**
   * Request cancellation of the currently executing turn (operator cancel,
   * Task 6.1). Flips the turn's CancellationToken and aborts the shared
   * AbortSignal so the agent loop / provider request / stream observe the
   * cancel at their next safe point. The live activity transitions to
   * `cancelling` ("Cancelling…") immediately.
   *
   * Returns true when a turn was in flight and the cancel was armed; false
   * when idle (or the active phase is not cancellable) — the caller then
   * treats the key as unhandled.
   *
   * Optional in the interface because session lifecycles that pre-date the
   * cancellation contract (e.g. lightweight test stubs) can omit it.
   */
  cancelActiveTurn?(reason?: string): boolean;
  /**
   * Human-friendly summary of the most recent operator cancellation, e.g.
   * "Cancelled after 4m 12s" (Task 6.2). Populated when an agent turn ends
   * by operator/execution cancellation; cleared on the next turn start.
   * Undefined when the last turn was not cancelled.
   */
  getLastCancelSummary?(): string | undefined;
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
    gate: import("../../run/plan-approval-gate.js").PlanApprovalGate | null,
  ): void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Map a liveness state to its log-event type. The watchdog emits exactly one
 * event per state transition; the recovery state must map to a distinct
 * `recovered` label (never a second `warning`).
 */
