// tests/self-extend/list-extensions.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { listExtensionsTool } from "../../src/self-extend/list-extensions.js";
import { registerInProcess, _clearInProcessForTesting } from "../../src/self-extend/registry.js";

describe("list_extensions tool", () => {
  beforeEach(() => _clearInProcessForTesting());

  it("returns a tool definition", () => {
    const tool = listExtensionsTool();
    assert.equal(tool.name, "list_extensions");
  });

  it("returns empty when no extensions registered", async () => {
    const tool = listExtensionsTool();
    const result = await tool.execute({});
    assert.equal(result.ok, true);
    const data = result.data as any;
    assert.ok(Array.isArray(data.skills));
    assert.equal(data.skills.length, 0);
  });

  it("lists in-process skills", async () => {
    registerInProcess({
      type: "skill",
      name: "foo",
      manifest: { type: "skill", name: "foo", description: "Does foo", trigger: "foo", is_core: false },
      registeredAt: Date.now(),
    });
    const tool = listExtensionsTool();
    const result = await tool.execute({});
    const data = result.data as any;
    assert.equal(data.skills.length, 1);
    assert.equal(data.skills[0].name, "foo");
  });

  it("groups by type", async () => {
    registerInProcess({
      type: "skill", name: "s1", manifest: { type: "skill", name: "s1" }, registeredAt: Date.now(),
    });
    registerInProcess({
      type: "hook", name: "h1", manifest: { type: "hook", name: "h1", trigger: "pre_task" }, registeredAt: Date.now(),
    });
    const tool = listExtensionsTool();
    const result = await tool.execute({});
    const data = result.data as any;
    assert.equal(data.skills.length, 1);
    assert.equal(data.hooks.length, 1);
  });
});