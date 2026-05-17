import { describe, it, expect } from "vitest";
import { SchemaCache } from "../../src/mcp/tool-cache.js";
import type { ToolDef } from "../../src/providers/types.js";

function makeDef(name: string): ToolDef {
  return { name, description: "test", input_schema: { type: "object" as const, properties: {} } };
}

describe("SchemaCache TTL", () => {
  it("evicts entries after TTL expires", async () => {
    const cache = new SchemaCache({ ttlMs: 50 });
    cache.set("tool1", makeDef("tool1"));
    expect(cache.has("tool1")).toBe(true);
    await new Promise(r => setTimeout(r, 60));
    expect(cache.has("tool1")).toBe(false);
  });

  it("evicts oldest entries when maxSize is exceeded", () => {
    const cache = new SchemaCache({ maxSize: 3 });
    cache.set("t1", makeDef("t1"));
    cache.set("t2", makeDef("t2"));
    cache.set("t3", makeDef("t3"));
    expect(cache.size).toBe(3);
    cache.set("t4", makeDef("t4"));
    expect(cache.size).toBe(3);
    expect(cache.has("t1")).toBe(false);
    expect(cache.has("t4")).toBe(true);
  });

  it("supports getSize and maxSize", () => {
    const cache = new SchemaCache({ maxSize: 5 });
    expect(cache.maxSize).toBe(5);
    cache.set("a", makeDef("a"));
    cache.set("b", makeDef("b"));
    expect(cache.size).toBe(2);
  });
});
