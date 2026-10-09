/**
 * capability-map.ts -- Tool → capability mapping.
 *
 * Two responsibilities:
 *
 *  1. `legacyCapabilityToCanonical` — the centralized canonicalizer for
 *     config-facing policy keys. This is the ONLY place legacy policy keys are
 *     canonicalized to capability ids, including keys no current tool produces
 *     (git.commit → repo.write, shell.readonly → shell.exec, ...). KEEP AS-IS.
 *
 *  2. Port-derived tool → capability views (`inferCapability`,
 *     `canonicalCapabilityOf`) and capability predicates
 *     (`isReadonlyCapability`, `requiresApproval`). These are DERIVED from the
 *     canonical `ToolCapabilityRegistry` port — never independently maintained.
 *     The single `mcp.*` registry wildcard entry
 *     covers the dynamic `mcp.<server>.<tool>` family: any tool name beginning
 *     with "mcp." maps to the `mcp.invoke` capability.
 */

import { createToolCapabilityRegistry } from "./tool-registry.js";
import type {
  ToolCapabilityEntry,
  ToolCapabilityRegistry,
} from "../../runtime-state/contracts/tool-capability-registry.js";

const LEGACY_TO_CANONICAL: Record<string, string> = {
  "file.read": "filesystem.read",
  "file.write": "filesystem.write",
  "file.search": "filesystem.search",
  "file.delete": "filesystem.write",
  "shell.run": "shell.exec",
  "shell.readonly": "shell.exec",
  "git.diff": "repo.read",
  "git.commit": "repo.write",
  "git.push": "repo.write",
  "network.fetch": "network.fetch",
  "secret.read": "secret.read",
  "browser.open": "browser.open",
  "patch.apply": "patch.apply",
  "delegate": "agent.delegate",
  "task.complete": "task.complete",
  "web.search": "web.search",
  "web.fetch": "web.fetch",
  "mcp.invoke": "mcp.invoke",
  "tool.invoke": "tool.invoke",
  "verify.claim": "decision.claim-verification",
};

export function legacyCapabilityToCanonical(legacy: string): string {
  return LEGACY_TO_CANONICAL[legacy] ?? legacy;
}

const capabilityCatalog = createToolCapabilityRegistry();

/**
 * Resolve an executor name through the canonical catalogue, including the
 * dynamic MCP family. A dynamic `mcp.<server>.<tool>` name intentionally has
 * no static registry row: it resolves through the port's single `mcp.*`
 * entry, so the dynamic surface cannot carry a second policy vocabulary.
 */
export function resolveCataloguedExecutor(
  catalog: ToolCapabilityRegistry,
  executorName: string,
): ToolCapabilityEntry | undefined {
  if (executorName.startsWith("mcp.")) return catalog.resolve("mcp.*");
  return catalog.resolve(executorName);
}

/** Fallback vocabulary when the catalogue has no row (never a second taxonomy). */
function uncataloguedFallback(toolName: string): string {
  return toolName.startsWith("mcp.") ? "mcp.invoke" : "tool.invoke";
}

/**
 * Map a tool name to its config-facing policy key.
 *
 * Exactly reproduces the historical executor/policy-gate `inferCapability`
 * behavior: `mcp.<...>` → `"mcp.invoke"`; a known registry tool → its
 * `policyKey`; otherwise `"tool.invoke"`.
 */
export function inferCapability(toolName: string): string {
  return resolveCataloguedExecutor(capabilityCatalog, toolName)?.policyKey
    ?? uncataloguedFallback(toolName);
}

/**
 * Map a tool name to its canonical capability id.
 *
 * `mcp.<...>` → `"mcp.invoke"`; a known registry tool → its `capabilityId`;
 * otherwise `"tool.invoke"`. This replaces the
 * `legacyCapabilityToCanonical(inferCapability(name))` composition at call
 * sites (the canonicalizer is for config keys, not tool names).
 */
export function canonicalCapabilityOf(toolName: string): string {
  return resolveCataloguedExecutor(capabilityCatalog, toolName)?.capabilityId
    ?? uncataloguedFallback(toolName);
}

/** True when no tool for the capability mutates state (registry-derived). */
export function isReadonlyCapability(capabilityId: string): boolean {
  return !capabilityCatalog.list().some(t => t.capabilityId === capabilityId && t.mutates);
}

/**
 * True when every tool for the capability carries non-low risk
 * (registry-derived).
 *
 * NOTE: signature changed from the legacy `(capability, policy)` form — the
 * only consumer was the unit test, which built a `PolicyConfig`. It is now a
 * pure registry predicate over the canonical taxonomy.
 */
export function requiresApproval(capabilityId: string): boolean {
  return capabilityCatalog
    .list()
    .filter(t => t.capabilityId === capabilityId)
    .every(t => t.risk !== "low");
}
