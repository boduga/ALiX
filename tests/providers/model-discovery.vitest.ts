import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";

import {
  discoverOpenRouterModels,
  _setOpenRouterDiscoveryFetch,
  _resetOpenRouterDiscoveryCache,
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
});
