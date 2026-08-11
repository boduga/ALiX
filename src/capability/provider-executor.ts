// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { Capability, CapabilityContext } from "./types.js";
import type { CapabilityProviderBinding, ProviderType } from "./canonical/provider.js";
import type { NativeExecutor } from "./executors.js";
import type { ToolCallRequest } from "../tools/types.js";
import type { ExecuteResult } from "../tools/executor.js";

/** R1 error classes (wf-r1 §4.2). timeout/429/5xx/unavailable may fail over;
 *  400-class/auth/contract/configuration are fatal (no fallback). */
export type ProviderErrorKind =
  | "timeout" | "rate-limit" | "http-5xx" | "unavailable"
  | "fatal" | "bad-request" | "auth" | "contract" | "configuration";

export interface ProviderRunResult {
  output?: unknown;
  error?: string;
  errorKind?: ProviderErrorKind;   // present iff error
}

/** One provider execution attempt for one binding. The runtime walks a
 *  step's ordered candidates; isFallbackEligibleKind decides failover. */
export interface ProviderExecutor {
  run(binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult>;
}

const FALLBACK_ELIGIBLE = new Set<ProviderErrorKind>(["timeout", "rate-limit", "http-5xx", "unavailable"]);

/** Deterministic R1 gate: unclassified/undefined errors are fatal. */
export function isFallbackEligibleKind(kind: ProviderErrorKind | undefined): boolean {
  return kind !== undefined && FALLBACK_ELIGIBLE.has(kind);
}

/** The closed R1 classification function (Global Constraints taxonomy).
 *  Every executor and the runtime call THIS — no scattered instanceof or
 *  status-code logic. Provider failures (ENOENT/timeout/429/5xx) are
 *  fallback-eligible; capability/fatal failures are not.
 *  @param error - a thrown error (carries an optional process-exit `code`).
 *  @param stderr - optional CLI stderr (for 429 / 5xx classification).
 *  @param retryable - optional ToolResult.retryable (tool-adapter path). */
export function classifyErrorKind(
  error: { code?: string; retryable?: boolean; message?: string },
  stderr?: string,
  retryable?: boolean,
): ProviderErrorKind {
  if (retryable === true) return "unavailable";
  if (retryable === false) return "fatal";
  if (stderr !== undefined) {
    const s = stderr.toLowerCase();
    if (/\b429\b/.test(s)) return "rate-limit";
    if (/\b5\d\d\b/.test(s)) return "http-5xx";
  }
  switch (error?.code) {
    case "ENOENT": return "unavailable";
    case "ETIMEDOUT": case "ABORT_ERR": return "timeout";
  }
  return "fatal";   // fail-closed
}

/** The ToolExecutor.execute() seam CAP-4 adapts (matches tools/types.ts). */
export type ToolExecutorLike = { execute(req: ToolCallRequest): Promise<ExecuteResult> };

/** Wraps the CAP-3 NativeExecutor (handlers keyed by capability.id). Binding is
 *  ignored — native is a single implementation. Keeps NativeExecutor untouched. */
export class NativeProviderExecutor implements ProviderExecutor {
  constructor(private readonly native: NativeExecutor) {}
  async run(_binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    return this.native.run(capability, ctx, args);
  }
}

/** Adapts the existing ToolExecutor.execute() seam to a provider executor.
 *  toolName rides binding.config.toolName (legacy adapter places it there). */
export class ToolProviderExecutor implements ProviderExecutor {
  constructor(private readonly tool: ToolExecutorLike) {}
  async run(binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    const toolName = (binding.config?.toolName as string | undefined) ?? capability.id;
    const req: ToolCallRequest = { toolCallId: `cap_${Date.now()}`, name: toolName, args };
    const result = await this.tool.execute(req);
    if (result.kind === "error") return { error: result.message, errorKind: classifyErrorKind(result, undefined, result.retryable) };
    if (result.kind === "denied") return { error: result.reason, errorKind: "fatal" };
    return { output: result.content ?? result.output ?? result.value };
  }
}

/** Deterministic stub for recognized-but-unimplemented provider classes
 *  (daemon/agent/plugin/remote-api). The binding exists; the implementation
 *  is unavailable — so this is fallback-eligible provider_unavailable, NOT
 *  missing_binding (user ruling). */
export class UnavailableProviderExecutor implements ProviderExecutor {
  constructor(private readonly providerType: ProviderType) {}
  async run(_binding: CapabilityProviderBinding, _capability: Capability, _ctx: CapabilityContext, _args: Record<string, unknown>): Promise<ProviderRunResult> {
    return { error: `Provider type '${this.providerType}' is not implemented (CAP-4)`, errorKind: "unavailable" };
  }
}
