import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { HookRunner } from "../../src/extensions/hook-runner.js";
import { createHookTool } from "../../src/self-extend/create-hook.js";

describe("create_hook tool", () => {
  it("returns a tool definition", () => {
    const runner = new HookRunner();
    const tool = createHookTool(runner);
    assert.equal(tool.name, "create_hook");
    assert.ok(tool.description);
    assert.ok(tool.input_schema);
  });

  it("registers a hook when executed", async () => {
    const runner = new HookRunner();
    const tool = createHookTool(runner);
    await tool.execute({
      description: "log file deletes",
      trigger: "on_post_tool",
      body: "console.log('deleted', data.toolName)",
    });
    const hooks = runner.listHooks();
    assert.equal(hooks.length, 1);
  });

  it("rejects empty body", async () => {
    const runner = new HookRunner();
    const tool = createHookTool(runner);
    const result = await tool.execute({
      description: "x",
      trigger: "on_pre_tool",
      body: "",
    });
    assert.equal(result.kind, "error");
  });
});
