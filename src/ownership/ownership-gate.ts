/**
 * ownership-gate.ts — Ownership enforcement for tool execution.
 *
 * Sits AFTER PolicyGate, before workspace/path validation and execution.
 * Delegates all authorization to registry.authorizeMutation() which operates
 * under the ownership lock to reload state, check conflicts, and verify/acquire
 * coverage atomically.
 *
 * Execution order:
 *   argument repair
 *   → request logging
 *   → PolicyGate (skip on continuation-resume)
 *   → OwnershipGate (ALWAYS — even for continuation-resume)
 *   → workspace/path validation
 *   → tool execution
 */

import type { OwnershipRegistry, MutationTarget } from "./ownership-registry.js";
import type { WorkspacePathResolver } from "../runtime/workspace-path.js";
import type { ToolResult } from "../tools/types.js";
import { extractMutationTargets } from "./mutation-targets.js";

export type OwnershipGateConfig = {
  registry: OwnershipRegistry;
  resolver: WorkspacePathResolver;
  /**
   * When true, automatically acquires a lease for each confident
   * mutation target as the tool runs.
   * Single-agent default: true. Parallel-agent: false.
   */
  autoAcquire?: boolean;
};

/**
 * Check ownership for a tool call.
 *
 * Returns null if allowed, or a ToolResult error if blocked.
 *
 * Fail-closed:
 * - unknown-write classification (e.g. shell.run) is denied
 * - autoAcquire=false requires existing exclusive-write coverage
 */
export async function checkOwnershipGate(
  config: OwnershipGateConfig,
  agentId: string,
  toolName: string,
  args: Record<string, unknown>,
  mutates: boolean,
): Promise<ToolResult | null> {
  // Non-mutating tools pass without ownership check
  if (!mutates) return null;

  // Extract mutation targets with classification
  const extraction = extractMutationTargets(toolName, args, config.resolver);

  // Fail-closed: unknown-write (shell, patch without target, etc.)
  if (extraction.classification === "unknown-write") {
    return {
      kind: "error",
      message: `Cannot determine mutation targets for ${toolName} — ownership check failed closed. ` +
        `Acquire an explicit lease covering the expected paths and retry.`,
      retryable: false,
    };
  }

  // no-write tools (read-only shell etc.) pass through
  if (extraction.classification === "no-write") {
    return null;
  }

  // Delegate to registry which acquires lock, reloads, checks, and persists
  const decision = await config.registry.authorizeMutation({
    agentId,
    targets: extraction.targets,
    autoAcquire: config.autoAcquire !== false,
  });

  if (!decision.allowed) {
    return {
      kind: "error",
      message: `Ownership check failed: ${decision.reason}`,
      retryable: false,
    };
  }

  return null; // pass
}
