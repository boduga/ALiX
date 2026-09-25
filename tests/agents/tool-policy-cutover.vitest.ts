import { describe, expect, it } from "vitest";
import { filterTools, getToolPolicy } from "../../src/agents/tool-policy.js";

describe("worker tool policy after hard cutover", () => {
  const def = (name: string) => ({ name, description: name });

  it("drops phantom and legacy tools even for a write worker", () => {
    const tools = ["alix_file_read", "alix_patch_create", "alix_git_status", "file.read", "mcp_github_search"].map(def);
    expect(filterTools(tools, getToolPolicy("worker")).map(tool => tool.name)).toEqual(["alix_file_read"]);
  });

  it("keeps read-only tools and gates opaque MCP handles by role", () => {
    const tools = ["alix_shell_run", "alix_grep_search", "alix_file_exists", "mcp__opaque"].map(def);
    expect(filterTools(tools, getToolPolicy("explorer")).map(tool => tool.name)).toEqual(tools.slice(0, 3).map(tool => tool.name));
    expect(filterTools(tools, getToolPolicy("worker")).map(tool => tool.name)).toEqual(tools.map(tool => tool.name));
  });
});
