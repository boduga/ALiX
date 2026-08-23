import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webSearchTool } from "../../src/tools/web-search.js";
import { _setUserConfigPathOverride } from "../../src/cli/helpers/api-keys.js";

describe("webSearchTool", () => {
  let tmpDir: string;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    tmpDir = mkdtempSync(join(tmpdir(), "alix-ws-test-"));
    // Store-only: the Brave key is supplied via user-config (a literal key is
    // returned directly by getSavedApiKey), never via a BRAVE_API_KEY env var.
    _setUserConfigPathOverride(join(tmpDir, "missing.json"));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _setUserConfigPathOverride(undefined);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setBraveKey(key: string) {
    const path = join(tmpDir, "config.json");
    writeFileSync(path, JSON.stringify({ apiKeys: { brave: key } }));
    _setUserConfigPathOverride(path);
  }

  it("returns a tool definition", () => {
    const tool = webSearchTool();
    assert.equal(tool.name, "web_search");
    assert.ok(tool.description);
    assert.ok(tool.input_schema);
  });

  it("returns top results from Brave API", async () => {
    setBraveKey("test-key");
    const mockResults = {
      web: {
        results: [
          { title: "First", url: "https://example.com/1", description: "First result" },
          { title: "Second", url: "https://example.com/2", description: "Second result" },
        ],
      },
    };
    globalThis.fetch = (async (url, init) => {
      assert.ok(String(url).includes("api.search.brave.com"));
      assert.ok(String(url).includes("q=hello"));
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["X-Subscription-Token"], "test-key");
      return new Response(JSON.stringify(mockResults), { status: 200 });
    }) as typeof fetch;

    const tool = webSearchTool();
    const result = await tool.execute({ query: "hello" });
    assert.equal(result.ok, true);
    assert.equal((result.data as any).results.length, 2);
    assert.equal((result.data as any).results[0].title, "First");
  });

  it("respects count parameter", async () => {
    setBraveKey("test-key");
    let capturedUrl = "";
    globalThis.fetch = (async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }) as typeof fetch;

    const tool = webSearchTool();
    await tool.execute({ query: "test", count: 10 });
    assert.ok(capturedUrl.includes("count=10"));
  });

  it("returns error when API key missing", async () => {
    const tool = webSearchTool();
    const result = await tool.execute({ query: "test" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("credential"));
    assert.ok(!String(result.error).includes("BRAVE_API_KEY"));
  });

  it("returns error on API failure", async () => {
    setBraveKey("test-key");
    globalThis.fetch = (async () => {
      return new Response("rate limited", { status: 429 });
    }) as typeof fetch;

    const tool = webSearchTool();
    const result = await tool.execute({ query: "test" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("429"));
  });

  it("URL-encodes the query", async () => {
    setBraveKey("test-key");
    let capturedUrl = "";
    globalThis.fetch = (async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }) as typeof fetch;

    const tool = webSearchTool();
    await tool.execute({ query: "hello world & special chars?" });
    assert.ok(capturedUrl.includes("hello%20world"));
  });
});
