import { describe, it, expect, vi } from "vitest";
import { renderToolManifest } from "../../src/agents/agent/system-prompt.js";
import { handleMcpToolSearch, handleToolCall } from "../../src/execution/run/event-handlers.js";
import { BASE_TOOLS } from "../../src/execution/run/helpers.js";
import type { EventHandlerDeps } from "../../src/execution/run/event-handlers.js";
import type { ToolDef } from "../../src/models/providers/types.js";

/**
 * Regression tests for the "model hallucinates foreign tool names" bug
 * (observed: DeepSeek-chat emitted `exec_command` / `<<DSML>>` in the agent
 * TUI). Two fixes:
 *  1. renderToolManifest anchors the model to ALiX's real tool names + format.
 *  2. handleToolCall's unknown-tool guard turns an invented name into a
 *     corrective <tool_result> instead of a terse "no router found".
 */

const SHELL_TOOL: ToolDef = {
  name: "alix_shell_run",
  description: "Run a shell command in the workspace. Use && to chain commands.",
  input_schema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
};

describe("renderToolManifest", () => {
  it("lists each tool by its exact alix_* name", () => {
    const manifest = renderToolManifest([
      SHELL_TOOL,
      { ...SHELL_TOOL, name: "alix_done", description: "Mark the task complete." },
    ]);
    expect(manifest).toContain("alix_shell_run");
    expect(manifest).toContain("alix_done");
    expect(manifest).toContain("Run a shell command in the workspace");
  });

  it("includes the exact text-fallback invocation format the parser expects", () => {
    const manifest = renderToolManifest([SHELL_TOOL]);
    expect(manifest).toContain("<alix_shell_run><command>ls -la</command></alix_shell_run>");
  });

  it("warns the model not to invent tool names", () => {
    const manifest = renderToolManifest([SHELL_TOOL]);
    expect(manifest).toMatch(/never invent tool names/i);
  });
});

describe("handleToolCall unknown-tool guard", () => {
  function makeDeps(executor: unknown): EventHandlerDeps {
    return {
      executor: executor as EventHandlerDeps["executor"],
      mcpManager: null,
      mcpDiscovery: null,
      scope: {} as EventHandlerDeps["scope"],
      session: { sessionId: "s-1", actor: "system" },
      sessionState: {} as EventHandlerDeps["sessionState"],
      log: { append: vi.fn().mockResolvedValue(undefined) } as unknown as EventHandlerDeps["log"],
      selectedTools: [],
      mcpToolIndex: [],
      config: { permissions: { sessionMode: "bypass" } },
    };
  }

  it("rejects an invented tool name and lists the real tools without executing", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", output: "never" }) };
    const result = await handleToolCall(
      { id: "call-1", name: "exec_command", args: { cmd: "ls" } },
      makeDeps(executor),
      [],
      [],
    );
    expect(result.message?.content).toContain('Unknown tool "exec_command"');
    expect(result.message?.content).toContain("alix_shell_run");
    expect(result.continue).toBe(true);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it.each(["file_read", "alix_dir_search", "alix_git_status", "exec_command", "mcp.github.repos.list"])(
    "rejects legacy, phantom, or executor name %s before dispatch",
    async (name) => {
      const executor = { execute: vi.fn() };
      const deps = makeDeps(executor);
      deps.selectedTools = [{ name: "mcp__a1b2", execName: "mcp.github.repos.list" }];
      deps.mcpToolIndex = [{ name: "mcp__a1b2", execName: "mcp.github.repos.list", serverName: "github", toolName: "repos.list", description: "List repos" }];
      const result = await handleToolCall({ id: "legacy", name, args: {} }, deps, [], []);
      expect(result.message?.content).toContain(`Unknown tool "${name}"`);
      expect(result.message?.content).toContain("mcp__a1b2");
      expect(executor.execute).not.toHaveBeenCalled();
    },
  );

  it("records a tool.rejected event carrying the raw requested name", async () => {
    // Without this, a hallucinated name leaves no trace: `ToolExecutor` only
    // ever records the post-resolution executor, so the rejection was
    // visible solely as a tool_result string the model reads.
    const executor = { execute: vi.fn() };
    const deps = makeDeps(executor);
    await handleToolCall({ id: "inv-n", name: "exec_command", args: {} }, deps, [], []);
    const appended = (deps.log.append as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const rejected = appended.map((c) => c[0] as { type: string; payload?: Record<string, unknown> })
      .find((e) => e.type === "tool.rejected");
    expect(rejected).toBeDefined();
    expect(rejected?.payload?.requestedName).toBe("exec_command");
    expect(rejected?.payload?.reason).toBe("name-not-offered");
  });

  it("rejects a documented executor ID instead of routing it to the executor", async () => {
    // The alias used to let `shell.run` reach the shell executor whenever
    // `alix_shell_run` was offered. It is removed: the callable name is the
    // `alix_*` form only. `shell.run` must now be rejected WITHOUT executing,
    // and the rejection must list the callable options so the model can
    // self-correct in one turn.
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", output: "ok" }) };
    const result = await handleToolCall(
      { id: "call-alias", name: "shell.run", args: { command: "ls" } },
      makeDeps(executor),
      [],
      [],
    );
    expect(executor.execute).not.toHaveBeenCalled();
    expect(result.message?.content).toContain('Unknown tool "shell.run"');
    expect(result.message?.content).toContain("alix_shell_run");
  });

  it("does not let an executor ID reach a tool absent from this turn", async () => {
    // `patch.apply` is a real executor ID; only `alix_file_read` is offered.
    const executor = { execute: vi.fn() };
    const deps = makeDeps(executor);
    deps.offeredTools = [{ name: "alix_file_read" }];
    const result = await handleToolCall({ id: "no-alias", name: "patch.apply", args: {} }, deps, [], []);
    expect(result.message?.content).toContain('Unknown tool "patch.apply"');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it("does NOT reject a real alix_* tool and routes it to the executor", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", output: "ok" }) };
    const result = await handleToolCall(
      { id: "call-2", name: "alix_shell_run", args: { command: "ls" } },
      makeDeps(executor),
      [],
      [],
    );
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "shell.run", toolCallId: "call-2" }),
    );
    // T5 correlation: result retains executionId/invocationId attrs + content.
    expect(result.message?.content).toContain(
      '<tool_result id="call-2" invocationId="inv-test" executionId="exec-test">\nok\n</tool_result>',
    );
  });

  it("dispatches canonical offered collaboration tools through their bound handler", async () => {
    const executor = {
      execute: vi.fn(),
      authorizeBoundTool: vi.fn().mockResolvedValue({ decision: "allow", reason: "Allowed by tool policy (mode: bypass)" }),
    };
    const handler = vi.fn().mockResolvedValue(JSON.stringify({ findingId: "finding-1" }));
    const name = "alix_collaboration_publish_finding";
    const deps = Object.assign(makeDeps(executor), {
      offeredTools: [{ name }],
      boundTools: [{ definition: { name, description: "Publish finding", inputSchema: { type: "object", properties: {} } }, handler }],
    });
    const result = await handleToolCall({ id: "collab-1", name, args: { title: "Fact" } }, deps, [], []);
    expect(executor.authorizeBoundTool).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ title: "Fact" });
    expect(executor.execute).not.toHaveBeenCalled();
    expect(result.message?.content).toContain('{"findingId":"finding-1"}');
  });

  it("denies a bound collaboration tool when the policy gate denies", async () => {
    // R1.5: bound tools are authorized before dispatch — a denial must never
    // reach the handler.
    const executor = {
      execute: vi.fn(),
      authorizeBoundTool: vi.fn().mockResolvedValue({ decision: "deny", reason: "Path is protected" }),
    };
    const handler = vi.fn();
    const name = "alix_collaboration_publish_finding";
    const deps = Object.assign(makeDeps(executor), {
      offeredTools: [{ name }],
      boundTools: [{ definition: { name, description: "Publish finding", inputSchema: { type: "object", properties: {} } }, handler }],
    });
    const result = await handleToolCall({ id: "collab-deny", name, args: { title: "No" } }, deps, [], []);
    expect(handler).not.toHaveBeenCalled();
    expect(result.message?.content).toContain("Access denied");
    expect(result.message?.content).toContain("Path is protected");
    expect(result.succeeded).toBe(false);
  });

  it("fails closed when a bound tool asks but no durable approval backs it", async () => {
    // R1.5: ask without an approval id (no approval store) must not run the
    // handler — missing governance dependency fails closed.
    const executor = {
      execute: vi.fn(),
      authorizeBoundTool: vi.fn().mockResolvedValue({ decision: "ask", reason: "Approval required" }),
    };
    const handler = vi.fn();
    const name = "alix_collaboration_publish_finding";
    const deps = Object.assign(makeDeps(executor), {
      offeredTools: [{ name }],
      boundTools: [{ definition: { name, description: "Publish finding", inputSchema: { type: "object", properties: {} } }, handler }],
    });
    const result = await handleToolCall({ id: "collab-ask", name, args: { title: "No" } }, deps, [], []);
    expect(handler).not.toHaveBeenCalled();
    expect(result.message?.content).toContain("Access denied");
    expect(result.succeeded).toBe(false);
  });

  it("runs a bound tool only after its durable approval resolves approved", async () => {
    const executor = {
      execute: vi.fn(),
      authorizeBoundTool: vi.fn().mockResolvedValue({ decision: "ask", approvalId: "apr-1", reason: "Pending approval: apr-1" }),
      getApproval: vi.fn().mockReturnValue({ status: "approved" }),
    };
    const handler = vi.fn().mockResolvedValue("published");
    const name = "alix_collaboration_publish_finding";
    const deps = Object.assign(makeDeps(executor), {
      offeredTools: [{ name }],
      boundTools: [{ definition: { name, description: "Publish finding", inputSchema: { type: "object", properties: {} } }, handler }],
    });
    const result = await handleToolCall({ id: "collab-approve", name, args: { title: "Yes" } }, deps, [], []);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.message?.content).toContain("published");
    expect((deps.log.append as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .some((c) => ((c[0] as { type?: string }).type === "approval.resolved"))).toBe(true);
  });

  it("short-circuits repeated identical read-only search calls", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", matches: [] }) };
    const deps = { ...makeDeps(executor), searchCallGuard: new Map<string, number>() };
    const call = (id: string) =>
      handleToolCall({ id, name: "alix_grep_search", args: { pattern: "needle" } }, deps, [], []);

    await call("s1");
    await call("s2");
    await call("s3");
    const fourth = await call("s4");

    // Only the first three executed; the fourth is short-circuited with a hint.
    expect(executor.execute).toHaveBeenCalledTimes(3);
    expect(fourth.message?.content).toContain("repeated search call");
    expect(fourth.continue).toBe(true);
  });

  it("collapses near-identical search calls (path trailing slash)", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", matches: [] }) };
    const deps = { ...makeDeps(executor), searchCallGuard: new Map<string, number>() };
    for (const path of ["src/x", "src/x/", "src/x//"]) {
      await handleToolCall({ id: `n${path}`, name: "alix_grep_search", args: { pattern: "needle", path } }, deps, [], []);
    }
    const fourth = await handleToolCall({ id: "n4", name: "alix_grep_search", args: { pattern: "needle", path: "src/x" } }, deps, [], []);
    expect(executor.execute).toHaveBeenCalledTimes(3);
    expect(fourth.message?.content).toContain("repeated search call");
  });

  it("caps a per-tool search loop even when the pattern varies", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", matches: [] }) };
    const deps = { ...makeDeps(executor), searchCallGuard: new Map<string, number>() };
    for (let i = 0; i < 8; i++) {
      await handleToolCall({ id: `v${i}`, name: "alix_grep_search", args: { pattern: `needle-${i}` } }, deps, [], []);
    }
    const ninth = await handleToolCall({ id: "v8", name: "alix_grep_search", args: { pattern: "needle-8" } }, deps, [], []);
    expect(executor.execute).toHaveBeenCalledTimes(8);
    expect(ninth.message?.content).toContain("search loop, not progress");
  });

  it("does not guard a different search pattern", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", matches: [] }) };
    const deps = { ...makeDeps(executor), searchCallGuard: new Map<string, number>() };
    for (let i = 0; i < 5; i++) {
      await handleToolCall({ id: `p${i}`, name: "alix_grep_search", args: { pattern: `needle-${i}` } }, deps, [], []);
    }
    expect(executor.execute).toHaveBeenCalledTimes(5);
  });

  it("redirects a local-looking web_search to the workspace tools", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", output: "web" }) };
    const result = await handleToolCall(
      { id: "w1", name: "alix_web_search", args: { query: "export async function handle Command in src/interfaces/cli/commands" } },
      makeDeps(executor),
      [],
      [],
    );
    expect(executor.execute).not.toHaveBeenCalled();
    expect(result.message?.content).toContain("cannot access the local workspace");
    expect(result.message?.content).toContain("alix_grep_search");
  });

  it("allows a genuine web_search query", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", output: "web" }) };
    await handleToolCall(
      { id: "w2", name: "alix_web_search", args: { query: "latest Node.js LTS release" } },
      makeDeps(executor),
      [],
      [],
    );
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });
});

describe("MCP search tool", () => {
  it("is offered under the alix namespace", () => {
    expect(BASE_TOOLS.some(tool => tool.name === "alix_mcp_search_tools")).toBe(true);
  });

  it("does not service a search call omitted from this turn's offered tools", async () => {
    const deps = {
      offeredTools: [{ name: "alix_file_read" }],
      mcpDiscovery: { search: vi.fn() },
    } as unknown as EventHandlerDeps;
    const result = await handleMcpToolSearch({ id: "hidden", name: "alix_mcp_search_tools", args: { query: "repo" } }, deps);
    expect(result.handled).toBe(false);
    expect(deps.mcpDiscovery?.search).not.toHaveBeenCalled();
  });
});

/**
 * Regression: search tools answer with `matches[]` (grep.search, dir.search),
 * not `output`/`content`. Reading only those two handed the model an empty
 * <tool_result> for every search that matched — observed in cohort
 * t3d-2026-09-28-a, where the model looped four times reporting "the tool
 * results appear empty" while the telemetry previews held the matches.
 */
describe("handleToolCall search results reach the model", () => {
  function makeDeps(executor: unknown): EventHandlerDeps {
    return {
      executor: executor as EventHandlerDeps["executor"],
      mcpManager: null,
      mcpDiscovery: null,
      scope: {} as EventHandlerDeps["scope"],
      session: { sessionId: "s-1", actor: "system" },
      sessionState: {} as EventHandlerDeps["sessionState"],
      log: { append: vi.fn().mockResolvedValue(undefined) } as unknown as EventHandlerDeps["log"],
      selectedTools: [],
      mcpToolIndex: [],
      config: { permissions: { sessionMode: "bypass" } },
    };
  }

  it("carries the match list for a matches[] result", async () => {
    const executor = {
      execute: vi.fn().mockResolvedValue({
        kind: "success",
        matches: [{ path: "src/planning/decision/tool-selection-replay.ts", lineNumber: 34, line: "export type ToolSelectionScope = {" }],
      }),
    };
    const result = await handleToolCall(
      { id: "call-grep", name: "alix_grep_search", args: { pattern: "ToolSelectionScope" } },
      makeDeps(executor),
      [],
      [],
    );
    expect(result.message?.content).toContain("src/planning/decision/tool-selection-replay.ts:34: export type ToolSelectionScope = {");
  });

  it("says the output was empty when a search matched nothing", async () => {
    const executor = { execute: vi.fn().mockResolvedValue({ kind: "success", matches: [] }) };
    const result = await handleToolCall(
      { id: "call-grep-miss", name: "alix_grep_search", args: { pattern: "zzz-no-such-symbol" } },
      makeDeps(executor),
      [],
      [],
    );
    expect(result.message?.content).toContain("[no output]");
  });
});
