// tests/contracts/provider-tool-schemas.vitest.ts

import { describe, it, assert } from "vitest";
import { Schema } from "effect";
import {
  ToolParamSchema,
  ToolDefSchema,
  NormalizedToolResultSchema,
} from "../../src/contracts/provider-tool-schemas.js";

describe("ToolParamSchema", () => {
  it("decodes a string parameter", () => {
    const p = Schema.decodeSync(ToolParamSchema)({
      type: "string",
      description: "The file path",
    } as any);
    assert.strictEqual(p.type, "string");
  });

  it("decodes a parameter with enum", () => {
    const p: any = Schema.decodeSync(ToolParamSchema)({
      type: "string",
      enum: ["low", "medium", "high"],
    } as any);
    assert.strictEqual(p.enum?.length, 3);
  });

  it("decodes an array parameter with items", () => {
    const p = Schema.decodeSync(ToolParamSchema)({
      type: "array",
      items: { type: "string" },
    } as any);
    assert.strictEqual(p.type, "array");
  });

  it("rejects malformed parameter", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolParamSchema)({ type: 42 } as any)
    );
  });
});

describe("ToolDefSchema", () => {
  it("decodes a valid tool definition", () => {
    const t = Schema.decodeSync(ToolDefSchema)({
      name: "file.read",
      description: "Read a file",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          limit: { type: "number", description: "Max lines" },
        },
        required: ["path"],
      },
    } as any);
    assert.strictEqual(t.name, "file.read");
    assert.strictEqual(t.input_schema.required?.[0], "path");
  });

  it("rejects tool def missing name", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolDefSchema)({
        description: "No name",
        input_schema: { type: "object", properties: {} },
      } as any)
    );
  });

  it("rejects tool def with wrong input_schema type", () => {
    assert.throws(() =>
      Schema.decodeSync(ToolDefSchema)({
        name: "bad",
        description: "Bad schema",
        input_schema: { type: "array", properties: {} },
      } as any)
    );
  });
});

describe("NormalizedToolResultSchema", () => {
  it("decodes a valid tool result", () => {
    const r = Schema.decodeSync(NormalizedToolResultSchema)({
      toolUseId: "tu-1",
      content: "File created",
    } as any);
    assert.strictEqual(r.toolUseId, "tu-1");
    assert.strictEqual(r.content, "File created");
  });

  it("rejects missing toolUseId", () => {
    assert.throws(() =>
      Schema.decodeSync(NormalizedToolResultSchema)({
        content: "missing id",
      } as any)
    );
  });
});
