import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { webFetchTool } from "../../src/tools/web-fetch.js";

describe("webFetchTool", () => {
  const publicOptions = { resolveHost: async () => ["93.184.216.34"] };
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns a tool definition", () => {
    const tool = webFetchTool(publicOptions);
    assert.equal(tool.name, "web_fetch");
    assert.ok(tool.description);
  });

  it("fetches URL and returns text content", async () => {
    globalThis.fetch = (async (url) => {
      assert.ok(String(url).startsWith("https://"));
      return new Response("Hello world content", { status: 200 });
    }) as typeof fetch;

    const tool = webFetchTool(publicOptions);
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

    const tool = webFetchTool(publicOptions);
    const result = await tool.execute({ url: "https://example.com" });
    assert.equal((result.data as any).content.trim(), "Title Paragraph text");
  });

  it("respects maxLength", async () => {
    globalThis.fetch = (async () => {
      return new Response("a".repeat(1000), { status: 200 });
    }) as typeof fetch;

    const tool = webFetchTool(publicOptions);
    const result = await tool.execute({ url: "https://example.com", maxLength: 100 });
    const content = (result.data as any).content as string;
    assert.ok(content.length <= 100);
  });

  it("validates URL scheme", async () => {
    const tool = webFetchTool(publicOptions);
    const result = await tool.execute({ url: "ftp://example.com" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("http"));
  });

  it("blocks loopback and private-network destinations before fetch", async () => {
    let fetched = false;
    globalThis.fetch = (async () => { fetched = true; return new Response("no"); }) as typeof fetch;
    for (const url of ["http://127.0.0.1/admin", "http://localhost/admin", "http://169.254.169.254/latest/meta-data/"]) {
      const result = await webFetchTool().execute({ url });
      assert.equal(result.ok, false);
      assert.match(result.error ?? "", /Private network/);
    }
    assert.equal(fetched, false);
  });

  it("enforces configured domain allowlist", async () => {
    const result = await webFetchTool({ allowDomains: ["allowed.example"] }).execute({ url: "https://example.com" });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /not allowed/);
  });

  it("returns error on 404", async () => {
    globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
    const tool = webFetchTool(publicOptions);
    const result = await tool.execute({ url: "https://example.com/missing" });
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes("404"));
  });
});
