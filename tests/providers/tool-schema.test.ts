import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildToolCallSchema } from "../../src/providers/specs/_tool-schema.js";

describe("buildToolCallSchema", () => {
  it("returns an object schema", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.equal(schema.type, "object");
  });

  it("includes all tool names in enum", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
      { name: "shell.run", description: "y", input_schema: { type: "object", properties: {} } },
    ]);
    assert.deepEqual((schema.properties as any).name.enum, ["file.read", "shell.run"]);
  });

  it("requires name and arguments fields", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.deepEqual(schema.required, ["name", "arguments"]);
  });

  it("arguments is an object type", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.equal((schema.properties as any).arguments.type, "object");
  });
});