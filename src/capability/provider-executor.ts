// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { Capability, CapabilityContext } from "./types.js";
import type { CapabilityProviderBinding, ProviderType } from "./canonical/provider.js";
import type { NativeExecutor } from "./executors.js";
import type { ToolCallRequest } from "../tools/types.js";
import type { ExecuteResult } from "../tools/executor.js";
import { execFile } from "node:child_process";
import type { ToolResult } from "../tools/types.js";

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

/** MCP tool invocation seam — mirrors McpManager.callTool's ToolResult shape. */
export interface McpToolRunner {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

/** MCP provider executor. toolName = binding.config.toolName ?? binding.id.
 *  An MCP server is a provider boundary (ADR-0013 MCP rule); protocol plumbing
 *  is never a capability — only intentional operations bound here. */
export class McpProviderExecutor implements ProviderExecutor {
  constructor(private readonly tools: McpToolRunner) {}
  async run(binding: CapabilityProviderBinding, capability: Capability, _ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    const toolName = (binding.config?.toolName as string | undefined) ?? binding.id;
    const result = await this.tools.callTool(toolName, args);
    if (result.kind === "error") return { error: result.message, errorKind: classifyErrorKind(result, undefined, result.retryable) };
    return { output: result.content ?? result.output ?? result.value };
  }
}

/** Spawn seam — injectable so tests never run real executables.
 *  Resolves { exitCode, stdout, stderr } or throws with a `.code`
 *  (ENOENT / ETIMEDOUT / ABORT_ERR). */
export type SpawnLike = (
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

function defaultSpawn(cmd: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeoutMs, signal: opts.signal, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const e = error as NodeJS.ErrnoException & { code?: string };
        if (e.code !== undefined) {
          const wrapped = new Error(`external-cli ${cmd}: ${e.message}`) as Error & { code?: string };
          wrapped.code = e.code;
          reject(wrapped);
        } else {
          reject(new Error(`external-cli ${cmd} failed: ${e.message}`));
        }
        return;
      }
      resolve({ exitCode: 0, stdout, stderr });
    });
  });
}

/** External CLI provider executor (ADR-0013 external-CLI rule). The provider
 *  owns executable resolution, argument construction, env, timeout, capture,
 *  exit-code interpretation. One executor serves gh/gitnexus/kubectl/… —
 *  instance identity + config come from the binding. */
export class ExternalCliProviderExecutor implements ProviderExecutor {
  constructor(private readonly spawn: SpawnLike = defaultSpawn) {}
  async run(binding: CapabilityProviderBinding, capability: Capability, ctx: CapabilityContext, args: Record<string, unknown>): Promise<ProviderRunResult> {
    const config = (binding.config ?? {}) as { executable?: string; operation?: string[]; args?: string[]; timeoutMs?: number };
    const executable = config.executable;
    if (!executable) {
      return { error: `external-cli binding '${binding.id}' is missing config.executable`, errorKind: "configuration" };
    }
    const cliArgs = [...(config.operation ?? []), ...(config.args ?? [])];
    if (Object.keys(args).length > 0) cliArgs.push("--json", JSON.stringify(args));
    const timeoutMs = config.timeoutMs;
    try {
      const res = await this.spawn(executable, cliArgs, { timeoutMs, signal: ctx.cancellationToken });
      if (res.exitCode === 0) return { output: res.stdout };
      return { error: `${executable} exited ${res.exitCode}: ${res.stderr}`, errorKind: classifyErrorKind({}, res.stderr) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e), errorKind: classifyErrorKind(e as { code?: string }) };
    }
  }
}
