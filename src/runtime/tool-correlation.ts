// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * T5 — Result correlation helper (executionId → invocationId → toolCallId)
 *
 * Every parallel result retains the full hierarchy so call_1 → result_1 never
 * ambiguous. Concurrency is decided by ToolExecutionPolicy (T4); this module
 * owns the correlation wiring so IDs propagate from the model turn through
 * StepExecutor events to the next model turn's tool results array.
 *
 * Hierarchy: executionId (workflow/run) → invocationId (model turn) → toolCallId (individual call)
 * - executionId parents many invocationIds (one per model iteration)
 * - invocationId parents many toolCallIds (one per toolCall in that turn)
 * - Events (tool.requested/started/output/completed/failed) carry all three
 * - Tool result messages returned to the model retain all three as attributes
 *
 * Spec: issue #636, blocked by #635. Do NOT touch T6 tests — only wiring.
 *
 * @module tool-correlation
 */

export type CorrelationContext = Readonly<{
  executionId: string;
  invocationId: string;
}>;

export type CorrelatedToolCall = Readonly<{
  executionId: string;
  invocationId: string;
  toolCallId: string;
}>;

/** Full hierarchy type alias — executionId → invocationId → toolCallId */
export type FullCorrelationContext = CorrelatedToolCall;

export function createCorrelationContext(executionId: string, invocationId: string): CorrelationContext {
  return { executionId, invocationId };
}

export function createCorrelatedToolCall(correlation: CorrelationContext, toolCallId: string): CorrelatedToolCall {
  return { executionId: correlation.executionId, invocationId: correlation.invocationId, toolCallId };
}

/**
 * Validate hierarchy: all three IDs non-empty strings and distinct levels.
 * executionId and invocationId must be present; toolCallId is per-call.
 */
export function isValidCorrelation(c: Partial<CorrelatedToolCall>): boolean {
  return (
    typeof c.executionId === "string" && c.executionId.length > 0 &&
    typeof c.invocationId === "string" && c.invocationId.length > 0 &&
    typeof c.toolCallId === "string" && c.toolCallId.length > 0
  );
}

/**
 * Assert valid correlation — fails fast if hierarchy missing (T5: no silent omission for parallel path).
 * Throws if executionId/invocationId/toolCallId missing or empty.
 */
export function assertValidCorrelation(c: Partial<CorrelatedToolCall>): asserts c is CorrelatedToolCall {
  if (!isValidCorrelation(c)) {
    throw new Error(
      `Missing correlation hierarchy (executionId → invocationId → toolCallId): executionId=${(c as any).executionId} invocationId=${(c as any).invocationId} toolCallId=${(c as any).toolCallId}`,
    );
  }
}

/**
 * Assert correlation context (executionId+invocationId) present — for parallel path tool-result/message building.
 */
export function assertValidCorrelationContext(c: Partial<CorrelationContext>): asserts c is CorrelationContext {
  if (typeof c.executionId !== "string" || c.executionId.length === 0 || typeof c.invocationId !== "string" || c.invocationId.length === 0) {
    throw new Error(
      `Missing correlation context for parallel tool result: executionId=${(c as any).executionId} invocationId=${(c as any).invocationId}`,
    );
  }
}

export function isValidInvocationContext(c: Partial<CorrelationContext>): boolean {
  return (
    typeof c.executionId === "string" && c.executionId.length > 0 &&
    typeof c.invocationId === "string" && c.invocationId.length > 0
  );
}

/**
 * Build correlated tool-result message content.
 * Keeps existing `<tool_result id="call">content</tool_result>` shape but adds
 * invocationId/executionId attributes so the next model turn receives all
 * results with explicit hierarchy. Backward compatible: parsers that only read
 * `id` still work; new consumers can read the extra attributes.
 */
export function buildCorrelatedToolResultMessage(
  toolCallId: string,
  content: string,
  correlation: CorrelationContext,
): string {
  assertValidCorrelationContext(correlation);
  if (typeof toolCallId !== "string" || toolCallId.length === 0) {
    throw new Error("Missing toolCallId for correlated tool result message");
  }
  const { executionId, invocationId } = correlation;
  return `<tool_result id="${toolCallId}" invocationId="${invocationId}" executionId="${executionId}">\n${content}\n</tool_result>`;
}

/**
 * Correlated normalized tool result (for providers that use toolResults array).
 * Preserves hierarchy alongside content for unambiguous routing.
 */
export function toCorrelatedToolResult(
  toolCallId: string,
  content: string,
  correlation: CorrelationContext,
): { toolUseId: string; content: string; invocationId: string; executionId: string } {
  assertValidCorrelationContext(correlation);
  if (typeof toolCallId !== "string" || toolCallId.length === 0) {
    throw new Error("Missing toolCallId for correlated tool result");
  }
  return {
    toolUseId: toolCallId,
    content,
    invocationId: correlation.invocationId,
    executionId: correlation.executionId,
  };
}
