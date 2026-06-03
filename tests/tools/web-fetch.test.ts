import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { webFetchTool } from "../../src/tools/web-fetch.js";

describe("webFetchTool", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a tool definition", () => {
    const tool = webFetchTool();
    assert.equal(tool.name, "web_fetch");
    assert.ok(tool.description);
  });

  it("fetches URL and returns text content", async () => {
    globalThis.fetch = (async (url) => {
      assert.ok(String(url).startsWith("https://"));
      return new Response("Hello world content", { status: 200 });
    }) as typeof fetch;

    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal(result.ok, true);
    assert.equal((result.data as any).content, "Hello world content");
  });

  it("strips HTML tags", async () => {
    const html = "<html><body><h1>Title</h1><p>Paragraph text</p></body></html>";
    globalThis.fetch = (async () => {
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as typeof fetch;

    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal((result.data as any).content.trim(), "Title Paragraph text");
  });

  it("respects maxLength", async () => {
    globalThis.fetch = (async () => {
      return new Response("a".repeat(1000), { status: 200 });
    }) as typeof fetch;

    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com", maxLength: 100 });
    const content = (result.data as any).content as string;
    assert.ok(content.length <= 100);
  });

  it("validates URL scheme", async () => {
    const tool = webFetchTool();
    const result = await tool.execute({ url: "ftp://example.com" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("http"));
  });

  it("returns error on 404", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    const tool = webFetchTool();
    const result = await tool.execute({ url: "https://example.com/missing" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("404"));
  });
});