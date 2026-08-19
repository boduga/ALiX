import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenRouterProvider } from "../../src/providers/openrouter-provider.js";
import { _setCatalogFetchForTesting, _resetCatalogCacheForTesting } from "../../src/providers/free-model-catalog.js";
import { _setFetchForTesting } from "../../src/providers/unified-complete.js";

const catalog = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

const req = { systemPrompt: "s", messages: [{ role: "user" as const, content: "hi" }] };

afterEach(() => {
  _resetCatalogCacheForTesting();
  _setCatalogFetchForTesting(globalThis.fetch);
  _setFetchForTesting(globalThis.fetch);
});

describe("openrouter/free route", () => {
  it("resolves a concrete free model per request and completes through it", async () => {
    _setCatalogFetchForTesting(async () => catalog([
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: true } },
    ]));
    let requestedModel: string | undefined;
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      requestedModel = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model;
      return new Response(JSON.stringify({ model: requestedModel, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    const res = await provider.complete(req);
    expect(requestedModel).toBe("qwen/qwen3-14b:free");
    expect(res.resolvedModel).toBe("qwen/qwen3-14b:free");
  });

  it("resolves per request — never globally cached", async () => {
    let catalogFetchCount = 0;
    _setCatalogFetchForTesting(async () => {
      catalogFetchCount++;
      return catalog([
        { id: "a/free", name: "A", context_length: 8_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
        { id: "b/free", name: "B", context_length: 64_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      ]);
    });
    let requested: string[] = [];
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      requested.push((JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "");
      return new Response(JSON.stringify({ model: "x", choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    // First request resolves b (largest context); second request re-resolves
    // from the cached catalog and must again pick b deterministically.
    await provider.complete(req);
    await provider.complete(req);
    expect(requested).toEqual(["b/free", "b/free"]);
    expect(catalogFetchCount).toBe(1); // catalog cached, selection re-run
  });

  it("throws a clear error when no free model satisfies the request", async () => {
    _setCatalogFetchForTesting(async () => catalog([
      { id: "a/free", name: "A", context_length: 8_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: false } },
    ]));
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    await expect(provider.complete({ ...req, tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] }))
      .rejects.toThrow("No OpenRouter free model satisfies the request requirements");
  });

  it("always resolves to a tools-capable model, even for plain requests", async () => {
    _setCatalogFetchForTesting(async () => catalog([
      { id: "big/no-tools", name: "Big", context_length: 128_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: [] },
      { id: "small/with-tools", name: "Small", context_length: 16_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    let requestedModel: string | undefined;
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      requestedModel = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model;
      return new Response(JSON.stringify({ model: requestedModel, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    // Plain request (no tools) must still skip the no-tools model and pick
    // the tools-capable one — the agent always needs tool calling.
    await provider.complete(req);
    expect(requestedModel).toBe("small/with-tools");
  });

  it("leaves non-free models untouched", async () => {
    let requestedModel: string | undefined;
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      requestedModel = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model;
      return new Response(JSON.stringify({ model: requestedModel, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openai/gpt-4o" });
    await provider.complete(req);
    expect(requestedModel).toBe("openai/gpt-4o");
  });

  it("resolves per request in the streaming path", async () => {
    _setCatalogFetchForTesting(async () => catalog([
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: true } },
    ]));
    let requestedModel: string | undefined;
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      requestedModel = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model;
      const lines = [
        `data: {"id":"x","model":"${requestedModel}","choices":[{"delta":{"content":"hi"}}]}`,
        `data: {"id":"x","model":"${requestedModel}","choices":[{"delta":{},"finish_reason":"stop"}]}`,
        "data: [DONE]",
      ];
      return new Response(lines.join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });

    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    const chunks = [];
    for await (const c of provider.stream(req)) chunks.push(c);
    expect(requestedModel).toBe("qwen/qwen3-14b:free");
    const done = chunks.find((c) => c.type === "done");
    expect(done).toEqual({ type: "done", resolvedModel: "qwen/qwen3-14b:free" });
  });
});