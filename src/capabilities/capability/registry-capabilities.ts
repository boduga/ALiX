import type { Capability, Permission } from "./types.js";
import type { CapabilityRegistry } from "./registry.js";
import type { CapabilityRisk, ToolCapability, ToolRegistry } from "../tools/tool-registry.js";
import { buildDefaultToolIndex } from "../tools/tool-registry.js";

/** Palette capability id for a registry tool name. Uniform `tool.<name>` convention. */
export function toolCapabilityId(toolName: string): string {
  return `tool.${toolName}`;
}

/**
 * Governance permission tier per registry risk (Task 2 field list + plan spec).
 *
 * Exhaustive over the closed 4-value CapabilityRisk union — TypeScript flags
 * any future tier added without an entry, so an unknown risk can never silently
 * fold to the developer tier. No permissive else.
 */
const RISK_TO_PERMISSION: Record<CapabilityRisk, Permission[]> = {
  low: ["developer"],
  medium: ["developer"],
  high: ["admin"],
  critical: ["admin"],
};

/** Project a single ToolCapability (from the canonical registry) into a palette Capability. */
export function projectToolCapability(tool: ToolCapability): Capability {
  return {
    id: toolCapabilityId(tool.name),
    version: "1.0",
    kind: "tool",
    title: tool.name,
    description: tool.description,
    tags: tool.tags,
    category: tool.domain,
    risk: tool.risk,
    requiredPermissions: RISK_TO_PERMISSION[tool.risk],
    // Per-tool execution profile, copied through ONLY when the registry entry
    // declares one. Absent → { strategy: "tool" } with no fabricated
    // timeout/cancellable — never invent a uniform 30s / cancellable:true.
    execution: {
      strategy: "tool",
      ...(tool.execution?.timeoutMs !== undefined ? { timeout: tool.execution.timeoutMs } : {}),
      ...(tool.execution?.cancellable !== undefined ? { cancellable: tool.execution.cancellable } : {}),
    },
    // Schema observability: copied through when the registry entry declares
    // them (file.read, shell.run); otherwise absent.
    ...(tool.argsSchema ? { argsSchema: tool.argsSchema } : {}),
    ...(tool.resultSchema ? { resultSchema: tool.resultSchema } : {}),
    extensions: {
      source: "registry",
      domain: tool.domain,
      policyKey: tool.policyKey,
      capabilityId: tool.capabilityId,
      toolName: tool.name,
      mutates: tool.mutates,
      // Surface marker: alwaysInclude (raw registry datum) and surface (the
      // derived display tag) both ride along per Task 9's spec-mandated
      // redundancy — active = alwaysInclude:true, governed = alwaysInclude:false.
      alwaysInclude: tool.alwaysInclude,
      surface: tool.alwaysInclude ? "active" : "governed",
    },
  };
}

/** Project the whole registry (or a name-filtered subset) into palette Capabilities, sorted by id. */
export function projectRegistryTools(
  registry: ToolRegistry,
  names?: string[],
): Capability[] {
  const all = registry.getAll();
  const filtered = names
    ? all.filter((t) => names.includes(t.name))
    : all;

  return filtered.map(projectToolCapability).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Register a tool registry's concrete tools into the palette.
 *
 * Projects the given registry (default: the canonical default tool registry)
 * and registers each concrete tool capability. The registry's single `mcp.*`
 * wildcard entry is deliberately EXCLUDED: it is not a concrete invocable tool
 * — real `mcp.<server>.<tool>` capabilities are added dynamically at runtime
 * by the agent loop — and its projected id `tool.mcp.*` does not match the
 * palette's capability-id grammar (no glob characters), so registration would
 * throw. Registration is synchronous + static (no I/O), so palette ordering
 * stays deterministic relative to the bootstrap that calls it.
 */
export function registerRegistryToolCapabilities(
  reg: Pick<CapabilityRegistry, 'register'>,
  registry: ToolRegistry = buildDefaultToolIndex().registry,
): void {
  for (const cap of projectRegistryTools(registry)) {
    if (cap.extensions?.toolName === 'mcp.*') continue;
    reg.register(cap);
  }
}
