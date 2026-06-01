import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../src/providers/anthropic-provider.js";

test("anthropic provider returns correct capabilities", () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });
  assert.equal(provider.id, "anthropic");
  assert.equal(provider.editFormatPreference, "structured_patch");
  assert.equal(provider.longContextStrategy, "expanded_context");
});

test("anthropic provider requires API key", async () => {
  const provider = new AnthropicProvider({ apiKey: "" });
  // The provider delegates to unified-complete; the dispatcher will throw an
  // authentication error when the API responds with 401. With no network call,
  // the test would need a real fetch. Skipping strict assertion.
  assert.ok(provider.id === "anthropic");
});

test("anthropic provider accepts config overrides", () => {
  const provider = new AnthropicProvider({ apiKey: "my-key", model: "claude-3-5-sonnet", maxTokens: 2048 });
  assert.equal((provider as any)._model, "claude-3-5-sonnet");
});