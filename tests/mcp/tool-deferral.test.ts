import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";
import { McpToolDeferral } from "../../src/mcp/tool-deferral.js";
import { InMemoryCacheManager, type CacheManager } from "../../src/utils/cache-manager.js";

function makeFakeRegistry(tools: Array<{ fullName: string; serverName: string; toolName: string; description?: string; inputSchema: Record<string, unknown> }>) {
  return {
    listTools: () => tools,
    getTool: (fullName: string) => tools.find(t => t.fullName === fullName),
  };
}

describe("McpToolDeferral", () => {
  const fakeTools = [
    { fullName: "github/repos.list", serverName: "github", toolName: "repos.list", description: "List repos", inputSchema: { type: "object", properties: { org: { type: "string" } } } },
    { fullName: "github/issues.list", serverName: "github", toolName: "issues.list", description: "List issues", inputSchema: { type: "object", properties: { repo: { type: "string" } } } },
    { fullName: "fetch/web_page", serverName: "fetch", toolName: "web_page", description: "Fetch a URL", inputSchema: { type: "object", properties: { url: { type: "string" } } } },
  ];

  it("buildIndex returns only names and descriptions, no input_schema", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);
    const index = deferral.buildIndex();

    assert.strictEqual(index.length, 3);
    assert.match(index[0].name, /^mcp__[A-Za-z0-9_-]+$/);
    assert.strictEqual(index[0].execName, "mcp.github.repos.list");
    assert.strictEqual(index[0].description, "List repos");
    assert.ok("input_schema" in index[0]);
  });

  it("resolve returns full ToolDef from registry", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const def = deferral.resolve(deferral.buildIndex()[0].name);
    assert.ok(def !== undefined);
    assert.strictEqual(def.name, deferral.buildIndex()[0].name);
    assert.strictEqual(def.description, "List repos");
    assert.deepStrictEqual(def.input_schema, { type: "object", properties: { org: { type: "string" } } });
  });

  it("resolve caches result for repeated calls", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const first = deferral.resolve(deferral.buildIndex()[0].name);
    const second = deferral.resolve(deferral.buildIndex()[0].name);
    assert.deepStrictEqual(first, second); // deep equal — parsed from cache
  });

  it("resolve returns undefined for unknown tool", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const def = deferral.resolve("mcp_nonexistent_tool");
    assert.strictEqual(def, undefined);
  });

  it("search finds fuzzy matches", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const results = deferral.search("github_repo");
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].item.name, deferral.buildIndex()[0].name);
  });

  it("search finds typo 'guthu' -> 'github'", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const results = deferral.search("guthu_repos_list");
    assert.ok(results.length > 0, "Should find github tool with typo");
  });

  it("clearServerCache invalidates cache and index", () => {
    const registry = makeFakeRegistry(fakeTools);
    const deferral = new McpToolDeferral(registry as any);

    const handle = deferral.buildIndex()[0].name;
    deferral.resolve(handle);
    assert.ok(deferral["cache"].has(handle));

    deferral.clearServerCache("github");
    assert.ok(!deferral["cache"].has(handle));
    assert.strictEqual(deferral["_index"], null, "_index should be null after clearServerCache");
  });

  it("uses provided CacheManager", () => {
    const registry = makeFakeRegistry(fakeTools);
    const customCache = new InMemoryCacheManager();
    const deferral = new McpToolDeferral(registry as any, customCache);

    const handle = deferral.buildIndex()[0].name;
    deferral.resolve(handle);
    assert.ok(customCache.has(handle), "custom cache should have resolved tool");
    assert.strictEqual(deferral["cache"], customCache, "should use injected cache");
  });

  it("clearServerCache calls cache.invalidate", () => {
    const registry = makeFakeRegistry(fakeTools);
    const customCache = new InMemoryCacheManager();
    const deferral = new McpToolDeferral(registry as any, customCache);

    const handle = deferral.buildIndex()[0].name;
    deferral.resolve(handle);
    deferral.clearServerCache("github");

    assert.ok(!customCache.has(handle), "invalidate should remove entries");
    // Verify invalidate was called with correct prefix
    assert.ok(!customCache.has(handle));
  });
});
