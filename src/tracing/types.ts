/**
 * src/tracing/types.ts
 *
 * ALiX-owned type boundary for the tracing facade.
 *
 * This module is a leaf: instrumentation seams (run roots, provider wrapper,
 * tool executor) depend only on TraceClient + these types. No Langfuse SDK
 * type appears here and none may be added. Inputs use ALiX concepts and are
 * derived from existing normalized runtime shapes where possible; run/span
 * handles are opaque — they expose no SDK object or SDK id.
 *
 * Design: docs/superpowers/specs/2026-09-06-langfuse-tracing-design.md
 * Created by: Task 3 (create tracing module boundary) of
 *   docs/superpowers/plans/2026-09-06-langfuse-tracing-implementation-plan.md
 */

import type { NormalizedMessage } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

/**
 * Terminal status of an ALiX run as reported to the trace facade.
 *
 * Maps from ALiX run/activity terminal semantics (completed/failed/cancelled):
 * - "success"  → run completed normally
 * - "error"    → run failed (incl. scope/approval/context-budget rejections
 *                that end the run as an error rather than a cancellation)
 * - "cancelled"→ operator/task cancellation (AgentSession.cancelActiveTurn)
 */
export type RunStatus = "success" | "error" | "cancelled";

/**
 * Terminal status of a model or tool span.
 *
 * Failure/timeout/denied tool executions report "error"; cancellations report
 * "cancelled". Kept as a distinct union from {@link RunStatus} so span and run
 * vocabularies may diverge independently.
 */
export type SpanStatus = "success" | "error" | "cancelled";

// ---------------------------------------------------------------------------
// Opaque handles
// ---------------------------------------------------------------------------

declare const traceRunBrand: unique symbol;
declare const traceSpanBrand: unique symbol;

/**
 * Opaque handle to an active trace run.
 *
 * Obtain exclusively from `TraceClient.startRun` / `TraceClient.getRun` and
 * pass back to `TraceClient.startModelSpan` / `startToolSpan` / `endRun`.
 * `runId` is the authoritative ALiX run identity (never an SDK id). All other
 * state is owned by the active TraceClient implementation and must never be
 * inspected or constructed by callers.
 */
export interface TraceRun {
  /** Authoritative ALiX run identifier this handle was created for. */
  readonly runId: string;
  readonly [traceRunBrand]: "TraceRun";
}

/**
 * Opaque handle to a model or tool span.
 *
 * Obtain exclusively from `TraceClient.startModelSpan` / `startToolSpan` and
 * pass back to `TraceClient.endSpan`. No member is readable; internals are
 * owned by the active TraceClient implementation.
 */
export interface TraceSpan {
  readonly [traceSpanBrand]: "TraceSpan";
}

// ---------------------------------------------------------------------------
// Run input
// ---------------------------------------------------------------------------

/**
 * Data that seeds a trace run. A projection of the authoritative ALiX
 * execution identity (`ExecutionContext.runId/sessionId/workflowId/parentRunId`,
 * `agentId`) plus the run's user-visible task. The facade never mutates this.
 */
export interface TraceRunInput {
  /**
   * Authoritative ALiX run identifier. Exactly one trace corresponds to one
   * runId (design §14); the adapter never invents its own run identity.
   */
  runId: string;
  /** Session identifier for continuity across invocations. */
  sessionId?: string;
  /** Workflow or SOP identifier when operating under a defined process. */
  workflowId?: string;
  /** Parent run id for in-process subagent linkage (never cross-process). */
  parentRunId?: string;
  /** User-visible task/summary text for the run. */
  task?: string;
  /** The agent/subagent performing the run — maps from ExecutionContext.agentId. */
  actor?: string;
  /** Epoch milliseconds at run start, when known at creation time. */
  startedAt?: number;
}

// ---------------------------------------------------------------------------
// Model span input
// ---------------------------------------------------------------------------

/**
 * Request-side data for a physical provider request (design §18-20).
 *
 * Derived from `NormalizedRequest` + `ExecutionContext` at the
 * `withProviderContracts` seam. Every physical provider request produces
 * exactly one model span; N physical requests for one logical answer produce
 * N spans correlated by `invocationId`.
 */
export interface ModelSpanInput {
  /** Provider identifier (e.g. "anthropic", "openai") — mirrors ExecutionContext.providerId. */
  provider: string;
  /** Requested model name — mirrors ExecutionContext.model. */
  model: string;
  /** Resolved model actually served, when already known at request time. */
  resolvedModel?: string;
  /** Normalized request messages sent on this physical provider request. */
  messages?: readonly NormalizedMessage[];
  /** System prompt shipped with the request. */
  systemPrompt?: string;
  /** True when this is a streaming provider request. */
  stream?: boolean;
  /**
   * Correlates the physical requests of one logical answer
   * (task-loop `inv-<uuid>`). Never a second run identity.
   */
  invocationId?: string;
  /** Epoch milliseconds at request start, when known. */
  startedAt?: number;
}

// ---------------------------------------------------------------------------
// Tool span input
// ---------------------------------------------------------------------------

/**
 * Request-side data for a physical tool call (design §21).
 *
 * Derived from `ToolCallRequest` + `Partial<CorrelationContext>` at the
 * `ToolExecutor.execute` seam. Exactly one terminal span per tool call.
 */
export interface ToolSpanInput {
  /** Tool name as dispatched (e.g. "shell.run", "mcp.<server>.<tool>"). */
  toolName: string;
  /** Optional capability label the tool was resolved under. */
  capability?: string;
  /** Model-assigned tool call id (ToolCall.id). */
  toolCallId?: string;
  /** Invocation id of the loop iteration issuing the tool call. */
  invocationId?: string;
  /** Execution id of the run/workflow issuing the tool call. */
  executionId?: string;
  /** Tool arguments as dispatched. */
  args?: Readonly<Record<string, unknown>>;
  /** Epoch milliseconds at tool-call start, when known. */
  startedAt?: number;
}

// ---------------------------------------------------------------------------
// Outcomes (end-side data)
// ---------------------------------------------------------------------------

/**
 * Terminal outcome of a model or tool span.
 *
 * `output`/`reasoning`/`error` are the raw ALiX payloads the capture policy
 * redacts and truncates before any adapter sees them; `full` capture never
 * bypasses mandatory redaction. Capturing callers remain responsible for not
 * intentionally supplying sensitive data (design §7).
 */
export interface SpanOutcome {
  status: SpanStatus;
  /** Model output text, or tool output/content preview for tool spans. */
  output?: string;
  /** Private reasoning text (model spans only) — gated by capture.reasoning. */
  reasoning?: string;
  /** Model token usage when the provider reports it. */
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-reported finish reason (model spans only). */
  finishReason?: string;
  /** Error message when status === "error". */
  error?: string;
  /** Epoch milliseconds at span end, when known. */
  endedAt?: number;
}

/**
 * Terminal outcome of a run.
 */
export interface RunOutcome {
  status: RunStatus;
  /** Error message when status === "error". */
  error?: string;
  /** Epoch milliseconds at run end, when known. */
  endedAt?: number;
}
