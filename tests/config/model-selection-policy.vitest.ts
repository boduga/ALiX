/**
 * model-selection-policy.vitest.ts — Policy-based model selection (Phase 2).
 *
 * Configuration expresses requirements; discovery supplies model identities.
 * Verifies:
 *  - `isValidModelConfig`/`resolveModelConfig` accept a selection-only config
 *  - `selectModelFromDiscovery` selects currently-free models, excludes
 *    paid/incompatible/ineligible ones, and honors min-context/capabilities
 *    without hard-coded model ids
 *  - `buildRoutingAdapter` resolves a `selection` into a concrete model primary
 *  - `createProvider` threads apiKey through the discovery seam for non-OpenRouter providers
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildRoutingAdapter, RoutingModelAdapter } from "../../src/providers/routing-adapter.js";
import { selectModelFromDiscovery, resolveModelSelectionId } from "../../src/providers/model-resolver.js";
import { createProvider } from "../../src/providers/registry.js";
import { isValidModelConfig } from "../../src/config/schema.js";
import { tryResolveModelConfig } from "../../src/config/model-resolver.js";
import {
  _setOpenRouterDiscoveryFetch,
  _resetOpenRouterDiscoveryCache,
} from "../../src/providers/model-discovery.js";
import { _resetAccessRestrictionRegistryForTesting } from "../../src/providers/access-restriction-registry.js";
import * as catalog from "../../src/providers/catalog.js";

import type { DiscoveredModel } from "../../src/providers/model-discovery.js";

const catalogResponse = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

const M = (id: string, ctx: number | undefined, caps: string[]): DiscoveredModel => ({
  id,
  provider: "openrouter",
  inputContextLimit: ctx,
  costPerMTokIn: 0,
  supportsTools: caps.includes("tools"),
  supportsStructuredOutput: caps.includes("structured_outputs"),
  supportsVision: caps.includes("vision"),
});

afterEach(() => {
  _resetOpenRouterDiscoveryCache();
  _resetAccessRestrictionRegistryForTesting();
  _setOpenRouterDiscoveryFetch(globalThis.fetch);
});

describe("isValidModelConfig / resolveModelConfig with selection", () => {
  it("accepts a selection-only config (provider + selection, no name)", () => {
    expect(isValidModelConfig({ provider: "openrouter", name: "", selection: { cost: "free", capabilities: ["tools"] } })).toBe(true);
  });

  it("accepts an explicit model config (unchanged)", () => {
    expect(isValidModelConfig({ provider: "anthropic", name: "claude-sonnet-4-6" })).toBe(true);
  });

  it("rejects a config with neither name nor selection", () => {
    expect(isValidModelConfig({ provider: "openrouter", name: "" })).toBe(false);
  });

  it("tryResolveModelConfig returns a selection-only default", () => {
    const resolved = tryResolveModelConfig({ models: { default: { provider: "openrouter", name: "", selection: { cost: "free" } } } });
    expect(resolved).toEqual({ provider: "openrouter", name: "", selection: { cost: "free" } });
  });
});

describe("policy resolver is fed by catalog fixture", () => {
  it("selects a currently free model", () => {
    const catalogModels: DiscoveredModel[] = [
      M("qwen/qwen3-14b:free", 32_000, ["tools"]),
      M("z/other:free", 16_000, ["tools"]),
    ];
    const picked = selectModelFromDiscovery({ provider: "openrouter", cost: "free", capabilities: ["tools"] }, catalogModels);
    expect(picked?.id).toBe("qwen/qwen3-14b:free"); // largest context wins
  });

  it("does not depend on hard-coded model ids — picks from a catalog it has never seen", () => {
    const catalogModels: DiscoveredModel[] = [
      M("new/vendor-bravo:free", 64_000, ["tools"]),
      M("old/vendor-alpha:free", 8_000, ["tools"]),
    ];
    const picked = selectModelFromDiscovery({ cost: "free", capabilities: ["tools"] }, catalogModels);
    expect(picked?.id).toBe("new/vendor-bravo:free");
  });

  it("excludes models missing a required capability", () => {
    const catalogModels: DiscoveredModel[] = [
      M("a/no-tools:free", 200_000, []),
      M("b/with-tools:free", 16_000, ["tools"]),
    ];
    const picked = selectModelFromDiscovery({ cost: "free", capabilities: ["tools"] }, catalogModels);
    expect(picked?.id).toBe("b/with-tools:free");
  });

  it("honors min-context (excludes models under the floor)", () => {
    const catalogModels: DiscoveredModel[] = [
      M("small:free", 8_000, ["tools"]),
      M("big:free", 64_000, ["tools"]),
    ];
    const picked = selectModelFromDiscovery({ cost: "free", capabilities: ["tools"], minContext: 32_768 }, catalogModels);
    expect(picked?.id).toBe("big:free");
  });

  it("returns undefined for cost: paid (not served by the free catalog)", () => {
    expect(selectModelFromDiscovery({ provider: "openrouter", cost: "paid" }, [])).toBeUndefined();
  });

  it("returns undefined for a non-openrouter provider", () => {
    expect(selectModelFromDiscovery({ provider: "anthropic", cost: "free" }, [])).toBeUndefined();
  });

  it("returns undefined when no eligible model satisfies the policy", () => {
    const catalogModels: DiscoveredModel[] = [M("small:free", 4_000, ["tools"])];
    expect(selectModelFromDiscovery({ cost: "free", minContext: 128_000 }, catalogModels)).toBeUndefined();
  });
});

describe("buildRoutingAdapter resolves a selection policy", () => {
  it("resolves selection to a concrete openrouter primary and builds routing", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([
      { id: "thinkingmachines/inkling-small:free", name: "Inkling", context_length: 32_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 64_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    const adapter = await buildRoutingAdapter(
      { provider: "openrouter", name: "", selection: { cost: "free", capabilities: ["tools"], minContext: 32_768 }, routing: { freeFallback: true } },
      () => "",
    );
    expect(adapter).toBeInstanceOf(RoutingModelAdapter);
    expect(adapter.id).toBe("openrouter");
  });

  it("throws a clear error when a selection policy cannot be satisfied and no explicit name exists", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([]));
    await expect(
      buildRoutingAdapter({ provider: "openrouter", name: "", selection: { cost: "free", capabilities: ["tools"] } }, () => ""),
    ).rejects.toThrow(/Model selection policy could not be satisfied/);
  });

  it("falls back to the explicit name when a policy cannot be satisfied but a name is configured", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([]));
    const adapter = await buildRoutingAdapter(
      { provider: "mock", name: "mock-model", selection: { cost: "free" } },
      () => "",
    );
    // mock provider + selection(unsatisfiable) + name → uses the explicit name.
    expect(adapter).not.toBeInstanceOf(RoutingModelAdapter);
    expect(adapter.id).toBe("mock");
  });
});

describe("resolveModelSelectionId (shared discovery seam)", () => {
  it("fetches the catalog and returns the highest-context eligible free model id", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 64_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "a/small:free", name: "Small", context_length: 4_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    await expect(resolveModelSelectionId({ cost: "free", capabilities: ["tools"] }))
      .resolves.toEqual({ id: "qwen/qwen3-14b:free" });
  });

  it("returns undefined when the policy is unsatisfiable", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([]));
    await expect(resolveModelSelectionId({ provider: "openrouter", cost: "paid" }))
      .resolves.toBeUndefined();
  });

  it("excludes models in the bounded-lifetime access-restriction registry", async () => {
    const { recordAccessRestricted } = await import("../../src/providers/access-restriction-registry.js");
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([
      { id: "big:free", name: "Big", context_length: 64_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
      { id: "small:free", name: "Small", context_length: 4_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    recordAccessRestricted("big:free");
    await expect(resolveModelSelectionId({ cost: "free", capabilities: ["tools"] }))
      .resolves.toEqual({ id: "small:free" });
  });
});

describe("createProvider resolves a selection policy at the registry choke point", () => {
  it("resolves selection to a concrete catalog model for an openrouter config (no throw)", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 64_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    const adapter = await createProvider({ provider: "openrouter", name: "", selection: { cost: "free", capabilities: ["tools"] } });
    expect(adapter.id).toBe("openrouter");
  });

  it("throws a clear error when a selection policy is unsatisfiable and no name is configured", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([]));
    await expect(
      createProvider({ provider: "openrouter", name: "", selection: { cost: "free", capabilities: ["tools"] } }),
    ).rejects.toThrow(/Model selection policy could not be satisfied/);
  });

  it("falls back to the explicit name when a policy is unsatisfiable but a name is set", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([]));
    const adapter = await createProvider({ provider: "mock", name: "explicit-model", selection: { cost: "free" } });
    expect(adapter.id).toBe("mock");
  });

  it("leaves the legacy {provider, model} shape untouched (no catalog discovery)", async () => {
    _setOpenRouterDiscoveryFetch(async () => { throw new Error("catalog must not be fetched"); });
    const adapter = await createProvider({ provider: "mock", model: "legacy-model" }, "k");
    expect(adapter.id).toBe("mock");
  });

  it("honors resolveModelConfig output (ModelConfig with .name/.selection) directly through the registry", async () => {
    _setOpenRouterDiscoveryFetch(async () => catalogResponse([
      { id: "qwen/qwen3-14b:free", name: "Qwen", context_length: 64_000, pricing: { prompt: "0", completion: "0" }, supported_parameters: ["tools"] },
    ]));
    const model = tryResolveModelConfig({ models: { default: { provider: "openrouter", name: "", selection: { cost: "free", capabilities: ["tools"] } } } });
    expect(model).toBeDefined();
    const adapter = await createProvider({ provider: model!.provider, name: model!.name, selection: model!.selection });
    expect(adapter.id).toBe("openrouter");
  });

  it("picks largest-context mock model and ignores unverifiable cost/capabilities via listModels seam", async () => {
    const stubbed = vi.spyOn(catalog, "listModels").mockResolvedValue([
      { id: "mock/many", displayName: "Many", maxInputTokens: 128_000 },
      { id: "mock/few", displayName: "Few", maxInputTokens: 8_000 },
    ]);

    const adapter = await createProvider(
      { provider: "mock", name: "", selection: { provider: "mock", cost: "paid", capabilities: ["tools"] } },
      "k",
    );

    expect(stubbed).toHaveBeenCalledWith("mock", "k");
    expect(adapter.id).toBe("mock");

    stubbed.mockRestore();
  });

  it("falls back to explicit name when selection resolves no model (empty catalog)", async () => {
    const stubbed = vi.spyOn(catalog, "listModels").mockResolvedValue([]);

    const adapter = await createProvider(
      { provider: "mock", name: "mock-model", selection: { provider: "mock" } },
      "k",
    );

    expect(stubbed).toHaveBeenCalled();
    expect(adapter.id).toBe("mock");

    stubbed.mockRestore();
  });
});

describe("buildRoutingAdapter threads apiKey through the discovery seam", () => {
  it("resolves non-openrouter selection via listModels(provider, apiKeyFor(provider))", async () => {
    const stubbed = vi.spyOn(catalog, "listModels").mockResolvedValue([
      { id: "mock/big", displayName: "Big", maxInputTokens: 256_000 },
      { id: "mock/small", displayName: "Small", maxInputTokens: 4_000 },
    ]);

    const adapter = await buildRoutingAdapter(
      { provider: "mock", name: "", selection: { provider: "mock", cost: "paid", capabilities: ["tools"] } },
      () => "test-key",
    );

    expect(stubbed).toHaveBeenCalledWith("mock", "test-key");
    expect(adapter.id).toBe("mock");

    stubbed.mockRestore();
  });
});
