import { describe, it, expect, vi } from "vitest";
import { renderToolManifest } from "../../src/agent/system-prompt.js";
import { handleToolCall } from "../../src/run/event-handlers.js";
import type { EventHandlerDeps } from "../../src/run/event-handlers.js";
import type { ToolDef } from "../../src/providers/types.js";

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
    expect(result.message?.content).toContain('<tool_result id="call-2">');
  });
});
