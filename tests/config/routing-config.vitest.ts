import { describe, it, expect } from "vitest";
import { buildRoutingAdapter } from "../../src/providers/routing-adapter.js";
import { RoutingModelAdapter } from "../../src/providers/routing-adapter.js";

describe("buildRoutingAdapter", () => {
  it("no routing → plain provider, not a RoutingModelAdapter (offline-safe)", async () => {
    const adapter = await buildRoutingAdapter(
      { provider: "mock", name: "mock-model" },
      () => "",
    );
    expect(adapter).not.toBeInstanceOf(RoutingModelAdapter);
    expect(adapter.id).toBe("mock");
  });

  it("openrouter + freeFallback → RoutingModelAdapter", async () => {
    const adapter = await buildRoutingAdapter(
      { provider: "openrouter", name: "openai/gpt-4o", routing: { freeFallback: true } },
      () => "",
    );
    expect(adapter).toBeInstanceOf(RoutingModelAdapter);
  });

  it("explicit fallbacks → RoutingModelAdapter with ordered candidates", async () => {
    const adapter = await buildRoutingAdapter(
      {
        provider: "openrouter",
        name: "openai/gpt-4o",
        routing: { fallbacks: [{ provider: "openrouter", name: "qwen/qwen3-14b:free" }] },
      },
      () => "",
    );
    expect(adapter).toBeInstanceOf(RoutingModelAdapter);
  });

  it("freeFallback only applies to openrouter primary", async () => {
    const adapter = await buildRoutingAdapter(
      { provider: "mock", name: "mock-model", routing: { freeFallback: true } },
      () => "",
    );
    expect(adapter).not.toBeInstanceOf(RoutingModelAdapter);
  });
});