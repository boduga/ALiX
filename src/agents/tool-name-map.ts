// Maps model tool names (alix_file_read) to executor names (file.read)
// Shared between main agent (run.ts) and subagents (SubagentCLI)

export type ToolNameMap = Record<string, string>;

export const TOOL_NAME_MAP: ToolNameMap = {
  alix_file_read:    "file.read",
  alix_file_write:   "file.write",
  alix_file_create:  "file.create",
  alix_file_delete:  "file.delete",
  alix_dir_search:   "dir.search",
  alix_shell_run:    "shell.run",
  alix_patch_apply:  "patch.apply",
  alix_done:         "done",
  alix_delegate:     "delegate",
  mcp_search_tools: "mcp_search_tools",
};
