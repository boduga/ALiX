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

  it.each(["file_read", "mcp_github_repos_list", "alix_dir_search", "alix_git_status"])(
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

  it("resolves a documented executor ID to the offered tool that implements it", () => {
    // The repo's own DOX/specs name tools by executor ID (`shell.run`,
    // `file.create`, `patch.apply`, `verify.claim`). A model that reads them
    // and calls `file.read` is naming a tool this repository taught it to
    // name — the alias exists so that costs no turn.
    expect(resolveExecutableToolName("file.read", offered)).toBe("file.read");
    expect(resolveExecutableToolName("mcp.github.repos.list", offered)).toBe("mcp.github.repos.list");
  });

  it("does not let the executor alias grant a tool that was not offered", () => {
    // `shell.run` is a real executor ID, but `alix_shell_run` is absent here.
    expect(() => resolveExecutableToolName("shell.run", offered)).toThrow(ToolNotFoundError);
  });

  it("does not resolve a valid built-in if it was not offered this turn", () => {
    expect(() => resolveExecutableToolName("alix_shell_run", offered)).toThrow(ToolNotFoundError);
  });

  it("does not execute a forged dynamic entry with a non-MCP executor", () => {
    expect(() => resolveExecutableToolName("mcp__forged", [{ name: "mcp__forged", execName: "shell.run" }]))
      .toThrow(ToolNotFoundError);
  });
});
