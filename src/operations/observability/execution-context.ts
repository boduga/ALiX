/**
 * #192 — Shared execution context type for correlation across diagnostics,
 * tool calls, provider calls, MCP calls, and evidence events.
 *
 * All fields are optional. Context accumulates as execution flows through
 * boundaries — a provider call inside a tool call inside a workflow step
 * carries all three identifiers.
 *
 * Design: docs/architecture/decisions/2026-07-03-execution-context-correlation-design.md
 */

export interface ExecutionContext {
  /** Unique identifier for a top-level run (e.g. agent task, CLI command). */
  runId?: string;
  /** Session identifier for continuity across invocations. */
  sessionId?: string;
  /** The agent or subagent performing the work. */
  agentId?: string;
  /** Workflow or SOP identifier when operating under a defined process. */
  workflowId?: string;
  /** Step number or identifier within a workflow. */
  stepId?: string;
  /** Tool call identifier for tool execution tracking. */
  toolCallId?: string;
  /** Provider identifier (e.g. "anthropic", "openai"). */
  providerId?: string;
  /** Model name (e.g. "claude-opus-4-8"). */
  model?: string;
  /** Optional parent run ID for nesting/subagent traces. */
  parentRunId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * An empty execution context — all fields are undefined.
 * Useful as a default value or sentinel.
 */
export const EMPTY_CONTEXT: ExecutionContext = {};

/**
 * Check whether a context has at least one field set.
 */
export function hasExecutionContext(context?: ExecutionContext): boolean {
  if (!context) return false;
  return Object.values(context).some((v) => v !== undefined);
}

/**
 * Merge two execution contexts. The override takes precedence.
 * Returns a new object — does not mutate either input.
 */
export function mergeExecutionContext(
  base?: ExecutionContext,
  override?: ExecutionContext,
): ExecutionContext {
  return { ...base, ...override };
}
