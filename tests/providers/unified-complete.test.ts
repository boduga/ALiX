import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { complete, _setFetchForTesting } from "../../src/providers/unified-complete.js";
import { makeMockFetch } from "./helpers/mock-fetch.js";
import { ApiError } from "../../src/providers/base.js";

describe("unified-complete", () => {
  it("calls the right spec for provider 'openai'", async () => {
    const mock = makeMockFetch([{
      status: 200,
      body: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] },
    }]);
    _setFetchForTesting(mock.fetch as any);

    const resp = await complete("openai", "gpt-4o", { systemPrompt: "", messages: [] });
    assert.equal(resp.text, "hi");
    assert.equal(mock.calls[0].url, "https://api.openai.com/v1/chat/completions");
  });

  it("uses Anthropic's x-api-key for provider 'anthropic'", async () => {
    const mock = makeMockFetch([{ status: 200, body: { content: [{ type: "text", text: "x" }] } }]);
    _setFetchForTesting(mock.fetch as any);

    await complete("anthropic", "claude-opus-4-8", { systemPrompt: "", messages: [] }, { apiKey: "ant-123" });
    const headers = mock.calls[0].init.headers as Record<string, string>;
    assert.equal(headers["x-api-key"], "ant-123");
  });

  it("throws ApiError on non-retryable 4xx", async () => {
    const mock = makeMockFetch([{ status: 400, body: { error: { message: "bad" } } }]);
    _setFetchForTesting(mock.fetch as any);

    await assert.rejects(
      () => complete("openai", "gpt-4o", { systemPrompt: "", messages: [] }),
      (err: ApiError) => err.status === 400 && err.detail.includes("bad")
    );
  });

  it("retries on 429 and eventually succeeds", async () => {
    const mock = makeMockFetch([
      { status: 429, body: { error: { message: "rate limit" } } },
      { status: 200, body: { choices: [{ message: { content: "ok" } }] } },
    ]);
    _setFetchForTesting(mock.fetch as any);

    const resp = await complete("openai", "gpt-4o", { systemPrompt: "", messages: [] });
    assert.equal(resp.text, "ok");
    assert.equal(mock.calls.length, 2);
  });

  it("throws when provider is unknown", async () => {
    await assert.rejects(
      () => complete("nonexistent", "x", { systemPrompt: "", messages: [] }),
      /Unknown provider/
    );
  });
});