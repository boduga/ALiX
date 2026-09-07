import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenRouterProvider, ProviderAccessError } from "../../src/providers/openrouter-provider.js";
import { _setOpenRouterDiscoveryFetch, _resetOpenRouterDiscoveryCache } from "../../src/providers/model-discovery.js";
import { _setAccessRestrictionTtlForTesting, _resetAccessRestrictionRegistryForTesting } from "../../src/providers/access-restriction-registry.js";
import { _setFetchForTesting } from "../../src/providers/unified-complete.js";

const catalog = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

const req = { systemPrompt: "s", messages: [{ role: "user" as const, content: "hi" }] };

afterEach(() => {
  _resetOpenRouterDiscoveryCache();
  _resetAccessRestrictionRegistryForTesting();
  _setOpenRouterDiscoveryFetch(globalThis.fetch);
  _setFetchForTesting(globalThis.fetch);
});

describe("openrouter/free route", () => {
  it("resolves a concrete free model per request and completes through it", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalog([
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
    _setOpenRouterDiscoveryFetch(async () => {
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

  it("never selects a paid model on the free route", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalog([
      { id: "paid/big", name: "PaidBig", context_length: 200_000, pricing: { prompt: "0.000002", completion: "0.000006" }, supported_parameters: ["tools"] },
      { id: "free/small", name: "FreeSmall", context_length: 8_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    let requestedModel: string | undefined;
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      requestedModel = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model;
      return new Response(JSON.stringify({ model: requestedModel, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    // The paid model is the largest-context candidate, so without the
    // costPerMTokIn === 0 pre-filter (openrouter-provider.ts resolveConcreteModel)
    // it would win. Assert the free route skips it entirely.
    await provider.complete(req);
    expect(requestedModel).toBe("free/small");
  });

  it("throws a clear error when no free model satisfies the request", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalog([
      { id: "a/free", name: "A", context_length: 8_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: false } },
    ]));
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    await expect(provider.complete({ ...req, tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] }))
      .rejects.toThrow("No OpenRouter free model satisfies the request requirements");
  });

  it("always resolves to a tools-capable model, even for plain requests", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalog([
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

  it("sends a concretely pinned :free model directly — no re-resolution (complete)", async () => {
    // set-default pins use concrete :free ids; they must NOT be re-resolved to
    // the largest-context free candidate.
    let discoveryCalled = false;
    _setOpenRouterDiscoveryFetch(async () => {
      discoveryCalled = true;
      return catalog([
        { id: "minimax/minimax-m3:free", name: "M3", context_length: 1_000_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: true } },
        { id: "z-ai/glm-5.2:free", name: "Glm", context_length: 64_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: true } },
      ]);
    });
    let requestedModel: string | undefined;
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      requestedModel = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model;
      return new Response(JSON.stringify({ model: requestedModel, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const provider = new OpenRouterProvider({ apiKey: "k", model: "z-ai/glm-5.2:free" });
    const res = await provider.complete(req);
    expect(requestedModel).toBe("z-ai/glm-5.2:free");
    expect(res.resolvedModel).toBe("z-ai/glm-5.2:free");
    expect(discoveryCalled).toBe(false);
  });

  it("sends a concretely pinned :free model directly — no re-resolution (stream)", async () => {
    let discoveryCalled = false;
    _setOpenRouterDiscoveryFetch(async () => {
      discoveryCalled = true;
      return catalog([
        { id: "minimax/minimax-m3:free", name: "M3", context_length: 1_000_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: true } },
      ]);
    });
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

    const provider = new OpenRouterProvider({ apiKey: "k", model: "z-ai/glm-5.2:free" });
    const chunks = [];
    for await (const c of provider.stream(req)) chunks.push(c);
    expect(requestedModel).toBe("z-ai/glm-5.2:free");
    expect(discoveryCalled).toBe(false);
    const done = chunks.find((c) => c.type === "done");
    expect(done).toEqual({ type: "done", resolvedModel: "z-ai/glm-5.2:free", finishReason: "stop" });
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
    _setOpenRouterDiscoveryFetch(async () => catalog([
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
    expect(done).toEqual({ type: "done", resolvedModel: "qwen/qwen3-14b:free", finishReason: "stop" });
  });

  it("retries with a different free model on account-rejection (404 allowed-providers) — complete", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalog([
      { id: "stealth/ox-alpha", name: "Stealth", context_length: 200_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    const requested: string[] = [];
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      const m = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "";
      requested.push(m);
      if (m === "stealth/ox-alpha") {
        return new Response(JSON.stringify({ error: { message: "No allowed providers are available for the selected model. Providers serving stealth/ox-alpha: stealth, but your account's allowed-providers setting permits only: openai, deepseek" } }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ model: m, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    const res = await provider.complete(req);
    expect(requested).toEqual(["stealth/ox-alpha", "qwen/qwen3-14b:free"]);
    expect(res.resolvedModel).toBe("qwen/qwen3-14b:free");
  });

  it("retries with a different free model on account-rejection in streaming", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalog([
      { id: "stealth/ox-alpha", name: "Stealth", context_length: 200_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    const requested: string[] = [];
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      const m = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "";
      requested.push(m);
      if (m === "stealth/ox-alpha") {
        return new Response(JSON.stringify({ error: { message: "No allowed providers are available for the selected model." } }), { status: 404, headers: { "Content-Type": "application/json" } });
      }
      const lines = [
        `data: {"id":"x","model":"${m}","choices":[{"delta":{"content":"hi"}}]}`,
        `data: {"id":"x","model":"${m}","choices":[{"delta":{},"finish_reason":"stop"}]}`,
        "data: [DONE]",
      ];
      return new Response(lines.join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });
    const chunks = [];
    for await (const c of provider.stream(req)) chunks.push(c);
    expect(requested).toEqual(["stealth/ox-alpha", "qwen/qwen3-14b:free"]);
    const done = chunks.find((c) => c.type === "done");
    expect(done).toEqual({ type: "done", resolvedModel: "qwen/qwen3-14b:free", finishReason: "stop" });
  });

  it("throws ProviderAccessError on a harness-restricted 403, and excludes the model on the next request", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalog([
      { id: "thinkingmachines/inkling-small:free", name: "Inkling", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 16_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    const requested: string[] = [];
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      const m = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "";
      requested.push(m);
      if (m === "thinkingmachines/inkling-small:free") {
        return new Response(JSON.stringify({ error: { message: "thinkingmachines/inkling-small:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps" } }), { status: 403, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ model: m, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });

    // Request 1: largest-context model (inkling) is selected and refused.
    await expect(provider.complete(req)).rejects.toBeInstanceOf(ProviderAccessError);

    // Request 2: inkling is access-restricted (bounded lifetime), so the
    // resolver falls through to the next eligible free model.
    const res = await provider.complete(req);
    expect(requested[1]).toBe("qwen/qwen3-14b:free");
    expect(res.resolvedModel).toBe("qwen/qwen3-14b:free");
  });

  it("revalidates an access-restricted model after the TTL expires", async () => {
    _setAccessRestrictionTtlForTesting(20);
    _setOpenRouterDiscoveryFetch(async () => catalog([
      { id: "thinkingmachines/inkling-small:free", name: "Inkling", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 16_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    let requestCount = 0;
    const requested: string[] = [];
    _setFetchForTesting(async (_url: string | Request | URL, init?: RequestInit) => {
      const m = (JSON.parse(String(init?.body ?? "{}")) as { model?: string }).model ?? "";
      requested.push(m);
      requestCount++;
      if (m === "thinkingmachines/inkling-small:free") {
        return new Response(JSON.stringify({ error: { message: "thinkingmachines/inkling-small:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity app listed on https://openrouter.ai/apps" } }), { status: 403, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ model: m, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const provider = new OpenRouterProvider({ apiKey: "k", model: "openrouter/free" });

    // Request 1: inkling refused → recorded access-restricted for TTL=20ms.
    await expect(provider.complete(req)).rejects.toBeInstanceOf(ProviderAccessError);
    // Request 2 (within TTL): inkling excluded → qwen selected.
    await provider.complete(req);
    expect(requested[requestCount - 1]).toBe("qwen/qwen3-14b:free");

    // Wait past the TTL: inkling is revalidated (no longer excluded) and, as
    // the largest-context model, is selected again — the restriction was not
    // permanent. The mock refuses it again, so the request throws, but that the
    // resolver ATTEMPTED inkling proves the restriction expired.
    await new Promise((r) => setTimeout(r, 30));
    await expect(provider.complete(req)).rejects.toBeInstanceOf(ProviderAccessError);
    expect(requested[requestCount - 1]).toBe("thinkingmachines/inkling-small:free");
  });
});