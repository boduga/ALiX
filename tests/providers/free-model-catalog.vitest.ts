import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchFreeModelCatalog, _setCatalogFetchForTesting, _resetCatalogCacheForTesting } from "../../src/providers/free-model-catalog.js";

const sample = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => {
  _resetCatalogCacheForTesting();
  _setCatalogFetchForTesting(globalThis.fetch);
});

describe("fetchFreeModelCatalog", () => {
  it("filters to models where prompt AND request pricing are zero", async () => {
    _setCatalogFetchForTesting(async () => sample([
      { id: "a/free", name: "A Free", context_length: 32_000, pricing: { prompt: "0", completion: "0", request: "0", image: "0", web_search: "0" }, supported_parameters: { tools: true, structured_outputs: true, vision: false } },
      { id: "b/paid", name: "B Paid", context_length: 200_000, pricing: { prompt: "1.5", completion: "2", request: "1" }, supported_parameters: { tools: true, structured_outputs: true, vision: true } },
      { id: "c/free-request", name: "C", context_length: 8192, pricing: { prompt: "0", completion: "0", request: "0.1" }, supported_parameters: {} },
      { id: "d/zero-completion", name: "D", context_length: 4096, pricing: { prompt: "1", completion: "0", request: "0" }, supported_parameters: {} },
    ]));
    const catalog = await fetchFreeModelCatalog();
    expect(catalog.map((m) => m.id)).toEqual(["a/free"]);
  });

  it("maps capabilities and preserves unknown context length", async () => {
    _setCatalogFetchForTesting(async () => sample([
      { id: "a/free", name: "A Free", context_length: 32_000, pricing: { prompt: "0", request: "0" }, supported_parameters: { tools: true, structured_outputs: false, vision: true } },
      { id: "b/free", name: "B Free", pricing: { prompt: "0", request: "0" }, supported_parameters: {} },
    ]));
    const catalog = await fetchFreeModelCatalog();
    expect(catalog[0]).toEqual({
      id: "a/free",
      name: "A Free",
      inputTokenLimit: 32_000,
      supportsTools: true,
      supportsStructuredOutput: false,
      supportsVision: true,
    });
    expect(catalog[1]!.inputTokenLimit).toBeUndefined();
  });

  it("caches the catalog across calls (TTL)", async () => {
    const fetchFn = vi.fn(async () => sample([
      { id: "a/free", name: "A Free", pricing: { prompt: "0", request: "0" }, supported_parameters: {} },
    ]));
    _setCatalogFetchForTesting(fetchFn);
    await fetchFreeModelCatalog();
    await fetchFreeModelCatalog();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("propagates fetch failure when no cache exists", async () => {
    _setCatalogFetchForTesting(async () => { throw new Error("network down"); });
    await expect(fetchFreeModelCatalog()).rejects.toThrow("network down");
  });

  it("uses a non-expired cache after a fetch failure", async () => {
    _setCatalogFetchForTesting(async () => sample([
      { id: "a/free", name: "A Free", pricing: { prompt: "0", request: "0" }, supported_parameters: {} },
    ]));
    await fetchFreeModelCatalog();
    _setCatalogFetchForTesting(async () => { throw new Error("network down"); });
    const catalog = await fetchFreeModelCatalog();
    expect(catalog.map((m) => m.id)).toEqual(["a/free"]);
  });
});