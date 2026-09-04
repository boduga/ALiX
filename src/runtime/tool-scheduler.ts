// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * T4 — Tool Execution Scheduler with concurrency-aware ToolExecutionPolicy
 *
 * Scheduler decides parallel vs serial for model-emitted toolCalls[].
 * Effective parallel = model.parallelToolCalls && harness allowParallel && safe.
 * Fail-closed: unknown concurrency or any exclusive → serial.
 * Independent governance per call (schema→version→governor→capability→permission)
 * happens inside ToolExecutor per-call before StepExecutor; scheduler never
 * bypasses it — it only controls concurrent vs serial dispatch (Promise.all
 * vs sequential await).
 *
 * Hard invariant (fail-closed):
 *  ToolConcurrency = "safe" | "exclusive"
 *  safe + safe → eligible for parallel
 *  anything involving exclusive or unknown → serial
 *  Scheduler must never infer independence from tool names alone.
 *
 * Separate decisions:
 *  model.parallelToolCalls (can model emit parallel) vs harness allowParallel
 *  (can harness execute concurrently). Effective = model && harness && allSafe
 *
 * MaxParallel batches: >4 safe calls are chunked into parallel batches of 4
 * serially between batches, preserving bounded concurrency.
 *
 * Spec: issue #635, #632-#634 (capability-negotiated parallel_tool_calls)
 * Architecture: docs/ALiX-ExecutionState-Architecture.md §11, §24, §41 (governor boundary)
 *
 * @module tool-scheduler
 */

import type { ToolCall } from "../providers/types.js";
import { buildDefaultToolIndex } from "../tools/tool-registry.js";
import { TOOL_NAME_MAP } from "../agents/tool-name-map.js";

// ─── ToolConcurrency (authoritative metadata) ───────────────────────

export type ToolConcurrency = "safe" | "exclusive";

/**
 * Authoritative concurrency metadata source.
 * Derived from the canonical ToolRegistry's `mutates` flag — the single
 * source of truth for whether a tool mutates state.
 *  - safe      = read-only, no mutation, eligible for parallel with other safe
 *  - exclusive = mutates or unknown, must run serially (fail-closed)
 *
 * Never infer from tool names alone (e.g. write_file(A)+read_file(A) is not
 * parallel even if both list files — exclusive forces serial).
 */
function resolveCanonicalName(name: string): string {
  // Alias (alix_*) → executor name; MCP dynamic names stay as-is
  return TOOL_NAME_MAP[name] ?? name;
}

let _registry: ReturnType<typeof buildDefaultToolIndex>["registry"] | null = null;
function registry() {
  if (!_registry) _registry = buildDefaultToolIndex().registry;
  return _registry;
}

/**
 * Return authoritative concurrency for a tool name, or undefined for unknown
 * (fail-closed → caller must treat as exclusive/serial).
 */
export function getToolConcurrency(toolName: string): ToolConcurrency | undefined {
  const canonical = resolveCanonicalName(toolName);

  // MCP family: canonical entry is mcp.* wildcard
  if (canonical.startsWith("mcp.")) {
    const wild = registry().lookup("mcp.*");
    if (wild) return wild.mutates ? "exclusive" : "safe";
    // Conservative fail-closed if wildcard missing
    return "exclusive";
  }

  // Direct registry lookup (canonical)
  let entry = registry().lookup(canonical);
  if (entry) return entry.mutates ? "exclusive" : "safe";

  // Fallback: try raw name (covers already-canonical provider names)
  entry = registry().lookup(toolName);
  if (entry) return entry.mutates ? "exclusive" : "safe";

  // Unknown tool → fail-closed (undefined)
  return undefined;
}

/** True iff every toolCall is safe and known. */
export function areAllToolCallsSafe(toolCalls: readonly ToolCall[]): boolean {
  for (const tc of toolCalls) {
    const c = getToolConcurrency(tc.name);
    if (c !== "safe") return false; // exclusive or unknown
  }
  return toolCalls.length > 0;
}

// ─── ToolExecutionPolicy ───────────────────────────────────────────

export type ToolExecutionPolicy = Readonly<{
  allowParallel: boolean;
  maxParallel: number;
}>;

export const DEFAULT_TOOL_EXECUTION_POLICY: ToolExecutionPolicy = {
  allowParallel: true,
  maxParallel: 4,
} as const;

export function createToolExecutionPolicy(overrides?: Partial<ToolExecutionPolicy>): ToolExecutionPolicy {
  const p = { ...DEFAULT_TOOL_EXECUTION_POLICY, ...overrides };
  // Clamp maxParallel to spec (maxParallel:4). Remove scope-creep 16.
  if (!Number.isInteger(p.maxParallel) || p.maxParallel < 1) p.maxParallel = 1;
  if (p.maxParallel > 4) p.maxParallel = 4;
  return p;
}

// ─── Eligibility ───────────────────────────────────────────────────

/**
 * Whether the batch is eligible for parallel execution.
 *
 * Effective parallel = modelCapable && harnessAllow && allSafe && length>1
 * Fail-closed: unknown or exclusive → false.
 * maxParallel does not make a safe batch ineligible — it only chunks it.
 */
export function canParallelize(
  toolCalls: readonly ToolCall[],
  policy: ToolExecutionPolicy,
  modelParallelCapable: boolean,
): boolean {
  if (!modelParallelCapable) return false;
  if (!policy.allowParallel) return false;
  if (toolCalls.length <= 1) return false;
  // All safe check is authoritative; unknown → false
  for (const tc of toolCalls) {
    const c = getToolConcurrency(tc.name);
    if (c !== "safe") return false;
  }
  return true;
}

/**
 * Effective parallel flag: model && harness && safe (both must be true).
 * Convenience for callers that need the boolean alone.
 */
export function effectiveParallel(
  toolCalls: readonly ToolCall[],
  policy: ToolExecutionPolicy,
  modelParallelCapable: boolean,
): boolean {
  return canParallelize(toolCalls, policy, modelParallelCapable);
}

// ─── Scheduler dispatch ────────────────────────────────────────────

/**
 * Schedule toolCalls with concurrency-aware dispatch.
 *
 * - Serial when not eligible (unknown/exclusive, unsupported model, harness disabled, single call)
 * - Parallel via Promise.all when safe+safe, chunked by maxParallel when > maxParallel
 * - Each call independently governed before StepExecutor (caller’s executeFn does governance)
 * - Returns results in input order (Promise.all preserves order; chunked concat preserves order)
 * - Fail-closed: any unknown/exclusive forces whole batch serial (per hard invariant)
 */
export async function scheduleToolCalls<T>(
  toolCalls: readonly ToolCall[],
  policy: ToolExecutionPolicy,
  modelParallelCapable: boolean,
  execute: (tc: ToolCall) => Promise<T>,
): Promise<T[]> {
  if (toolCalls.length === 0) return [];

  if (!canParallelize(toolCalls, policy, modelParallelCapable)) {
    const out: T[] = [];
    for (const tc of toolCalls) {
      out.push(await execute(tc));
    }
    return out;
  }

  // Parallel — chunk by maxParallel
  const chunkSize = Math.max(1, policy.maxParallel);
  if (toolCalls.length <= chunkSize) {
    return Promise.all(toolCalls.map(tc => execute(tc)));
  }

  const results: T[] = [];
  for (let i = 0; i < toolCalls.length; i += chunkSize) {
    const chunk = toolCalls.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(tc => execute(tc)));
    results.push(...chunkResults);
  }
  return results;
}

/**
 * Parallel timing proof helper — records start/end per call.
 * Used by tests to prove overlap: A.start < B.end && B.start < A.end
 */
export type TimedResult<T> = { result: T; start: number; end: number };

export async function scheduleToolCallsTimed<T>(
  toolCalls: readonly ToolCall[],
  policy: ToolExecutionPolicy,
  modelParallelCapable: boolean,
  execute: (tc: ToolCall) => Promise<T>,
): Promise<TimedResult<T>[]> {
  const wrap = async (tc: ToolCall): Promise<TimedResult<T>> => {
    const start = Date.now();
    const result = await execute(tc);
    const end = Date.now();
    return { result, start, end };
  };

  if (toolCalls.length === 0) return [];

  if (!canParallelize(toolCalls, policy, modelParallelCapable)) {
    const out: TimedResult<T>[] = [];
    for (const tc of toolCalls) out.push(await wrap(tc));
    return out;
  }

  const chunkSize = Math.max(1, policy.maxParallel);
  if (toolCalls.length <= chunkSize) {
    return Promise.all(toolCalls.map(tc => wrap(tc)));
  }

  const out: TimedResult<T>[] = [];
  for (let i = 0; i < toolCalls.length; i += chunkSize) {
    const chunk = toolCalls.slice(i, i + chunkSize);
    const chunkRes = await Promise.all(chunk.map(tc => wrap(tc)));
    out.push(...chunkRes);
  }
  return out;
}
