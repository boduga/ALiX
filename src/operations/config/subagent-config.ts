import type { AlixConfig, SubagentRole, SubagentRoleConfig } from "./schema.js";

/** Minimal config surface for subagent behavior flags (never model selection). */
export type SubagentBehaviorConfig = Pick<AlixConfig, "subagents">;

/**
 * Single reader for the subagent `enabled` behavior flag.
 *
 * Behavior config only: it never inspects `models.*` (owned by
 * `createModelResolver`) and never resolves tier projections. Absent
 * config reads disabled.
 */
export function isSubagentsEnabled(config: SubagentBehaviorConfig | undefined): boolean {
  return config?.subagents?.enabled ?? false;
}

/**
 * Single reader for a subagent role's behavior config.
 * Returns undefined when no roles are configured or the role is absent.
 */
export function getSubagentRole(
  config: SubagentBehaviorConfig | undefined,
  role: SubagentRole,
): SubagentRoleConfig | undefined {
  return config?.subagents?.roles?.find((r) => r.role === role);
}
