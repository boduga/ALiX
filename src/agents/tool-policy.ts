import type { SubagentRole } from "../config/schema.js";

export type ToolCategory = "read" | "write" | "mcp";

export type ToolPolicy = {
  allowedCategories: ToolCategory[];
  maxIterations: number;
  maxShellCommandsPerIteration: number;
  allowMcpTools: boolean;
};

// Policies keyed by role or style
const READ_ONLY_ROLES: SubagentRole[] = [
  "explorer",
  "reviewer",
  "test_investigator",
  "docs_researcher",
];

const WRITE_ROLES: SubagentRole[] = ["worker"];

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
  "alix_file_list",
  "alix_file_search",
  "alix_file_view",
  "alix_file_view_tree",
  "alix_git_status",
  "alix_git_diff",
  "alix_git_log",
  "alix_git_search",
  "alix_mcp_list",
  "alix_done",
  "mcp_search_tools",
]);

// Built-in write tool names
const WRITE_TOOLS = new Set([
  "alix_file_write",
  "alix_file_create",
  "alix_file_delete",
  "alix_file_exists",
  "alix_patch_preview",
  "alix_patch_apply",
]);

export function filterTools(tools: Array<{ name: string; description?: string }>, policy: ToolPolicy): Array<{ name: string; description?: string }> {
  return tools.filter((tool) => {
    // done is always allowed
    if (tool.name === "alix_done") return true;

    // mcp_search_tools only allowed when MCP tools are permitted
    if (tool.name === "mcp_search_tools") return policy.allowMcpTools;

    // MCP tools
    if (tool.name.startsWith("mcp_") || tool.name.startsWith("mcp.")) {
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
    // Unknown tool: default to allowed (don't block)
    return true;
  });
}
