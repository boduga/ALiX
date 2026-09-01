Below is the **full implementation-ready version**, incorporating the corrections above while preserving the architecture and task structure of your original plan. I’ve made the selector semantics explicit, fixed the OpenRouter pricing-unit issue, strengthened the tests, and made the free-route and credential invariants explicit.

# Model Selection: Paid + Multi-Provider Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Goal

Extend `ModelSelectionPolicy` discovery from its current OpenRouter-free-only behavior to support:

* `cost: free`
* `cost: paid`
* `cost: any`
* provider-specific selection across **any configured provider**
* OpenRouter cost and capability filtering
* non-OpenRouter model discovery through the existing `listModels()` mechanism
* deterministic selection
* restricted-model exclusion
* store-supplied API keys only

The implementation must **never hard-code concrete model IDs**. Every concrete model ID must originate from provider discovery.

---

# Architecture

Introduce one generalized model-discovery/resolution path:

```text
                         ModelSelectionPolicy
                                  │
                                  ▼
                   resolveModelSelectionId()
                         { apiKey }
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
             provider=openrouter          provider=other
                    │                           │
                    ▼                           ▼
       discoverOpenRouterModels()       discoverProviderModels()
                    │                           │
                    ▼                           ▼
          Rich OpenRouter catalog          listModels()
          • id                             • id
          • context                        • context
          • input cost                     • provider
          • tools
          • structured output
          • vision
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
                    selectModelFromDiscovery()
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
               eligibility               restricted IDs
                    │                           │
                    └─────────────┬─────────────┘
                                  ▼
                         deterministic ranking
                                  │
                                  ▼
                              { id }
```

### Module responsibilities

```text
src/providers/model-discovery.ts
    Provider-independent discovered-model data shape.
    OpenRouter rich catalog discovery.

src/providers/model-resolver.ts
    Selection requirements.
    Provider discovery adapter.
    Eligibility filtering.
    Deterministic ranking.
    Single resolution seam.

src/providers/catalog.ts
    Existing provider listModels() discovery.
    No model IDs hard-coded here by this feature.

src/providers/registry.ts
    createProvider() caller.
    Supplies the provider API key to the resolution seam.

src/providers/routing-adapter.ts
    buildRoutingAdapter() caller.
    Supplies the provider API key to the resolution seam.

src/providers/openrouter-provider.ts
    Existing openrouter/free self-healing route.
    Must retain fresh discovery + restriction semantics.
```

---

# Global Constraints

These are architectural invariants, not implementation suggestions.

### Credential handling

* API keys resolve **store-only**.
* `resolveModelSelectionId()` receives credentials through `{ apiKey }`.
* Discovery functions receive the key from their caller.
* No model-selection discovery/resolution function may read `process.env` at resolution time.
* No new environment-variable fallback may be introduced.

### Model identity

* Concrete model IDs are never hard-coded.
* `resolveModelSelectionId()` can only return an ID supplied by discovery.
* `createProvider()` and `buildRoutingAdapter()` must retain their existing `{ provider, model }` caller shape byte-for-byte.

### Provider resolution

* All consumers resolve `provider` through the same `resolveModelSelectionId()` seam.
* `policy.provider ?? "openrouter"` remains the default.
* OpenRouter receives richer discovery.
* Every other provider uses the existing `listModels()` discovery.

### Cost semantics

```text
cost: free
    known cost == 0

cost: paid
    known cost > 0

cost: any
    no cost filtering

unknown cost
    is never treated as free
```

### Capability semantics

OpenRouter exposes verifiable capability metadata:

```text
tools
structured_outputs
vision
```

A requested OpenRouter capability must be positively known to be supported.

For providers whose `listModels()` data does not expose verifiable capability metadata, capability filters are ignored rather than incorrectly inferred.

### Context semantics

If a model exposes input context:

```text
model.inputContextLimit < policy.minContext
    → ineligible
```

If input context is unavailable:

```text
policy.minContext
    → cannot be verified
    → do not reject the model
```

### Ranking semantics

Selection is deterministic:

1. known input cost ascending
2. unknown-cost models after known-cost models
3. input context descending
4. model ID ascending

Therefore:

```text
free models:
    all cost == 0
    → largest context wins

paid models:
    cheapest known input cost wins

any:
    cheapest known input cost wins
    unknown-cost models remain eligible

no cost metadata:
    largest context wins
```

### Free-route invariant

`openrouter/free` must continue to:

1. discover currently available OpenRouter models;
2. retain only currently free models;
3. exclude restricted model IDs;
4. select deterministically;
5. avoid hard-coded model IDs.

---

# Task 0: Lock selector semantics before implementation

**Purpose:** Remove ambiguity that could otherwise be encoded into the generalized resolver.

**Files:**

* Modify: `tests/providers/model-resolver.vitest.ts`
* Possibly modify: `src/config/schema.ts` only if current `ModelSelectionPolicy` vocabulary does not already expose `paid` / `any`.

### Required decisions

* [ ] OpenRouter pricing is normalized from **$/token** to **$/MTok**.
* [ ] `cost: free` accepts only `costPerMTokIn === 0`.
* [ ] `cost: paid` accepts only known `costPerMTokIn > 0`.
* [ ] `cost: any` imposes no cost filter.
* [ ] Unknown cost is never interpreted as free.
* [ ] OpenRouter capability requirements require positively-known support.
* [ ] Non-OpenRouter capability/cost filters are ignored when unverifiable.
* [ ] `minContext` rejects only models whose context is known and below the minimum.
* [ ] Ranking is known cost ascending, unknown cost last, context descending, ID ascending.
* [ ] Restricted IDs are excluded before ranking.
* [ ] No model IDs are embedded in selection logic.
* [ ] No discovery path reads `process.env`.

### Acceptance

The implementation agent must be able to derive every selector result from these rules without making additional design decisions.

---

# Task 1: Create `model-discovery.ts` — richer OpenRouter catalog

**Files:**

* Create: `src/providers/model-discovery.ts`
* Delete later: `src/providers/free-model-catalog.ts`
* Create: `tests/providers/model-discovery.vitest.ts`

## Interface

```ts
export type DiscoveredModel = {
  id: string;
  provider: string;
  inputContextLimit?: number;
  costPerMTokIn?: number;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;
};

export async function discoverOpenRouterModels(
  opts?: { apiKey?: string },
): Promise<DiscoveredModel[]>;

export function _setOpenRouterDiscoveryFetch(
  f: typeof fetch,
): void;

export function _resetOpenRouterDiscoveryCache(): void;
```

## Step 1: Write failing tests

Create:

```ts
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
```

## Step 2: Run failing test

```bash
pnpm vitest run tests/providers/model-discovery.vitest.ts
```

Expected:

```text
FAIL — module not found / exports unavailable
```

## Step 3: Implement

Create:

```ts
// src/providers/model-discovery.ts

export type DiscoveredModel = {
  id: string;
  provider: string;
  inputContextLimit?: number;
  costPerMTokIn?: number;
  supportsTools?: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;
};

const CATALOG_URL =
  "https://openrouter.ai/api/v1/models";

const TTL_MS = 60 * 60 * 1000;

let _fetch: typeof fetch = globalThis.fetch;

export function _setOpenRouterDiscoveryFetch(
  f: typeof fetch,
): void {
  _fetch = f;
}

let cache:
  | {
      models: DiscoveredModel[];
      fetchedAt: number;
    }
  | undefined;

export function _resetOpenRouterDiscoveryCache(): void {
  cache = undefined;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function supports(
  name: string,
  params: unknown,
): boolean {
  if (Array.isArray(params)) {
    return params.includes(name);
  }

  if (isRecord(params)) {
    return params[name] === true;
  }

  return false;
}

function toDiscoveredModel(
  model: Record<string, unknown>,
): DiscoveredModel {
  const params = model.supported_parameters;

  const pricing = isRecord(model.pricing)
    ? model.pricing
    : {};

  const promptPerToken =
    typeof pricing.prompt === "string"
      ? parseFloat(pricing.prompt)
      : NaN;

  const costPerMTokIn =
    Number.isFinite(promptPerToken)
      ? promptPerToken * 1_000_000
      : undefined;

  const id =
    typeof model.id === "string"
      ? model.id
      : "";

  return {
    id,
    provider: "openrouter",

    ...(typeof model.context_length === "number"
      ? {
          inputContextLimit:
            model.context_length,
        }
      : {}),

    ...(costPerMTokIn !== undefined
      ? {
          costPerMTokIn,
        }
      : {}),

    supportsTools: supports(
      "tools",
      params,
    ),

    supportsStructuredOutput: supports(
      "structured_outputs",
      params,
    ),

    supportsVision: supports(
      "vision",
      params,
    ),
  };
}

export async function discoverOpenRouterModels(
  opts: { apiKey?: string } = {},
): Promise<DiscoveredModel[]> {
  if (
    cache &&
    Date.now() - cache.fetchedAt < TTL_MS
  ) {
    return cache.models;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (opts.apiKey) {
    headers.Authorization =
      `Bearer ${opts.apiKey}`;
  }

  const response = await _fetch(
    CATALOG_URL,
    { headers },
  );

  if (!response.ok) {
    throw new Error(
      `OpenRouter catalog request failed: ${response.status}`,
    );
  }

  const json =
    (await response.json()) as {
      data?: unknown;
    };

  const models = Array.isArray(json.data)
    ? json.data
        .filter(isRecord)
        .map((model) =>
          toDiscoveredModel(model),
        )
        .filter((model) =>
          model.id.length > 0,
        )
    : [];

  cache = {
    models,
    fetchedAt: Date.now(),
  };

  return models;
}
```

## Step 4: Run passing tests

```bash
pnpm vitest run tests/providers/model-discovery.vitest.ts
```

Expected:

```text
PASS
```

## Step 5: Commit

```bash
git add \
  src/providers/model-discovery.ts \
  tests/providers/model-discovery.vitest.ts

git commit -m \
  "feat(providers): general OpenRouter model discovery"
```

---

# Task 2: Generalize `model-resolver.ts`

**Files:**

* Create: `src/providers/model-resolver.ts`
* Source: existing `free-model-resolver.ts`
* Modify if required: `src/providers/catalog.ts`
* Create/modify: `tests/providers/model-resolver.vitest.ts`

## Interfaces

```ts
export type ModelSelectionRequirements = {
  needsTools: boolean;
  needsStructuredOutput: boolean;
  needsVision: boolean;
  maxInputTokens?: number;
};

export function deriveRequestRequirements(
  request: NormalizedRequest,
  maxInputTokens?: number,
): ModelSelectionRequirements;

export function supportsRequest(
  capabilities: ModelCapabilities,
  requirements: ModelSelectionRequirements,
): boolean;

export async function discoverProviderModels(
  provider: string,
  apiKey?: string,
): Promise<DiscoveredModel[]>;

export function selectModelFromDiscovery(
  policy: ModelSelectionPolicy,
  models: DiscoveredModel[],
  exclude?: Set<string>,
): DiscoveredModel | undefined;

/**
 * Free-route helper — REQUEST-DERIVED requirements, largest-context ranking.
 * KEPT for the `openrouter/free` route, which filters on the request's actual
 * needs (`needsTools` forced true for the agent tab, vision/structured-output
 * when present), NOT on a declared policy. Distinct from
 * `selectModelFromDiscovery` (policy-based). Input broadened from
 * `FreeModelInfo[]` → `DiscoveredModel[]` only.
 */
export function resolveConcreteFreeModel(
  models: DiscoveredModel[],
  requirements: ModelSelectionRequirements,
  exclude?: Set<string>,
): DiscoveredModel | undefined;
```

> **Free-route split (do NOT conflate):** `selectModelFromDiscovery` is for
> `ModelSelectionPolicy` selection (cheapest-when-cost-known). The `openrouter/free`
> route keeps `resolveConcreteFreeModel` (request-derived `needsTools:true`, context-desc
> ranking). Both share `supportsRequest` via `discoveredCapabilities`. Do not replace the
> free route with `selectModelFromDiscovery({cost:"free"})` — that carries no requirement
> filtering and would drop the forced `needsTools:true` invariant.

## Step 1: Write selector tests

```ts
import {
  describe,
  it,
  expect,
} from "vitest";

import {
  selectModelFromDiscovery,
  resolveConcreteFreeModel,
} from "../../src/providers/model-resolver.js";

import type {
  DiscoveredModel,
} from "../../src/providers/model-discovery.js";

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

  supportsTools:
    caps.includes("tools"),

  supportsStructuredOutput:
    caps.includes("structured_outputs"),

  supportsVision:
    caps.includes("vision"),
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
```

## Step 2: Run failing tests

```bash
pnpm vitest run tests/providers/model-resolver.vitest.ts
```

Expected:

```text
FAIL — module not found
```

## Step 3: Implement generalized resolver

Preserve existing implementations of:

```ts
deriveRequestRequirements()
supportsRequest()
```

unless inspection demonstrates that they are dead and no caller requires them.

Rename:

```text
FreeModelRequirements
    ↓
ModelSelectionRequirements
```

Implement:

```ts
import {
  type DiscoveredModel,
} from "./model-discovery.js";

import {
  listModels,
} from "./catalog.js";

import {
  accessRestrictedModelIds,
} from "./access-restriction-registry.js";

import type {
  NormalizedRequest,
  ModelCapabilities,
} from "./types.js";

import type {
  ModelSelectionPolicy,
} from "../config/schema.js";

export type ModelSelectionRequirements = {
  needsTools: boolean;
  needsStructuredOutput: boolean;
  needsVision: boolean;
  maxInputTokens?: number;
};

export function deriveRequestRequirements(
  request: NormalizedRequest,
  maxInputTokens?: number,
): ModelSelectionRequirements {
  return {
    needsTools:
      !!(
        request.tools &&
        request.tools.length > 0
      ),

    needsStructuredOutput:
      request.structuredOutputSchema !==
      undefined,

    needsVision:
      Array.isArray(request.messages) &&
      request.messages.some((message) =>
        Array.isArray(message.content) &&
        message.content.some(
          (content) =>
            content.type === "image" ||
            content.type === "file",
        ),
      ),

    ...(maxInputTokens !== undefined
      ? { maxInputTokens }
      : {}),
  };
}

export function supportsRequest(
  capabilities: ModelCapabilities,
  requirements: ModelSelectionRequirements,
): boolean {
  if (
    requirements.needsTools &&
    !capabilities.supportsTools
  ) {
    return false;
  }

  if (
    requirements.needsStructuredOutput &&
    !capabilities.supportsStructuredOutput
  ) {
    return false;
  }

  if (
    requirements.needsVision &&
    !capabilities.supportsVision
  ) {
    return false;
  }

  if (
    requirements.maxInputTokens !== undefined &&
    capabilities.inputTokenLimit <
      requirements.maxInputTokens
  ) {
    return false;
  }

  return true;
}

export async function discoverProviderModels(
  provider: string,
  apiKey?: string,
): Promise<DiscoveredModel[]> {
  const listed = await listModels(
    provider,
    apiKey ?? "",
  );

  return listed.map((model) => ({
    id: model.id,
    provider,

    ...(model.maxInputTokens !== undefined
      ? {
          inputContextLimit:
            model.maxInputTokens,
        }
      : {}),
  }));
}

export function selectModelFromDiscovery(
  policy: ModelSelectionPolicy,
  models: DiscoveredModel[],
  exclude: Set<string> = new Set(),
): DiscoveredModel | undefined {
  const sourceHasCost = models.some(
    (model) =>
      model.costPerMTokIn !== undefined,
  );

  const sourceHasCapabilities =
    models.some(
      (model) =>
        model.supportsTools !== undefined ||
        model.supportsStructuredOutput !==
          undefined ||
        model.supportsVision !== undefined,
    );

  const eligible = models.filter(
    (model) => {
      if (exclude.has(model.id)) {
        return false;
      }

      if (
        policy.minContext !== undefined &&
        model.inputContextLimit !==
          undefined &&
        model.inputContextLimit <
          policy.minContext
      ) {
        return false;
      }

      if (
        sourceHasCost &&
        policy.cost !== undefined
      ) {
        if (
          policy.cost === "free" &&
          model.costPerMTokIn !== 0
        ) {
          return false;
        }

        if (
          policy.cost === "paid" &&
          (
            model.costPerMTokIn ===
              undefined ||
            model.costPerMTokIn <= 0
          )
        ) {
          return false;
        }
      }

      if (
        sourceHasCapabilities &&
        policy.capabilities
      ) {
        if (
          policy.capabilities.includes(
            "tools",
          ) &&
          model.supportsTools !== true
        ) {
          return false;
        }

        if (
          policy.capabilities.includes(
            "structured_output",
          ) &&
          model.supportsStructuredOutput !==
            true
        ) {
          return false;
        }

        if (
          policy.capabilities.includes(
            "vision",
          ) &&
          model.supportsVision !== true
        ) {
          return false;
        }
      }

      return true;
    },
  );

  if (eligible.length === 0) {
    return undefined;
  }

  const hasKnownCost = eligible.some(
    (model) =>
      model.costPerMTokIn !== undefined,
  );

  return [...eligible].sort(
    (a, b) => {
      if (hasKnownCost) {
        const aHasCost =
          a.costPerMTokIn !== undefined;

        const bHasCost =
          b.costPerMTokIn !== undefined;

        if (aHasCost && !bHasCost) {
          return -1;
        }

        if (!aHasCost && bHasCost) {
          return 1;
        }

        if (
          aHasCost &&
          bHasCost &&
          a.costPerMTokIn !==
            b.costPerMTokIn
        ) {
          return (
            a.costPerMTokIn! -
            b.costPerMTokIn!
          );
        }
      }

      const contextDifference =
        (b.inputContextLimit ?? -1) -
        (a.inputContextLimit ?? -1);

      if (contextDifference !== 0) {
        return contextDifference;
      }

      return a.id.localeCompare(b.id);
    },
  )[0];
}

// Map a discovered model onto the ONE capability vocabulary (`supportsRequest`)
// shared with the routing layer. Unknown context maps to `-1` so a concrete
// context requirement conservatively rejects an unknown-context model.
function discoveredCapabilities(
  model: DiscoveredModel,
): ModelCapabilities {
  return {
    provider: model.provider,
    model: model.id,
    inputTokenLimit: model.inputContextLimit ?? -1,
    outputTokenLimit: 0,
    supportsTools: model.supportsTools ?? false,
    supportsStreaming: true,
    supportsStructuredOutput:
      model.supportsStructuredOutput ?? false,
    supportsVision: model.supportsVision ?? false,
  };
}

/**
 * Free-route helper — REQUEST-DERIVED requirements, largest-context ranking.
 * Preserves the existing `openrouter/free` semantics (openrouter-provider.ts
 * `resolveConcreteModel`) where `needsTools` is forced true for the agent tab
 * and vision/structured-output come from the request. This is NOT policy
 * selection (which uses `selectModelFromDiscovery`). Broadened input type
 * from `FreeModelInfo[]` → `DiscoveredModel[]` only.
 */
export function resolveConcreteFreeModel(
  models: DiscoveredModel[],
  requirements: ModelSelectionRequirements,
  exclude: Set<string> = new Set(),
): DiscoveredModel | undefined {
  const eligible = models.filter(
    (model) =>
      !exclude.has(model.id) &&
      supportsRequest(
        discoveredCapabilities(model),
        requirements,
      ),
  );

  if (eligible.length === 0) {
    return undefined;
  }

  return [...eligible].sort(
    (a, b) =>
      (b.inputContextLimit ?? -1) -
        (a.inputContextLimit ?? -1) ||
      a.id.localeCompare(b.id),
  )[0];
}
```

## Step 4: Run tests

```bash
pnpm vitest run tests/providers/model-resolver.vitest.ts
```

Expected:

```text
PASS
```

## Step 5: Commit

```bash
git add \
  src/providers/model-resolver.ts \
  tests/providers/model-resolver.vitest.ts

git commit -m \
  "feat(providers): generalize model selection and provider discovery"
```

---

# Task 3: Add the unified `resolveModelSelectionId()` seam

**Files:**

* Modify: `src/providers/model-resolver.ts`
* Modify: `tests/providers/model-resolver.vitest.ts`

## Interface

```ts
export async function resolveModelSelectionId(
  policy: ModelSelectionPolicy,
  opts?: {
    apiKey?: string;
  },
): Promise<{ id: string } | undefined>;
```

## Step 1: Add failing seam tests

```ts
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
```

## Step 2: Run failing test

```bash
pnpm vitest run tests/providers/model-resolver.vitest.ts
```

Expected:

```text
FAIL — seam unavailable / behavior mismatch
```

## Step 3: Implement

Add:

```ts
import {
  discoverOpenRouterModels,
} from "./model-discovery.js";

export async function resolveModelSelectionId(
  policy: ModelSelectionPolicy,
  opts: {
    apiKey?: string;
  } = {},
): Promise<
  { id: string } | undefined
> {
  const provider =
    policy.provider ?? "openrouter";

  const models =
    provider === "openrouter"
      ? await discoverOpenRouterModels({
          apiKey: opts.apiKey,
        })
      : await discoverProviderModels(
          provider,
          opts.apiKey,
        );

  const resolved =
    selectModelFromDiscovery(
      policy,
      models,
      accessRestrictedModelIds(),
    );

  return resolved
    ? { id: resolved.id }
    : undefined;
}
```

## Step 4: Run

```bash
pnpm vitest run tests/providers/model-resolver.vitest.ts
```

Expected:

```text
PASS
```

## Step 5: Commit

```bash
git add \
  src/providers/model-resolver.ts \
  tests/providers/model-resolver.vitest.ts

git commit -m \
  "feat(providers): add unified model selection resolution seam"
```

---

# Task 4: Migrate provider callers and remove obsolete modules

**Files:**

* Modify: `src/providers/registry.ts`
* Modify: `src/providers/routing-adapter.ts`
* Modify: `src/providers/openrouter-provider.ts`
* Delete: `src/providers/free-model-catalog.ts`
* Delete: `src/providers/free-model-resolver.ts`

## Step 1: Migrate `registry.ts`

Change:

```ts
import {
  resolveModelSelectionId,
} from "./free-model-resolver.js";
```

to:

```ts
import {
  resolveModelSelectionId,
} from "./model-resolver.js";
```

Where `createProvider()` resolves selection:

```ts
const resolved =
  await resolveModelSelectionId(
    config.selection,
    { apiKey },
  );
```

Do not alter existing `{ provider, model }` callers.

## Step 2: Migrate `routing-adapter.ts`

Import:

```ts
import {
  supportsRequest,
  deriveRequestRequirements,
  resolveModelSelectionId,
} from "./model-resolver.js";
```

Resolve with:

```ts
const resolved =
  await resolveModelSelectionId(
    model.selection,
    {
      apiKey:
        apiKeyFor(model.provider),
    },
  );
```

The API key must come from the existing provider-key/store path.

## Step 3: Inspect `openrouter-provider.ts`

`openrouter/free` (openrouter-provider.ts `resolveConcreteModel`, ~lines 91–104) uses the **request-derived** helper and must keep it, NOT switch to policy selection:

```ts
// openrouter-provider.ts (update ONLY the imports/input type)
import { discoverOpenRouterModels } from "./model-discovery.js";
import { resolveConcreteFreeModel, deriveRequestRequirements } from "./model-resolver.js";

async function resolveConcreteModel(
  request: NormalizedRequest,
  exclude: Set<string> = new Set(),
): Promise<DiscoveredModel | undefined> {
  const ALL = await discoverOpenRouterModels();
  // free route considers only free models (discovery returns full catalog)
  const catalog = ALL.filter((m) => m.costPerMTokIn === 0);
  // agent tab always runs tool loops → needsTools forced true
  const requirements = { ...deriveRequestRequirements(request), needsTools: true };
  const excludeAll = new Set<string>([...exclude, ...accessRestrictedModelIds()]);
  return resolveConcreteFreeModel(catalog, requirements, excludeAll);
}
```

Do NOT replace this with `selectModelFromDiscovery({cost:"free"}, ...)` — it carries no requirement filtering and would silently allow non-tools-capable models into the agent tab.

Map symbols changed by the rename:

```text
resolveConcreteFreeModel  → kept (input type FreeModelInfo[] → DiscoveredModel[])
freeModelCapabilities     → discoveredCapabilities (private)
FreeModelRequirements     → ModelSelectionRequirements
resolveModelBySelectionPolicy → removed (replaced by selectModelFromDiscovery)
```

Preserve the free route's invariants:

```text
fresh discovery
free-only filtering (catalog already free-only)
request-derived requirement filtering (needsTools forced true)
restricted-model exclusion
deterministic largest-context selection
```

## Step 4: Delete old modules

```bash
git rm \
  src/providers/free-model-catalog.ts \
  src/providers/free-model-resolver.ts
```

## Step 5: Search for stale references

```bash
grep -rn \
  "free-model-catalog\|free-model-resolver\|fetchFreeModelCatalog\|resolveModelBySelectionPolicy\|FreeModelInfo\|FreeModelRequirements" \
  src tests \
  --include='*.ts'
```

Expected:

```text
no production references (to the deleted module paths or removed types/symbols)
```

Note: `resolveConcreteFreeModel` is a **kept** symbol (now in `model-resolver.js`, request-derived) — do not grep for it as stale; only its old `FreeModelInfo` input type is removed. `FreeModelRequirements` → `ModelSelectionRequirements`.

Any test imports still using the old filenames must be migrated in Task 6.

## Step 6: Migrate the `alix models free` CLI consumer

`src/cli/commands/models.ts` (~lines 302–305) dynamically imports `fetchFreeModelCatalog` for `alix models free`. Migrate it, and preserve its **free-only** semantics now that discovery returns the full catalog:

```ts
// src/cli/commands/models.ts
const { discoverOpenRouterModels } = await import("../../providers/model-discovery.js");
let models = await discoverOpenRouterModels();
// alix models free must list only free models
models = models.filter((m) => m.costPerMTokIn === 0);
```

`tests/cli/commands/models-free.vitest.ts` uses the rename hooks — update its imports:

```text
_setCatalogFetchForTesting    → _setOpenRouterDiscoveryFetch
_resetCatalogCacheForTesting  → _resetOpenRouterDiscoveryCache
fetchFreeModelCatalog         → discoverOpenRouterModels
```

and ensure its fixtures are free models (`pricing.prompt: "0"`, `pricing.completion: "0"`) so the free filter keeps them.

## Step 7: Build

```bash
pnpm build
```

Expected:

```text
PASS
```

## Step 8: Commit

```bash
git add -A

git commit -m \
  "refactor(providers): rename free model discovery and resolver"
```

---

# Task 5: Integration tests — registry and routing use provider discovery

**Files:**

* Modify: `tests/config/model-selection-policy.vitest.ts`
* Possibly modify: `tests/providers/*` if routing coverage belongs there.

## Step 1: Update test imports

Replace:

```text
free-model-resolver.js
free-model-catalog.js
```

with:

```text
model-resolver.js
model-discovery.js
```

Replace:

```text
_resetCatalogCacheForTesting
_setCatalogFetchForTesting
```

with:

```text
_resetOpenRouterDiscoveryCache
_setOpenRouterDiscoveryFetch
```

where applicable.

## Step 2: Add non-OpenRouter registry test

Use the project's existing catalog testing seam if one exists.

Otherwise:

```ts
import * as catalog from "../../src/providers/catalog.js";
```

and:

```ts
const stubbed =
  vi.spyOn(
    catalog,
    "listModels",
  ).mockResolvedValue([
    {
      id: "mock/many",
      displayName: "Many",
      maxInputTokens: 128_000,
    },
    {
      id: "mock/few",
      displayName: "Few",
      maxInputTokens: 8_000,
    },
  ]);
```

Test:

```ts
describe(
  "createProvider resolves non-openrouter selection via listModels",
  () => {
    it(
      "picks largest-context mock model and ignores unverifiable cost/capabilities",
      async () => {
        const stubbed =
          vi.spyOn(
            catalog,
            "listModels",
          ).mockResolvedValue([
            {
              id: "mock/many",
              displayName: "Many",
              maxInputTokens: 128_000,
            },
            {
              id: "mock/few",
              displayName: "Few",
              maxInputTokens: 8_000,
            },
          ]);

        const adapter =
          await createProvider(
            {
              provider: "mock",
              name: "",
              selection: {
                cost: "paid",
                capabilities: [
                  "tools",
                ],
              },
            },
            "k",
          );

        expect(
          stubbed,
        ).toHaveBeenCalledWith(
          "mock",
          "k",
        );

        expect(adapter.id).toBe(
          "mock",
        );

        stubbed.mockRestore();
      },
    );
  },
);
```

The important assertion is that `listModels()` receives:

```text
provider = "mock"
apiKey = "k"
```

This proves the key is threaded through the provider-resolution seam.

## Step 3: Add fallback test that actually verifies model selection

The existing test:

```ts
expect(adapter.id).toBe("mock");
```

only proves provider identity.

Inspect the adapter contract and assert the concrete model where available.

If the adapter exposes a model property:

```ts
expect(adapter.model).toBe(
  "mock-model",
);
```

Otherwise exercise the adapter with a request and verify that the underlying provider receives `"mock-model"`.

Test:

```ts
it(
  "falls back to explicit name when selection resolves no model",
  async () => {
    const stubbed =
      vi.spyOn(
        catalog,
        "listModels",
      ).mockResolvedValue([]);

    const adapter =
      await createProvider(
        {
          provider: "mock",
          name: "mock-model",
          selection: {},
        },
        "k",
      );

    // Assert concrete-model fallback using
    // the project's actual adapter contract.

    stubbed.mockRestore();
  },
);
```

## Step 4: Test routing

Add a routing-specific case proving:

```text
model.provider
     ↓
apiKeyFor(model.provider)
     ↓
resolveModelSelectionId()
     ↓
discoverProviderModels()
     ↓
listModels(provider, key)
```

The test should assert the exact provider/key pair received by `listModels()`.

## Step 5: Run

```bash
pnpm vitest run \
  tests/config/model-selection-policy.vitest.ts
```

Expected:

```text
PASS
```

## Step 6: Commit

```bash
git add \
  tests/config/model-selection-policy.vitest.ts

git commit -m \
  "test(providers): verify multi-provider model selection"
```

---

# Task 6: Preserve OpenRouter free-route self-healing

**Files:**

* Verify/modify: `src/providers/openrouter-provider.ts`
* Modify old provider tests to renamed modules.

## Required invariant

The `openrouter/free` route must continue to:

```text
discover current OpenRouter catalog
        ↓
filter cost == 0
        ↓
exclude accessRestrictedModelIds()
        ↓
rank deterministically
        ↓
use selected current model
```

It must **not**:

```text
hard-code a model ID
```

and must not regress to a static free-model catalog.

## Step 1: Confirm the free route keeps request-derived requirements

The `openrouter/free` route MUST NOT use `selectModelFromDiscovery` — it uses the **request-derived** helper `resolveConcreteFreeModel` (kept from Task 2), exactly the semantics of the current `resolveConcreteModel`:

```ts
// openrouter-provider.ts — requirement derivation unchanged; only inputs broadened
const ALL = await discoverOpenRouterModels();
// free route must consider only currently-free models;
// discoverOpenRouterModels returns the FULL catalog (free + paid)
const freeModels = ALL.filter((m) => m.costPerMTokIn === 0);
// agent tab always runs tool loops → needsTools forced true
const requirements = { ...deriveRequestRequirements(request), needsTools: true };
const excludeAll = new Set<string>([...exclude, ...accessRestrictedModelIds()]);
return resolveConcreteFreeModel(freeModels, requirements, excludeAll);
```

Reason: `selectModelFromDiscovery({cost:"free"}, ...)` performs **no capability filtering** — it only filters by cost/minContext/`policy.capabilities`. A bare `{cost:"free"}` policy carries no `needsTools`, so switching to it would let non-tools-capable models into the agent tab. Only `resolveConcreteFreeModel` honors the forced `needsTools:true` + request vision/structured-output flags via `supportsRequest`. Because `resolveConcreteFreeModel` does not itself filter by cost (the old `fetchFreeModelCatalog` was pre-filtered to free), the free route must filter `costPerMTokIn === 0` on the now-unfiltered catalog before calling it. This is the only behavioral delta vs. today.

## Step 2: Confirm deterministic ranking

All free models have:

```text
costPerMTokIn === 0
```

`resolveConcreteFreeModel` ranks by:

```text
context descending
ID ascending
```

Therefore the largest-context currently-free model wins.

## Step 3: Confirm restricted-model exclusion

The free route passes:

```ts
[...exclude, ...accessRestrictedModelIds()]
```

(account-rejection retry set + bounded-lifetime access-control set) through as `exclude` to `resolveConcreteFreeModel`. Confirm this exclusion still reaches the helper and that access-restricted ids stay out of candidate selection until their TTL expires.

## Step 4: Update old test imports

Update:

```text
tests/providers/free-model-catalog.vitest.ts
tests/providers/free-model-resolver.vitest.ts
tests/providers/openrouter-free-route.vitest.ts
tests/providers/resolved-model.vitest.ts
tests/providers/catalog.vitest.ts
tests/providers/access-restriction-registry.vitest.ts
tests/cli/commands/models-free.vitest.ts
```

where their imports/hooks reference the renamed modules. The `openrouter-free-route` test must keep asserting the request-derived `needsTools:true` behavior, and `models-free` must keep asserting free-only listing.

Rename test filenames only if the repository convention requires it. Do not mechanically rename tests if their historical name is still useful.

## Step 5: Run provider/config suites

```bash
pnpm vitest run \
  tests/providers \
  tests/config/model-selection-policy.vitest.ts
```

Expected:

```text
PASS
```

## Step 6: Build

```bash
pnpm build
```

## Step 7: Run compiled node:test suites

```bash
node dist/tests/providers/provider-registry.test.js
node dist/tests/agents/subagent-cli.test.js
node dist/tests/runtime/route-executor.test.js
node dist/tests/providers.test.js
```

Expected:

```text
PASS
```

## Step 8: Commit

```bash
git add -A

git commit -m \
  "refactor(providers): preserve free route with generalized discovery"
```

---

# Task 7: DOX and GitNexus synchronization

**Files:**

* Modify: `src/providers/AGENTS.md`

## Step 1: Update ownership table

Replace:

```text
free-model-catalog.ts
free-model-resolver.ts
```

with:

```text
model-discovery.ts
model-resolver.ts
```

## Step 2: Update policy-selection contract

Document:

```text
Policy-driven model selection is resolved through:

resolveModelSelectionId(
  policy,
  { apiKey },
)
```

Document provider behavior:

```text
OpenRouter:
    rich model discovery
    context
    input cost
    tools
    structured output
    vision

Other providers:
    existing listModels()
    model IDs
    context limits
    cost/capability filters ignored when unverifiable
```

Document ranking:

```text
1. known input cost ascending
2. unknown cost after known cost
3. context descending
4. model ID ascending
```

Document:

```text
apiKey is caller-supplied and store-only.
Resolver/discovery never reads process.env for credentials.
```

## Step 3: Document free-route invariant

Add:

```text
openrouter/free performs current-model discovery,
free-only filtering, restricted-ID exclusion, and
deterministic selection; it does not rely on
hard-coded model IDs.

openrouter/free uses the REQUEST-DERIVED helper
resolveConcreteFreeModel(requirements) — forced
needsTools:true for the agent tab + request
vision/structured-output — NOT selectModelFromDiscovery
(policy selection). Discovery returns the full catalog,
so the free route filters costPerMTokIn === 0 first.

Policy selection uses selectModelFromDiscovery
(cheapest-when-cost-known, else largest-context).

alix models free lists only costPerMTokIn === 0 models.
```

## Step 4: Refresh GitNexus

```bash
node .gitnexus/run.cjs analyze
```

## Step 5: Detect changes

```bash
node .gitnexus/run.cjs detect-changes
```

Review for:

```text
expected:
    free-model-catalog → model-discovery
    free-model-resolver → model-resolver
    resolveModelSelectionId callers
    provider registry
    routing adapter
    OpenRouter free route
    relevant tests/docs
```

Investigate unexpected production dependencies.

---

# Task 8: Full verification gate

Run:

```bash
pnpm build
```

Then:

```bash
pnpm test:vitest
```

Then:

```bash
pnpm test:node
```

Then:

```bash
pnpm vitest run \
  tests/providers \
  tests/config/model-selection-policy.vitest.ts
```

Then:

```bash
node .gitnexus/run.cjs detect-changes
```

## Required final state

All of the following must be true:

```text
✓ build passes
✓ Vitest passes
✓ node:test passes
✓ provider tests pass
✓ model-selection-policy tests pass
✓ no stale free-model imports remain
✓ no hard-coded model IDs introduced
✓ API keys remain caller-supplied
✓ no process.env lookup added to resolution
✓ OpenRouter free route remains self-healing
✓ restricted IDs remain excluded
✓ paid models can be selected
✓ free models can be selected
✓ cost:any works
✓ non-OpenRouter providers resolve through listModels()
✓ unavailable cost/capability metadata does not cause false rejection
✓ deterministic ranking remains stable
✓ DOX updated
✓ GitNexus index refreshed
```

---

# Final acceptance matrix

| Scenario          | Provider   | Policy                              | Expected behavior                               |
| ----------------- | ---------- | ----------------------------------- | ----------------------------------------------- |
| Default selection | OpenRouter | `{}`                                | largest-context when no cost metadata is usable |
| Free selection    | OpenRouter | `cost: free`                        | known cost `0`, largest context                 |
| Paid selection    | OpenRouter | `cost: paid`                        | cheapest known paid model                       |
| Any selection     | OpenRouter | `cost: any`                         | cheapest known model                            |
| Tools             | OpenRouter | `capabilities: [tools]`             | only models positively supporting tools         |
| Structured output | OpenRouter | `capabilities: [structured_output]` | only positively supported models                |
| Vision            | OpenRouter | `capabilities: [vision]`            | only positively supported models                |
| Context           | OpenRouter | `minContext: N`                     | reject known models below N                     |
| Unknown context   | Any        | `minContext: N`                     | retain because requirement cannot be verified   |
| Unknown cost      | OpenRouter | `cost: free`                        | reject                                          |
| Unknown cost      | OpenRouter | `cost: paid`                        | reject                                          |
| Unknown cost      | OpenRouter | `cost: any`                         | retain                                          |
| Non-OpenRouter    | Any        | `cost: paid`                        | ignore unverifiable cost filter                 |
| Non-OpenRouter    | Any        | capabilities                        | ignore unverifiable capability filter           |
| Restricted        | Any        | any policy                          | restricted IDs excluded                         |
| Explicit fallback | Any        | selection resolves none             | existing explicit model fallback preserved      |
| Registry          | Any        | selection                           | provider key passed to discovery                |
| Routing           | Any        | selection                           | provider key passed to discovery                |
| Free route        | OpenRouter | `openrouter/free`                   | current free model, restricted IDs excluded     |
| Credentials       | Any        | resolution                          | no `process.env` lookup                         |
| Identity          | Any        | selection                           | model ID originates only from discovery         |

---

# Self-Review

## Spec coverage

The implementation maps to the requested architecture:

```text
Task 0
    Selector semantics / invariant lock

Task 1
    Discovery data model
    OpenRouter rich catalog
    cost normalization
    capability discovery

Task 2
    General selector
    Provider listModels adapter
    requirements helpers

Task 3
    Unified resolution seam

Task 4
    Registry/routing/provider migration
    obsolete module removal

Task 5
    Multi-provider integration coverage

Task 6
    OpenRouter free-route preservation
    provider test migration

Task 7
    DOX
    GitNexus

Task 8
    Full verification
```

## Important correctness fixes incorporated

### OpenRouter pricing

OpenRouter prompt pricing is normalized from:

```text
$/token
```

to:

```text
$/MTok
```

before populating:

```ts
costPerMTokIn
```

### Unknown cost

Unknown cost is:

```text
undefined
```

and never:

```text
0
```

Therefore an unknown-cost model cannot accidentally qualify as free.

### Paid selection

`cost: paid` requires:

```ts
costPerMTokIn !== undefined &&
costPerMTokIn > 0
```

### Free selection

`cost: free` requires:

```ts
costPerMTokIn === 0
```

### Cost:any

`cost: any` does not filter models based on cost.

### Ranking

The selector is deterministic:

```text
known cost
    ↓
unknown cost
    ↓
larger context
    ↓
lexicographically smaller ID
```

### Credential ownership

The resolver does not discover credentials.

The caller supplies:

```ts
{ apiKey }
```

and provider discovery consumes that key.

### Model identity

The resolver does not know concrete model IDs.

Discovery supplies them.

### Provider identity

The resolver is the one shared policy-selection seam.

### Free route

The OpenRouter free route remains dynamically discovered rather than statically bound to a model ID. It keeps the **request-derived** helper `resolveConcreteFreeModel` (forced `needsTools:true` for the agent tab + request vision/structured-output), distinct from policy-based `selectModelFromDiscovery`. Because discovery now returns the full catalog, the free route filters `costPerMTokIn === 0` before selecting — the only behavioral delta vs. today. The `alix models free` CLI keeps free-only listing with the same filter.

---

# Implementation stop conditions

The agent must **STOP and surface a plan defect rather than silently invent behavior** if any of these occur:

1. `ModelSelectionPolicy.cost` does not support `paid` or `any`.
2. `listModels()` cannot accept the provider API key without violating an existing contract.
3. `createProvider()` currently obtains its provider key from a path that is not compatible with the store-only constraint.
4. `routing-adapter.ts` cannot obtain the provider-specific key through its existing key resolver.
5. OpenRouter's actual catalog representation differs materially from the pricing/capability assumptions above.
6. The existing free-route behavior depends on semantics that `selectModelFromDiscovery()` would weaken.
7. Existing tests establish a different ranking contract.
8. Existing provider adapters require a concrete model in a way that makes the explicit-name fallback different from the behavior described here.
9. `listModels()` exposes capability/cost metadata for some providers, requiring a deliberate source-capability contract rather than the simple "ignore unverifiable filters" rule.
10. `deriveRequestRequirements()` / `supportsRequest()` are found to have callers whose behavior would change under the generalized model representation.

In any such case, **do not patch around the conflict**. Surface the conflict, identify the affected invariant/test, and revise the plan before continuing.

---

# Definition of Done

The feature is complete when:

```text
ModelSelectionPolicy
        │
        ▼
resolveModelSelectionId(policy, { apiKey })
        │
        ├── OpenRouter → rich discovery
        │                 cost + capabilities + context
        │
        └── other      → listModels()
                          context
        │
        ▼
selectModelFromDiscovery()
        │
        ├── policy eligibility
        ├── restriction exclusion
        └── deterministic ranking
        │
        ▼
       { id }
```

and all repository verification gates pass without introducing:

* hard-coded model IDs;
* environment-variable credential reads;
* duplicated provider-selection logic;
* regressions in `openrouter/free`;
* stale `free-model-*` production imports.

This version is the one I would hand to the implementation agent. The **pricing normalization + unknown-cost handling + explicit ranking rules** are the important changes from the original plan.
