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

  it("includes text and tool as type options", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.deepEqual((schema.properties as any).type.enum, ["text", "tool"]);
  });

  it("includes all tool names in name enum", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
      { name: "shell.run", description: "y", input_schema: { type: "object", properties: {} } },
    ]);
    assert.deepEqual((schema.properties as any).name.enum, ["file.read", "shell.run"]);
  });

  it("requires type field", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.deepEqual(schema.required, ["type"]);
  });

  it("content is a string type for text responses", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.equal((schema.properties as any).content.type, "string");
  });

  it("arguments is an object type for tool calls", () => {
    const schema = buildToolCallSchema([
      { name: "file.read", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.equal((schema.properties as any).arguments.type, "object");
  });
});
