import { describe, it } from "node:test";
import assert from "node:assert";
import { MetaToolExecutor, type MetaToolCommand } from "../../src/mcp/meta-tool.js";

describe("MetaToolExecutor", () => {
  it("executes catalog.list command", async () => {
    const executor = new MetaToolExecutor({
      catalog: { listCategories: () => ["file", "shell"], byCategory: () => [] } as any,
    });

    const result = await executor.execute({
      command: "catalog.list",
      args: {},
    });

    assert.ok(result.includes("file"));
    assert.ok(result.includes("shell"));
  });

  it("executes tools.search command", async () => {
    const executor = new MetaToolExecutor({
      discovery: { search: async (q: string) => ({ kind: "success", output: `Found: ${q}` }) } as any,
    });

    const result = await executor.execute({
      command: "tools.search",
      args: { query: "file" },
    });

    assert.ok(result.includes("file"));
  });

  it("rejects unknown commands", async () => {
    const executor = new MetaToolExecutor({} as any);

    try {
      await executor.execute({
        command: "unknown.command" as any,
        args: {},
      });
      assert.fail("Should have thrown");
    } catch (e) {
      assert.ok(e instanceof Error);
      assert.ok(e.message.includes("Unknown meta-tool command"));
    }
  });
});