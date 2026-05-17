import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchemaCache } from "../../src/mcp/tool-cache.js";
import type { ToolDef } from "../../src/providers/types.js";

function makeDef(name: string): ToolDef {
  return { name, description: "test", input_schema: { type: "object" as const, properties: {} } };
}

describe("SchemaCache TTL", () => {
  it("evicts entries after TTL expires", async () => {
    const cache = new SchemaCache({ ttlMs: 50 });
    cache.set("tool1", makeDef("tool1"));
    assert.ok(cache.has("tool1"));
    await new Promise(r => setTimeout(r, 60));
    assert.ok(!cache.has("tool1"));
  });

  it("evicts oldest entries when maxSize is exceeded", () => {
    const cache = new SchemaCache({ maxSize: 3 });
    cache.set("t1", makeDef("t1"));
    cache.set("t2", makeDef("t2"));
    cache.set("t3", makeDef("t3"));
    assert.equal(cache.size, 3);
    cache.set("t4", makeDef("t4"));
    assert.equal(cache.size, 3);
    assert.ok(!cache.has("t1"));
    assert.ok(cache.has("t4"));
  });

  it("supports getSize and maxSize", () => {
    const cache = new SchemaCache({ maxSize: 5 });
    assert.equal(cache.maxSize, 5);
    cache.set("a", makeDef("a"));
    cache.set("b", makeDef("b"));
    assert.equal(cache.size, 2);
  });
});
