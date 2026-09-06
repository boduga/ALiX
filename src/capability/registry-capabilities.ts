import type { Capability, Permission } from "./types.js";
import type { ToolCapability, ToolRegistry } from "../tools/tool-registry.js";

/** Palette capability id for a registry tool name. Uniform `tool.<name>` convention. */
export function toolCapabilityId(toolName: string): string {
  return `tool.${toolName}`;
}

/** Project a single ToolCapability (from the canonical registry) into a palette Capability. */
export function projectToolCapability(tool: ToolCapability): Capability {
  const perm: Permission[] =
    tool.risk === "high" || tool.risk === "critical" ? ["admin"] : ["developer"];

  return {
    id: toolCapabilityId(tool.name),
    version: "1.0",
    kind: "tool",
    title: tool.name,
    description: tool.description,
    tags: tool.tags,
    category: tool.domain,
    risk: tool.risk,
    requiredPermissions: perm,
    execution: { strategy: "tool", timeout: 30_000, cancellable: true },
    extensions: {
      domain: tool.domain,
      policyKey: tool.policyKey,
      capabilityId: tool.capabilityId,
      toolName: tool.name,
      mutates: tool.mutates,
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
