// tests/self-extend/create-skill.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSkillTool } from "../../src/self-extend/create-skill.js";
import { _clearInProcessForTesting, getInProcess } from "../../src/self-extend/registry.js";

describe("create_skill tool", () => {
  beforeEach(() => _clearInProcessForTesting());

  it("returns a tool definition", () => {
    const tool = createSkillTool();
    assert.equal(tool.name, "create_skill");
    assert.ok(tool.description);
    assert.ok(tool.input_schema);
  });

  it("registers a skill when called", async () => {
    const tool = createSkillTool();
    const result = await tool.execute({
      name: "my-skill",
      description: "Does X",
      trigger: "do X",
      body: "# My Skill\n\nSteps...",
    });
    assert.equal(result.ok, true);
    const ext = getInProcess("skill", "my-skill");
    assert.ok(ext);
  });

  it("rejects empty name", async () => {
    const tool = createSkillTool();
    const result = await tool.execute({ name: "", description: "x", trigger: "x", body: "x" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("name"));
  });

  it("rejects duplicate name", async () => {
    const tool = createSkillTool();
    await tool.execute({ name: "dup", description: "x", trigger: "x", body: "x" });
    const result = await tool.execute({ name: "dup", description: "x", trigger: "x", body: "x" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("exists"));
  });

  it("isCore flag is stored", async () => {
    const tool = createSkillTool();
    await tool.execute({ name: "core-skill", description: "x", trigger: "x", body: "x", isCore: true });
    const ext = getInProcess("skill", "core-skill");
    assert.equal(ext!.manifest.is_core, true);
  });
});