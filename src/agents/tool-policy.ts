import type { SubagentRole } from "../operations/config/schema.js";
import {
  AGENT_REGISTRY,
  getPolicyBucket,
} from "./agent-registry.js";

export type ToolCategory = "read" | "write" | "mcp";

export type ToolPolicy = {
  allowedCategories: ToolCategory[];
  maxIterations: number;
  maxShellCommandsPerIteration: number;
  allowMcpTools: boolean;
};

// Policies keyed by role or style
const READ_ONLY_ROLES: SubagentRole[] = AGENT_REGISTRY
  .filter((a) => getPolicyBucket(a.role) === "read")
  .map((a) => a.role);

const WRITE_ROLES: SubagentRole[] = AGENT_REGISTRY
  .filter((a) => getPolicyBucket(a.role) === "write")
  .map((a) => a.role);

const RESEARCH_ROLES: SubagentRole[] = AGENT_REGISTRY
  .filter((a) => getPolicyBucket(a.role) === "research")
  .map((a) => a.role);

export function getToolPolicy(role: SubagentRole): ToolPolicy {
  if (READ_ONLY_ROLES.includes(role)) {
    return {
      allowedCategories: ["read"],
      maxIterations: 5,
      maxShellCommandsPerIteration: 3,
      allowMcpTools: false,
    };
  }
  if (WRITE_ROLES.includes(role)) {
    return {
      allowedCategories: ["read", "write", "mcp"],
      maxIterations: 5,
      maxShellCommandsPerIteration: 5,
      allowMcpTools: true,
    };
  }
  if (RESEARCH_ROLES.includes(role)) {
    return {
      allowedCategories: ["read", "mcp"],
      maxIterations: 5,
      maxShellCommandsPerIteration: 3,
      allowMcpTools: true,
    };
  }
  // Default: read-only fallback
  return {
    allowedCategories: ["read"],
    maxIterations: 3,
    maxShellCommandsPerIteration: 2,
    allowMcpTools: false,
  };
}

// Built-in tools that are not workspace writers. Deliberately NOT called
// "read-only": the set includes `alix_shell_run` (arbitrary command execution,
// separately `ask`-gated in DEFAULT_CONFIG.permissions.tools) and the
// coordination/state readers, so "non-write" is the honest description of what
// these have in common. Membership decides which `allowedCategories` a role
// needs, not what the tool may do.
export const NON_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "alix_file_read",
  "alix_file_exists",
  "alix_grep_search",
  "alix_glob_match",
  "alix_shell_run",
  "alix_coordination_status",
  "alix_coordination_list",
  "alix_coordination_results",
  "alix_state_query",
  "alix_verify_claim",
  "alix_web_search",
  "alix_web_fetch",
  "alix_list_extensions",
  "alix_inspect_extension",
  "alix_done",
]);

// Built-in write tool names
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "alix_file_create",
  "alix_file_delete",
  "alix_patch_apply",
  "alix_schedule_propose",
  "alix_delegate",
  "alix_coordination_run",
  "alix_hook_create",
  "alix_create_skill",
  "alix_execution_state_propose",
]);

export function filterTools(tools: Array<{ name: string; description?: string }>, policy: ToolPolicy): Array<{ name: string; description?: string }> {
  return tools.filter((tool) => {
    // done is always allowed
    if (tool.name === "alix_done") return true;

    if (tool.name === "alix_mcp_search_tools") return policy.allowMcpTools;

    // MCP tools
    if (tool.name.startsWith("mcp__")) {
      if (!policy.allowMcpTools) return false;
      return true;
    }

    // Built-in tools
    if (NON_WRITE_TOOLS.has(tool.name)) {
      return policy.allowedCategories.includes("read");
    }
    if (WRITE_TOOLS.has(tool.name)) {
      return policy.allowedCategories.includes("write");
    }
    // Unlisted built-in: deny. Every `alix_*` name in ALIX_BUILTIN_EXECUTORS
    // should appear in exactly one of the two sets above (or be handled
    // explicitly, as `alix_done` and `alix_mcp_search_tools` are), so this is
    // the fail-closed branch for a name the manifest gains and policy has not
    // classified yet. The `alix_collaboration_*` tools are deliberately in
    // neither set: they reach a worker only as bound tools, which bypass this
    // function entirely (see `ToolExecutor` `boundTools` in worker-executor.ts).
    return false;
  });
}
