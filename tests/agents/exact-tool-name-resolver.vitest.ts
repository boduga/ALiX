import { describe, expect, it } from "vitest";
import { buildOfferedExecutableTools, resolveExecutableToolName, ToolNotFoundError } from "../../src/agents/tool-name-resolver.js";
import { resolveToolExecutionName } from '../../src/execution/run/task-loop/predicates.js';
import { ALIX_BUILTIN_EXECUTORS, ALIX_EXECUTOR_TO_MODEL_FACING, COMPLETION_MODEL_FACING, isCompletionExecName, isCompletionToolName } from "../../src/agents/tool-manifest.js";

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

  it("rejects a discovered MCP executor alias and reports only callable names", () => {
    expect(() => resolveExecutableToolName("mcp.github.repos.list", offered)).toThrow(ToolNotFoundError);
    try {
      resolveExecutableToolName("mcp.github.repos.list", offered);
    } catch (error) {
      expect(error).toBeInstanceOf(ToolNotFoundError);
      expect((error as ToolNotFoundError).requestedName).toBe("mcp.github.repos.list");
      expect((error as ToolNotFoundError).offeredTools).toEqual(offered.map((tool) => tool.name));
    }
  });

  const acceptanceCases = [
    { label: "offered handle", requested: "mcp__current", tools: [{ name: "mcp__current", execName: "mcp.github.read" }], expected: "mcp.github.read" },
    { label: "executor alias", requested: "mcp.github.read", tools: [{ name: "mcp__current", execName: "mcp.github.read" }], expected: null },
    { label: "unoffered handle", requested: "mcp__stale", tools: [{ name: "mcp__current", execName: "mcp.github.read" }], expected: null },
    { label: "executor presented as handle", requested: "mcp.github.read", tools: [{ name: "mcp.github.read", execName: "mcp.github.read" }], expected: null },
    { label: "missing executor", requested: "mcp__current", tools: [{ name: "mcp__current" }], expected: null },
    { label: "forged built-in executor", requested: "mcp__current", tools: [{ name: "mcp__current", execName: "shell.run" }], expected: null },
    { label: "noncanonical discovery name", requested: "github_read", tools: [{ name: "github_read", execName: "mcp.github.read" }], expected: null },
    { label: "case-altered handle", requested: "mcp__CURRENT", tools: [{ name: "mcp__current", execName: "mcp.github.read" }], expected: null },
  ];

  it.each(acceptanceCases)("MCP acceptance parity: $label", ({ requested, tools, expected }) => {
    if (expected === null) expect(() => resolveExecutableToolName(requested, tools)).toThrow(ToolNotFoundError);
    else expect(resolveExecutableToolName(requested, tools)).toBe(expected);
  });

  it.each(["shell.run", "file.create", "patch.apply", "verify.claim", "done", "web.search"])(
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

describe("completion-tool vocabulary", () => {
  it("keeps the two vocabularies strictly separate", () => {
    // The regression this pins: a single `isCompletionTool` matched BOTH
    // spellings, which read as one tool with two names — the dual-vocabulary
    // acceptance the ONE vocabulary contract forbids. Its executor arm was also
    // dead: every task-loop caller passes `toolCall.name`, which holds the name
    // the model called, so no executor id can reach it.
    expect(isCompletionToolName(COMPLETION_MODEL_FACING)).toBe(true);
    // The executor id must be REJECTED by the model-facing predicate. If this
    // ever passes, someone re-merged the two vocabularies.
    expect(isCompletionToolName("task.complete")).toBe(false);
    // ...and accepted by the executor one, which the TUI trace surface uses.
    expect(isCompletionExecName("task.complete")).toBe(true);
    expect(isCompletionExecName(COMPLETION_MODEL_FACING)).toBe(false);
  });

  it("pins the completion tool's two names, and that they are distinct", () => {
    // This asserts VALUES, not the derivation. Falsifying showed a hardcoded
    // "alix_done" passes identically — it happens to equal what the manifest
    // yields today — so a value assertion cannot detect someone replacing the
    // lookup with a literal. What it does pin is the property that matters:
    // the two vocabularies are not the same string, so no caller can confuse
    // one for the other, and a self-map regression fails here.
    expect(COMPLETION_MODEL_FACING).toBe("alix_done");
    expect(COMPLETION_MODEL_FACING).toBe(ALIX_EXECUTOR_TO_MODEL_FACING.get("task.complete"));
    expect(COMPLETION_MODEL_FACING).not.toBe("task.complete");
  });
});

describe("offered-surface composition", () => {
  it("resolves every offered built-in to its executor, never to itself", () => {
    // The invariant the task loop's telemetry labels depend on. It previously
    // had no test: resolution was hand-rolled against `selectedTools`, the
    // relevance-truncated selector list (capped at 20 against a 24-tool
    // registry), so a tool that was OFFERED but truncated out could not be
    // found. Built-ins were rescued by a manifest lookup that happened to sit in
    // the fallback chain; anything without a manifest entry was not, and its
    // model-facing name was recorded as if it were an executor id.
    const offered = buildOfferedExecutableTools(
      Object.keys(ALIX_BUILTIN_EXECUTORS).map((name) => ({ name })),
    );
    for (const tool of offered) {
      const exec = resolveToolExecutionName(tool.name, offered);
      expect(exec).not.toBe(tool.name);
      expect(exec).toBe(ALIX_BUILTIN_EXECUTORS[tool.name as keyof typeof ALIX_BUILTIN_EXECUTORS]);
    }
  });

  it("resolves a tool that is offered but ABSENT from a truncated selector list", () => {
    // The regression, stated as a case. `selectedTools` was the wrong list; the
    // fix reads the offered surface instead. A built-in must resolve correctly
    // even when some other selector would have dropped it.
    const offered = buildOfferedExecutableTools([{ name: "alix_file_read" }]);
    expect(resolveToolExecutionName("alix_file_read", offered)).toBe("file.read");
  });

  it("keeps an MCP handle resolvable via its index pairing", () => {
    const offered = buildOfferedExecutableTools(
      [{ name: "mcp__langfuse__export" }],
      [{ name: "mcp__langfuse__export", execName: "mcp.langfuse.export" }],
    );
    expect(resolveToolExecutionName("mcp__langfuse__export", offered)).toBe("mcp.langfuse.export");
  });

  it("returns the input for a name that was genuinely NOT offered", () => {
    // Telemetry must never throw and abort a turn, so the fall-through stays —
    // but it is now the LAST resort rather than the primary path. Previously
    // this was the outcome for 102 of 170 calls; now only for names the model
    // genuinely could not have been offered.
    const offered = buildOfferedExecutableTools([{ name: "alix_file_read" }]);
    expect(resolveToolExecutionName("alix_tool_0", offered)).toBe("alix_tool_0");
    expect(resolveToolExecutionName("alix_docs_search", offered)).toBe("alix_docs_search");
  });
});
