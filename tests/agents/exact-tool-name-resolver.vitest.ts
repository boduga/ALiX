import { describe, expect, it } from "vitest";
import { resolveExecutableToolName, ToolNotFoundError } from "../../src/agents/tool-name-resolver.js";
import { ALIX_BUILTIN_EXECUTORS } from "../../src/agents/tool-manifest.js";

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

  it("rejects an executor ID even when that tool IS offered this turn", () => {
    // ONE vocabulary. `file.read` is a real executor ID and `alix_file_read`
    // is offered here, but the callable name is `alix_file_read` only. The
    // documented-executor alias was removed once every model-facing contract
    // bullet named the `alix_*` tool, so it no longer bridged anything real —
    // it only widened the accepted surface and gave consumers of tool identity
    // two spellings to reconcile.
    expect(() => resolveExecutableToolName("file.read", offered)).toThrow(ToolNotFoundError);
    try {
      resolveExecutableToolName("file.read", offered);
    } catch (error) {
      // The rejection must name the CALLABLE options, so the model can
      // self-correct in one turn rather than being left guessing.
      expect((error as ToolNotFoundError).offeredTools).toContain("alix_file_read");
    }
  });

  it("still resolves a discovered MCP executor name for its opaque handle", () => {
    // MCP handles are minted per turn and cannot be pre-declared, so the
    // discovered executor name remains an accepted equivalent spelling.
    expect(resolveExecutableToolName("mcp.github.repos.list", offered)).toBe("mcp.github.repos.list");
  });

  it.each(["shell.run", "file.create", "patch.apply", "verify.claim", "done", "web_search"])(
    "rejects the executor ID %s regardless of the offered surface",
    (executorId) => {
      // Every built-in executor ID is uncallable, offered or not. This is the
      // regression guard for the alias removal: the reverse index is gone, so
      // there is no path by which an executor spelling resolves a built-in.
      const allBuiltins = Object.keys(ALIX_BUILTIN_EXECUTORS).map((name) => ({ name }));
      expect(() => resolveExecutableToolName(executorId, allBuiltins)).toThrow(ToolNotFoundError);
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
