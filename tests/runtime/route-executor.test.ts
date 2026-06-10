import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeRoute, type RuntimeContext, type RuntimeExecutor } from "../../src/runtime/route-executor.js";

describe("executeRoute dispatch", () => {
  const mockCtx: RuntimeContext = {
    cwd: "/tmp",
    sessionId: "test",
    sessionDir: "/tmp/.alix/sessions/test",
    eventLog: {} as any,
    config: {} as any,
  };

  const mockExecutor: RuntimeExecutor = {
    executeTool: async (r) => `tool:${r.tool}:${JSON.stringify(r.args)}`,
    executeChat: async (r) => `chat:${r.prompt}`,
    executeGroundedChat: async (r) => `grounded:${r.prompt}:${r.allowedTools.join(",")}`,
    executeAgent: async (r) => `agent:${r.task}`,
  };

  it("dispatches tool route to executeTool", async () => {
    const result = await executeRoute(
      { kind: "tool", tool: "shell.run", args: { command: "ls" } },
      mockCtx, mockExecutor,
    );
    assert.equal(result, 'tool:shell.run:{"command":"ls"}');
  });

  it("dispatches chat route to executeChat", async () => {
    const result = await executeRoute(
      { kind: "chat", prompt: "hello" },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "chat:hello");
  });

  it("dispatches grounded_chat route to executeGroundedChat", async () => {
    const result = await executeRoute(
      { kind: "grounded_chat", prompt: "latest news", allowedTools: ["web.search"] },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "grounded:latest news:web.search");
  });

  it("dispatches agent route to executeAgent", async () => {
    const result = await executeRoute(
      { kind: "agent", task: "fix bugs" },
      mockCtx, mockExecutor,
    );
    assert.equal(result, "agent:fix bugs");
  });
});
