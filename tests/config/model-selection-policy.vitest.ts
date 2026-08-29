/**
 * model-selection-policy.vitest.ts — Policy-based model selection (Phase 2).
 *
 * Configuration expresses requirements; discovery supplies model identities.
 * Verifies:
 *  - `isValidModelConfig`/`resolveModelConfig` accept a selection-only config
 *  - `resolveModelBySelectionPolicy` selects currently-free models, excludes
 *    paid/incompatible/ineligible ones, and honors min-context/capabilities
 *    without hard-coded model ids
 *  - `buildRoutingAdapter` resolves a `selection` into a concrete model primary
 */

import { describe, it, expect, afterEach } from "vitest";
import { buildRoutingAdapter, RoutingModelAdapter } from "../../src/providers/routing-adapter.js";
import { resolveModelBySelectionPolicy } from "../../src/providers/free-model-resolver.js";
import { isValidModelConfig } from "../../src/config/schema.js";
import { tryResolveModelConfig } from "../../src/config/model-resolver.js";
import {
  _setCatalogFetchForTesting,
  _resetCatalogCacheForTesting,
} from "../../src/providers/free-model-catalog.js";
import { _resetAccessRestrictionRegistryForTesting } from "../../src/providers/access-restriction-registry.js";

import type { FreeModelInfo } from "../../src/providers/free-model-catalog.js";

const catalog = (models: unknown[]) => new Response(JSON.stringify({ data: models }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

const M = (id: string, ctx: number | undefined, caps: string[]): FreeModelInfo => ({
  id,
  name: id,
  inputTokenLimit: ctx,
  supportsTools: caps.includes("tools"),
  supportsStructuredOutput: caps.includes("structured_outputs"),
  supportsVision: caps.includes("vision"),
});

afterEach(() => {
  _resetCatalogCacheForTesting();
  _resetAccessRestrictionRegistryForTesting();
  _setCatalogFetchForTesting(globalThis.fetch);
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
    const catalogModels: FreeModelInfo[] = [
      M("qwen/qwen3-14b:free", 32_000, ["tools"]),
      M("z/other:free", 16_000, ["tools"]),
    ];
    const picked = resolveModelBySelectionPolicy({ provider: "openrouter", cost: "free", capabilities: ["tools"] }, catalogModels);
    expect(picked?.id).toBe("qwen/qwen3-14b:free"); // largest context wins
  });

  it("does not depend on hard-coded model ids — picks from a catalog it has never seen", () => {
    const catalogModels: FreeModelInfo[] = [
      M("new/vendor-bravo:free", 64_000, ["tools"]),
      M("old/vendor-alpha:free", 8_000, ["tools"]),
    ];
    const picked = resolveModelBySelectionPolicy({ cost: "free", capabilities: ["tools"] }, catalogModels);
    expect(picked?.id).toBe("new/vendor-bravo:free");
  });

  it("excludes models missing a required capability", () => {
    const catalogModels: FreeModelInfo[] = [
      M("a/no-tools:free", 200_000, []),
      M("b/with-tools:free", 16_000, ["tools"]),
    ];
    const picked = resolveModelBySelectionPolicy({ cost: "free", capabilities: ["tools"] }, catalogModels);
    expect(picked?.id).toBe("b/with-tools:free");
  });

  it("honors min-context (excludes models under the floor)", () => {
    const catalogModels: FreeModelInfo[] = [
      M("small:free", 8_000, ["tools"]),
      M("big:free", 64_000, ["tools"]),
    ];
    const picked = resolveModelBySelectionPolicy({ cost: "free", capabilities: ["tools"], minContext: 32_768 }, catalogModels);
    expect(picked?.id).toBe("big:free");
  });

  it("returns undefined for cost: paid (not served by the free catalog)", () => {
    expect(resolveModelBySelectionPolicy({ provider: "openrouter", cost: "paid" }, [])).toBeUndefined();
  });

  it("returns undefined for a non-openrouter provider", () => {
    expect(resolveModelBySelectionPolicy({ provider: "anthropic", cost: "free" }, [])).toBeUndefined();
  });

  it("returns undefined when no eligible model satisfies the policy", () => {
    const catalogModels: FreeModelInfo[] = [M("small:free", 4_000, ["tools"])];
    expect(resolveModelBySelectionPolicy({ cost: "free", minContext: 128_000 }, catalogModels)).toBeUndefined();
  });
});

describe("buildRoutingAdapter resolves a selection policy", () => {
  it("resolves selection to a concrete openrouter primary and builds routing", async () => {
    _setCatalogFetchForTesting(async () => catalog([
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
    _setCatalogFetchForTesting(async () => catalog([]));
    await expect(
      buildRoutingAdapter({ provider: "openrouter", name: "", selection: { cost: "free", capabilities: ["tools"] } }, () => ""),
    ).rejects.toThrow(/Model selection policy could not be satisfied/);
  });

  it("falls back to the explicit name when a policy cannot be satisfied but a name is configured", async () => {
    _setCatalogFetchForTesting(async () => catalog([]));
    const adapter = await buildRoutingAdapter(
      { provider: "mock", name: "mock-model", selection: { cost: "free" } },
      () => "",
    );
    // mock provider + selection(unsatisfiable) + name → uses the explicit name.
    expect(adapter).not.toBeInstanceOf(RoutingModelAdapter);
    expect(adapter.id).toBe("mock");
  });
});
