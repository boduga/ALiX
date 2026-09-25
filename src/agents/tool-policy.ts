import type { SubagentRole } from "../config/schema.js";
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

// Built-in read-only tool names (alix_* model names)
const READ_ONLY_TOOLS = new Set([
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
  "alix_create_hook",
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
    if (READ_ONLY_TOOLS.has(tool.name)) {
      return policy.allowedCategories.includes("read");
    }
    if (WRITE_TOOLS.has(tool.name)) {
      return policy.allowedCategories.includes("write");
    }
    return false;
  });
}
