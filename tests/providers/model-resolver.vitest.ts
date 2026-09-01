import {
  describe,
  it,
  expect,
  afterEach,
} from "vitest";

import {
  selectModelFromDiscovery,
  resolveConcreteFreeModel,
} from "../../src/providers/model-resolver.js";

import type {
  DiscoveredModel,
} from "../../src/providers/model-discovery.js";

import {
  _setOpenRouterDiscoveryFetch,
  _resetOpenRouterDiscoveryCache,
} from "../../src/providers/model-discovery.js";

import {
  _resetAccessRestrictionRegistryForTesting,
} from "../../src/providers/access-restriction-registry.js";

import {
  resolveModelSelectionId,
} from "../../src/providers/model-resolver.js";

const M = (
  id: string,
  ctx: number | undefined,
  cost: number | undefined,
  caps: string[] = [],
): DiscoveredModel => ({
  id,
  provider: "openrouter",

  ...(ctx !== undefined
    ? { inputContextLimit: ctx }
    : {}),

  ...(cost !== undefined
    ? { costPerMTokIn: cost }
    : {}),

  ...(caps.includes("tools")
    ? { supportsTools: true }
    : {}),

  ...(caps.includes("structured_outputs")
    ? { supportsStructuredOutput: true }
    : {}),

  ...(caps.includes("vision")
    ? { supportsVision: true }
    : {}),
});

describe("selectModelFromDiscovery", () => {
  it("picks the cheapest paid model meeting caps", () => {
    const models = [
      M(
        "x/costly",
        200_000,
        20,
        ["tools"],
      ),
      M(
        "y/cheap",
        32_000,
        1.5,
        ["tools"],
      ),
    ];

    expect(
      selectModelFromDiscovery(
        {
          cost: "paid",
          capabilities: ["tools"],
        },
        models,
      )?.id,
    ).toBe("y/cheap");
  });

  it("picks the cheapest model positively supporting structured output", () => {
    const models = [
      M(
        "x/cheap-no-so",
        200_000,
        1,
        [],
      ),
      M(
        "y/so",
        32_000,
        2,
        ["structured_outputs"],
      ),
    ];

    expect(
      selectModelFromDiscovery(
        {
          cost: "paid",
          capabilities: ["structured_output"],
        },
        models,
      )?.id,
    ).toBe("y/so");
  });

  it("picks the cheapest model positively supporting vision", () => {
    const models = [
      M(
        "x/cheap-no-vision",
        200_000,
        1,
        [],
      ),
      M(
        "y/vision",
        32_000,
        2,
        ["vision"],
      ),
    ];

    expect(
      selectModelFromDiscovery(
        {
          cost: "paid",
          capabilities: ["vision"],
        },
        models,
      )?.id,
    ).toBe("y/vision");
  });

  it("does not treat unknown cost as free", () => {
    const models = [
      M("unknown", 128_000, undefined),
      M("free", 8_000, 0),
    ];

    expect(
      selectModelFromDiscovery(
        { cost: "free" },
        models,
      )?.id,
    ).toBe("free");
  });

  it("does not treat unknown cost as paid", () => {
    const models = [
      M("unknown", 128_000, undefined),
      M("paid", 8_000, 2),
    ];

    expect(
      selectModelFromDiscovery(
        { cost: "paid" },
        models,
      )?.id,
    ).toBe("paid");
  });

  it("ignores cost when the source has no cost metadata", () => {
    const models = [
      M(
        "n/none",
        64_000,
        undefined,
        [],
      ),
    ];

    expect(
      selectModelFromDiscovery(
        {
          cost: "paid",
          capabilities: ["tools"],
        },
        models,
      )?.id,
    ).toBe("n/none");
  });

  it("honors minContext when context is exposed", () => {
    const models = [
      M("small", 8_000, undefined),
      M("big", 64_000, undefined),
    ];

    expect(
      selectModelFromDiscovery(
        { minContext: 32_768 },
        models,
      )?.id,
    ).toBe("big");
  });

  it("ignores minContext when context is unavailable", () => {
    const models = [
      M(
        "unknown",
        undefined,
        undefined,
      ),
    ];

    expect(
      selectModelFromDiscovery(
        { minContext: 32_768 },
        models,
      )?.id,
    ).toBe("unknown");
  });

  it("chooses the largest context when no cost is known", () => {
    const models = [
      M("a", 4_000, undefined),
      M("b", 128_000, undefined),
    ];

    expect(
      selectModelFromDiscovery(
        {},
        models,
      )?.id,
    ).toBe("b");
  });

  it("chooses cheapest known cost for cost:any", () => {
    const models = [
      M("free", 8_000, 0),
      M("cheap", 16_000, 2),
      M("expensive", 128_000, 20),
    ];

    expect(
      selectModelFromDiscovery(
        { cost: "any" },
        models,
      )?.id,
    ).toBe("free");
  });

  it("ranks known cost ahead of unknown cost", () => {
    const models = [
      M(
        "unknown-large",
        1_000_000,
        undefined,
      ),
      M(
        "known-cheap",
        8_000,
        1,
      ),
    ];

    expect(
      selectModelFromDiscovery(
        { cost: "any" },
        models,
      )?.id,
    ).toBe("known-cheap");
  });

  it("uses context as the secondary ranking", () => {
    const models = [
      M("small", 8_000, 1),
      M("large", 128_000, 1),
    ];

    expect(
      selectModelFromDiscovery(
        {},
        models,
      )?.id,
    ).toBe("large");
  });

  it("uses model id as deterministic tertiary ranking", () => {
    const models = [
      M("z-model", 32_000, 1),
      M("a-model", 32_000, 1),
    ];

    expect(
      selectModelFromDiscovery(
        {},
        models,
      )?.id,
    ).toBe("a-model");
  });

  it("excludes restricted ids", () => {
    const models = [
      M("a", 4_000, undefined),
      M("b", 128_000, undefined),
    ];

    expect(
      selectModelFromDiscovery(
        {},
        models,
        new Set(["b"]),
      )?.id,
    ).toBe("a");
  });

  it("returns undefined when nothing is eligible", () => {
    expect(
      selectModelFromDiscovery(
        {
          minContext: 1_000_000,
        },
        [
          M("a", 4_000, undefined),
        ],
      ),
    ).toBeUndefined();
  });
});

describe("resolveConcreteFreeModel (free-route helper)", () => {
  const reqTools = {
    needsTools: true,
    needsStructuredOutput: false,
    needsVision: false,
  };

  it("picks the largest-context eligible model regardless of cost", () => {
    const models = [
      M("a/small:free", 4_000, 0, ["tools"]),
      M("b/big:free", 64_000, 0, ["tools"]),
    ];
    expect(
      resolveConcreteFreeModel(models, reqTools)?.id,
    ).toBe("b/big:free");
  });

  it("filters by request prefix capabilities (forced needsTools)", () => {
    const models = [
      M("no-tools", 200_000, 0, []),
      M("tools", 8_000, 0, ["tools"]),
    ];
    expect(
      resolveConcreteFreeModel(models, reqTools)?.id,
    ).toBe("tools");
  });

  it("excludes restricted ids", () => {
    const models = [
      M("a", 64_000, 0, ["tools"]),
      M("b", 128_000, 0, ["tools"]),
    ];
    expect(
      resolveConcreteFreeModel(models, reqTools, new Set(["b"]))?.id,
    ).toBe("a");
  });
});

afterEach(() => {
  _resetOpenRouterDiscoveryCache();
  _resetAccessRestrictionRegistryForTesting();
  _setOpenRouterDiscoveryFetch(
    globalThis.fetch,
  );
});

describe(
  "resolveModelSelectionId seam",
  () => {
    it(
      "defaults provider to openrouter and selects cheapest eligible",
      async () => {
        _setOpenRouterDiscoveryFetch(
          async () =>
            new Response(
              JSON.stringify({
                data: [
                  {
                    id: "x/costly",
                    context_length:
                      200_000,
                    pricing: {
                      prompt:
                        "0.00002",
                      completion:
                        "0.00006",
                    },
                    supported_parameters:
                      ["tools"],
                  },
                  {
                    id: "y/cheap",
                    context_length:
                      32_000,
                    pricing: {
                      prompt:
                        "0.0000015",
                      completion:
                        "0.000004",
                    },
                    supported_parameters:
                      ["tools"],
                  },
                ],
              }),
              {
                status: 200,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            ),
        );

        await expect(
          resolveModelSelectionId(
            {
              cost: "paid",
              capabilities: [
                "tools",
              ],
            },
            {},
          ),
        ).resolves.toEqual({
          id: "y/cheap",
        });
      },
    );

    it(
      "resolves a free policy with largest-context free model",
      async () => {
        _setOpenRouterDiscoveryFetch(
          async () =>
            new Response(
              JSON.stringify({
                data: [
                  {
                    id: "a/small:free",
                    context_length:
                      4_000,
                    pricing: {
                      prompt: "0",
                      completion: "0",
                    },
                    supported_parameters:
                      ["tools"],
                  },
                  {
                    id: "b/big:free",
                    context_length:
                      64_000,
                    pricing: {
                      prompt: "0",
                      completion: "0",
                    },
                    supported_parameters:
                      ["tools"],
                  },
                ],
              }),
              {
                status: 200,
                headers: {
                  "Content-Type":
                    "application/json",
                },
              },
            ),
        );

        await expect(
          resolveModelSelectionId(
            {
              cost: "free",
              capabilities: [
                "tools",
              ],
            },
            {},
          ),
        ).resolves.toEqual({
          id: "b/big:free",
        });
      },
    );
  },
);
