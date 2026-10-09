// src/runtime-state/contracts/tool-capability-registry.ts
//
// R1 boundary freeze — ToolCapabilityRegistry.
// One contract for tool/capability resolution. MCP and agent
// manifests adapt to this contract; they do not define parallel
// taxonomies through this port.
//
// The entry reuses the canonical catalogue type (`ToolCapability`) rather than
// redeclaring its fields (src/runtime-state/contracts/AGENTS.md: reuse domain types).

import type { ToolCapability } from "../../capabilities/tools/tool-registry.js";

export type ToolCapabilityEntry = Pick<
  ToolCapability,
  "name" | "capabilityId" | "policyKey" | "risk" | "mutates"
>;

export interface ToolCapabilityRegistry {
  resolve(name: string): ToolCapabilityEntry | undefined;
  list(): readonly ToolCapabilityEntry[];
}
