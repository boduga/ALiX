import { describe, it, expect, vi, afterEach } from "vitest";
import { discoverOpenRouterModels, _setOpenRouterDiscoveryFetch, _resetOpenRouterDiscoveryCache } from "../../src/providers/model-discovery.js";

const sample = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => {
  _resetOpenRouterDiscoveryCache();
  _setOpenRouterDiscoveryFetch(globalThis.fetch);
});

describe("discoverOpenRouterModels", () => {
  it("filters to models where prompt AND completion pricing are zero", async () => {
    _setOpenRouterDiscoveryFetch(async () => sample([
      { id: "a/free", name: "A Free", context_length: 32_000, pricing: { prompt: "0", completion: "0", image: "0", web_search: "0" }, supported_parameters: { tools: true, structured_outputs: true, vision: false } },
      { id: "b/paid", name: "B Paid", context_length: 200_000, pricing: { prompt: "1.5", completion: "2", image: "1" }, supported_parameters: { tools: true, structured_outputs: true, vision: true } },
      { id: "c/free-request", name: "C", context_length: 8192, pricing: { prompt: "0", completion: "0" }, supported_parameters: {} },
      { id: "d/zero-completion", name: "D", context_length: 4096, pricing: { prompt: "1", completion: "0" }, supported_parameters: {} },
      { id: "e/no-pricing", name: "E", context_length: 4096, pricing: {}, supported_parameters: {} },
    ]));
    const catalog = await discoverOpenRouterModels();
    expect(catalog.map((m) => m.id)).toEqual(["a/free", "c/free-request"]);
  });

  it("maps capabilities and preserves unknown context length", async () => {
    _setOpenRouterDiscoveryFetch(async () => sample([
      { id: "a/free", name: "A Free", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: { tools: true, structured_outputs: false, vision: true } },
      { id: "b/free", name: "B Free", pricing: { prompt: "0", completion: "0" }, supported_parameters: {} },
    ]));
    const catalog = await discoverOpenRouterModels();
    expect(catalog[0]).toEqual({
      id: "a/free",
      name: "A Free",
      inputTokenLimit: 32_000,
      supportsTools: true,
      supportsStructuredOutput: false,
      supportsVision: true,
    });
    expect(catalog[1]!.inputContextLimit).toBeUndefined();
  });

  it("parses supported_parameters in OpenRouter array form", async () => {
    _setOpenRouterDiscoveryFetch(async () => sample([
      { id: "a/free", name: "A", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools", "structured_outputs"] },
      { id: "b/free", name: "B", context_length: 8192, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["temperature"] },
    ]));
    const catalog = await discoverOpenRouterModels();
    expect(catalog[0]!.supportsTools).toBe(true);
    expect(catalog[0]!.supportsStructuredOutput).toBe(true);
    expect(catalog[0]!.supportsVision).toBe(false);
    expect(catalog[1]!.supportsTools).toBe(false);
  });

  it("caches the catalog across calls (TTL)", async () => {
    const fetchFn = vi.fn(async () => sample([
      { id: "a/free", name: "A Free", pricing: { prompt: "0", completion: "0" }, supported_parameters: {} },
    ]));
    _setOpenRouterDiscoveryFetch(fetchFn);
    await discoverOpenRouterModels();
    await discoverOpenRouterModels();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("propagates fetch failure when no cache exists", async () => {
    _setOpenRouterDiscoveryFetch(async () => { throw new Error("network down"); });
    await expect(discoverOpenRouterModels()).rejects.toThrow("network down");
  });

  it("uses a non-expired cache after a fetch failure", async () => {
    _setOpenRouterDiscoveryFetch(async () => sample([
      { id: "a/free", name: "A Free", pricing: { prompt: "0", completion: "0" }, supported_parameters: {} },
    ]));
    await discoverOpenRouterModels();
    _setOpenRouterDiscoveryFetch(async () => { throw new Error("network down"); });
    const catalog = await discoverOpenRouterModels();
    expect(catalog.map((m) => m.id)).toEqual(["a/free"]);
  });
});