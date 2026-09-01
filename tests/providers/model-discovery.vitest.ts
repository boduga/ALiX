import {
  describe,
  it,
  expect,
  afterEach,
  vi,
} from "vitest";

import {
  discoverOpenRouterModels,
  _setOpenRouterDiscoveryFetch,
  _resetOpenRouterDiscoveryCache,
  _expireOpenRouterDiscoveryCacheForTesting,
} from "../../src/providers/model-discovery.js";

const catalog = (models: unknown[]) =>
  new Response(
    JSON.stringify({ data: models }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

afterEach(() => {
  _resetOpenRouterDiscoveryCache();
  _setOpenRouterDiscoveryFetch(globalThis.fetch);
});

describe("discoverOpenRouterModels", () => {
  it("keeps free AND paid models with normalized cost + capabilities", async () => {
    _setOpenRouterDiscoveryFetch(async () =>
      catalog([
        {
          id: "a/free:free",
          name: "A",
          context_length: 8_000,
          pricing: {
            prompt: "0",
            completion: "0",
          },
          supported_parameters: ["tools"],
        },
        {
          id: "b/paid",
          name: "B",
          context_length: 200_000,
          pricing: {
            prompt: "0.0000025",
            completion: "0.00001",
          },
          supported_parameters: [
            "tools",
            "vision",
          ],
        },
      ]),
    );

    const models = await discoverOpenRouterModels();

    const free = models.find(
      (m) => m.id === "a/free:free",
    )!;

    const paid = models.find(
      (m) => m.id === "b/paid",
    )!;

    expect(free.costPerMTokIn).toBe(0);
    expect(free.supportsTools).toBe(true);

    expect(paid.costPerMTokIn).toBe(2.5);
    expect(paid.inputContextLimit).toBe(200_000);
    expect(paid.supportsTools).toBe(true);
    expect(paid.supportsVision).toBe(true);
    expect(paid.supportsStructuredOutput).toBe(false);
  });

  it("passes the supplied apiKey to OpenRouter discovery", async () => {
    let authorization: string | undefined;

    _setOpenRouterDiscoveryFetch(async (_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? undefined;

      return catalog([]);
    });

    await discoverOpenRouterModels({
      apiKey: "store-key",
    });

    expect(authorization).toBe("Bearer store-key");
  });

  it("does not require an apiKey for public catalog discovery", async () => {
    let authorization: string | undefined;

    _setOpenRouterDiscoveryFetch(async (_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? undefined;

      return catalog([]);
    });

    await discoverOpenRouterModels();

    expect(authorization).toBeUndefined();
  });

  it("rejects a failed catalog request", async () => {
    _setOpenRouterDiscoveryFetch(async () =>
      new Response("failure", {
        status: 503,
      }),
    );

    await expect(
      discoverOpenRouterModels(),
    ).rejects.toThrow(
      "OpenRouter catalog request failed: 503",
    );
  });

  it("maps capabilities and preserves unknown context length", async () => {
    _setOpenRouterDiscoveryFetch(async () =>
      catalog([
        {
          id: "a/free",
          name: "A Free",
          context_length: 32_000,
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: {
            tools: true,
            structured_outputs: false,
            vision: true,
          },
        },
        {
          id: "b/free",
          name: "B Free",
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: {},
        },
      ]),
    );

    const models = await discoverOpenRouterModels();
    const free = models.find((m) => m.id === "a/free")!;
    expect(free).toEqual({
      id: "a/free",
      provider: "openrouter",
      inputContextLimit: 32_000,
      costPerMTokIn: 0,
      supportsTools: true,
      supportsStructuredOutput: false,
      supportsVision: true,
    });

    const noCtx = models.find((m) => m.id === "b/free")!;
    expect(noCtx.inputContextLimit).toBeUndefined();
    expect(noCtx.costPerMTokIn).toBe(0);
  });

  it("parses supported_parameters in OpenRouter array form", async () => {
    _setOpenRouterDiscoveryFetch(async () =>
      catalog([
        {
          id: "a/free",
          name: "A",
          context_length: 32_000,
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: [
            "tools",
            "structured_outputs",
          ],
        },
        {
          id: "b/free",
          name: "B",
          context_length: 8192,
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: ["temperature"],
        },
      ]),
    );

    const models = await discoverOpenRouterModels();
    const a = models.find((m) => m.id === "a/free")!;
    const b = models.find((m) => m.id === "b/free")!;
    expect(a.supportsTools).toBe(true);
    expect(a.supportsStructuredOutput).toBe(true);
    expect(a.supportsVision).toBe(false);
    expect(b.supportsTools).toBe(false);
  });

  it("caches the catalog across calls (TTL)", async () => {
    const fetchFn = vi.fn(async () =>
      catalog([
        {
          id: "a/free",
          name: "A Free",
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: {},
        },
      ]),
    );
    _setOpenRouterDiscoveryFetch(fetchFn);
    await discoverOpenRouterModels();
    await discoverOpenRouterModels();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("propagates fetch failure when no cache exists", async () => {
    _setOpenRouterDiscoveryFetch(async () => {
      throw new Error("network down");
    });
    await expect(
      discoverOpenRouterModels(),
    ).rejects.toThrow("network down");
  });

  it("uses a non-expired cache after a fetch failure", async () => {
    _setOpenRouterDiscoveryFetch(async () =>
      catalog([
        {
          id: "a/free",
          name: "A Free",
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: {},
        },
      ]),
    );
    await discoverOpenRouterModels();
    _setOpenRouterDiscoveryFetch(async () => {
      throw new Error("network down");
    });
    const models = await discoverOpenRouterModels();
    expect(models.map((m) => m.id)).toEqual(["a/free"]);
  });

  it("serves stale cache when a refetch fails after the TTL", async () => {
    _setOpenRouterDiscoveryFetch(async () =>
      catalog([
        {
          id: "a/free",
          name: "A Free",
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: {},
        },
      ]),
    );
    await discoverOpenRouterModels();
    _expireOpenRouterDiscoveryCacheForTesting();
    _setOpenRouterDiscoveryFetch(async () => {
      throw new Error("network down");
    });
    const models = await discoverOpenRouterModels();
    expect(models.map((m) => m.id)).toEqual(["a/free"]);
  });

  it("serves stale cache when a refetch returns non-ok after the TTL", async () => {
    _setOpenRouterDiscoveryFetch(async () =>
      catalog([
        {
          id: "a/free",
          name: "A Free",
          pricing: { prompt: "0", completion: "0" },
          supported_parameters: {},
        },
      ]),
    );
    await discoverOpenRouterModels();
    _expireOpenRouterDiscoveryCacheForTesting();
    _setOpenRouterDiscoveryFetch(async () =>
      new Response("failure", { status: 503 }),
    );
    const models = await discoverOpenRouterModels();
    expect(models.map((m) => m.id)).toEqual(["a/free"]);
  });
});
