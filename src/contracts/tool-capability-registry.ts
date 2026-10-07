// src/contracts/tool-capability-registry.ts
//
// R1 boundary freeze — ToolCapabilityRegistry.
// One contract for tool/capability resolution. MCP and agent
// manifests adapt to this contract; they do not define parallel
// taxonomies through this port.

export interface ToolCapabilityEntry {
  name: string;
  capabilityId: string;
  policyKey: string;
  risk: "low" | "medium" | "high" | "critical";
  mutates: boolean;
}

export interface ToolCapabilityRegistry {
  resolve(name: string): ToolCapabilityEntry | undefined;
  list(): readonly ToolCapabilityEntry[];
}
