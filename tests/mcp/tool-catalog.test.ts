import { describe, it } from "node:test";
import assert from "node:assert";
import { ToolCatalog, type ToolCategory, type TrustLevel } from "../../src/mcp/tool-catalog.js";

describe("ToolCatalog", () => {
  it("groups tools by category", () => {
    const catalog = new ToolCatalog();
    catalog.register({
      name: "file.read",
      description: "Read a file",
      serverName: "filesystem",
      category: "file",
      capabilities: ["file.read"],
      trustLevel: "builtin",
    } as any);

    catalog.register({
      name: "shell.run",
      description: "Run a shell command",
      serverName: "shell",
      category: "shell",
      capabilities: ["shell.run"],
      trustLevel: "builtin",
    } as any);

    const categories = catalog.listCategories();
    assert.ok(categories.includes("file"));
    assert.ok(categories.includes("shell"));
  });

  it("filters by category", () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: "file.read", serverName: "fs", category: "file" } as any);
    catalog.register({ name: "shell.run", serverName: "sh", category: "shell" } as any);

    const fileTools = catalog.byCategory("file");
    assert.equal(fileTools.length, 1);
  });

  it("filters by trust level", () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: "builtin_tool", serverName: "core", trustLevel: "builtin" } as any);
    catalog.register({ name: "remote_tool", serverName: "remote", trustLevel: "remote" } as any);

    const trusted = catalog.byTrustLevel("builtin");
    assert.equal(trusted.length, 1);
  });

  it("lists all tool names", () => {
    const catalog = new ToolCatalog();
    catalog.register({ name: "file.read", serverName: "fs", category: "file" } as any);
    catalog.register({ name: "file.write", serverName: "fs", category: "file" } as any);

    const names = catalog.listToolNames();
    assert.ok(names.includes("file.read"));
    assert.ok(names.includes("file.write"));
  });
});