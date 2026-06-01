// tests/self-extend/inspect-extension.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { inspectExtensionTool } from "../../src/self-extend/inspect-extension.js";
import { registerInProcess, _clearInProcessForTesting } from "../../src/self-extend/registry.js";

describe("inspect_extension tool", () => {
  beforeEach(() => _clearInProcessForTesting());

  it("returns a tool definition", () => {
    const tool = inspectExtensionTool();
    assert.equal(tool.name, "inspect_extension");
  });

  it("returns the manifest for a registered extension", async () => {
    registerInProcess({
      type: "skill",
      name: "my-skill",
      manifest: { type: "skill", name: "my-skill", description: "Does things", trigger: "things", body: "# Steps", is_core: false },
      registeredAt: 12345,
    });
    const tool = inspectExtensionTool();
    const result = await tool.execute({ type: "skill", name: "my-skill" });
    assert.equal(result.ok, true);
    const data = result.data as any;
    assert.equal(data.manifest.name, "my-skill");
    assert.equal(data.metadata.registeredAt, 12345);
  });

  it("returns error for missing extension", async () => {
    const tool = inspectExtensionTool();
    const result = await tool.execute({ type: "skill", name: "missing" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("not found"));
  });
});