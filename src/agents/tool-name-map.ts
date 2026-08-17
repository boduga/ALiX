// Maps model tool names (alix_file_read) to executor names (file.read).
// Mirrors the canonical 16-tool surface from buildDefaultToolIndex()
// (src/tools/tool-registry.ts): file.read, file.create, file.delete,
// file.exists, dir.search, shell.run, patch.apply, done, delegate,
// web_search, web_fetch, create_skill, list_extensions, inspect_extension,
// create_hook, mcp.*.
//
// `file.write` is deliberately ABSENT: it is only a policy key for
// file.create/file.delete, NOT an executable tool name — so there is no
// `alix_file_write` alias. MCP tools (`mcp.*`) are added at runtime by the
// agent loop / subagent CLI (TOOL_NAME_MAP[entry.name] = entry.execName),
// so no literal `mcp.*` entry lives here; `mcp_search_tools` is the MCP
// tool-search sentinel.
//
// Shared between main agent (run.ts) and subagents (SubagentCLI)

export type ToolNameMap = Record<string, string>;

export const TOOL_NAME_MAP: ToolNameMap = {
  alix_file_read:         "file.read",
  alix_file_create:       "file.create",
  alix_file_delete:       "file.delete",
  alix_file_exists:       "file.exists",
  alix_dir_search:        "dir.search",
  alix_shell_run:         "shell.run",
  alix_patch_apply:       "patch.apply",
  alix_done:              "done",
  alix_delegate:          "delegate",
  alix_web_search:        "web_search",
  alix_web_fetch:         "web_fetch",
  alix_create_skill:      "create_skill",
  alix_list_extensions:   "list_extensions",
  alix_inspect_extension: "inspect_extension",
  alix_create_hook:       "create_hook",
  mcp_search_tools:       "mcp_search_tools",
};
