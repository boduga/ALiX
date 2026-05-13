import test from "node:test";
import assert from "node:assert/strict";
import { createProvider, listProviders } from "../src/providers/registry.js";

test("createProvider returns MockProvider for mock", () => {
  const provider = createProvider({ provider: "mock" });
  assert.equal(provider.id, "mock");
});

test("createProvider returns AnthropicProvider for anthropic", () => {
  const provider = createProvider({ provider: "anthropic", name: "claude-sonnet-4-6" }, "test-key");
  assert.equal(provider.id, "anthropic");
});

test("createProvider returns OpenAIProvider for openai", () => {
  const provider = createProvider({ provider: "openai", name: "gpt-4o" }, "test-key");
  assert.equal(provider.id, "openai");
});

test("createProvider returns GeminiProvider for gemini", () => {
  const provider = createProvider({ provider: "gemini", name: "gemini-2.0-flash" }, "test-key");
  assert.equal(provider.id, "gemini");
});

test("createProvider throws on unknown provider", () => {
  assert.throws(() => createProvider({ provider: "unknown" } as any, "key"), /Unknown provider/);
});

test("listProviders returns all providers", () => {
  const providers = listProviders();
  assert.ok(providers.includes("mock"));
  assert.ok(providers.includes("anthropic"));
  assert.ok(providers.includes("openai"));
  assert.ok(providers.includes("gemini"));
});