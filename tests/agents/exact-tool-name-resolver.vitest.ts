import { describe, expect, it } from "vitest";
import { resolveExecutableToolName, ToolNotFoundError } from "../../src/agents/tool-name-resolver.js";

describe("exact model tool name resolution", () => {
  const offered = [
    { name: "alix_file_read" },
    { name: "alix_mcp_search_tools" },
    { name: "mcp__a1b2", execName: "mcp.github.repos.list" },
  ];

  it("resolves only offered canonical built-ins and dynamic MCP handles", () => {
    expect(resolveExecutableToolName("alix_file_read", offered)).toBe("file.read");
    expect(resolveExecutableToolName("mcp__a1b2", offered)).toBe("mcp.github.repos.list");
  });

  it.each(["file.read", "file_read", "mcp.github.repos.list", "mcp_github_repos_list", "alix_dir_search", "alix_git_status"])(
    "rejects legacy or phantom name %s with exact offered names",
    (name) => {
      expect(() => resolveExecutableToolName(name, offered)).toThrow(ToolNotFoundError);
      try {
        resolveExecutableToolName(name, offered);
      } catch (error) {
        expect((error as ToolNotFoundError).offeredTools).toEqual(offered.map((tool) => tool.name));
      }
    },
  );

  it("does not resolve a valid built-in if it was not offered this turn", () => {
    expect(() => resolveExecutableToolName("alix_shell_run", offered)).toThrow(ToolNotFoundError);
  });

  it("does not execute a forged dynamic entry with a non-MCP executor", () => {
    expect(() => resolveExecutableToolName("mcp__forged", [{ name: "mcp__forged", execName: "shell.run" }]))
      .toThrow(ToolNotFoundError);
  });
});
