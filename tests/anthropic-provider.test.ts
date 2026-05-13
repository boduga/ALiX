import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../src/providers/anthropic-provider.js";

test("anthropic provider returns correct capabilities", () => {
  const provider = new AnthropicProvider({ apiKey: "test-key" });
  assert.equal(provider.id, "anthropic");
  assert.equal(provider.capabilities.provider, "anthropic");
  assert.equal(provider.capabilities.model, "claude-sonnet-4-7-20250514");
  assert.equal(provider.capabilities.supportsTools, true);
  assert.equal(provider.capabilities.supportsVision, true);
  assert.equal(provider.editFormatPreference, "structured_patch");
  assert.equal(provider.longContextStrategy, "trimmed_context");
});

test("anthropic provider requires API key", async () => {
  const provider = new AnthropicProvider({ apiKey: "" });
  await assert.rejects(() => provider.complete({ systemPrompt: "", messages: [] }), /ANTHROPIC_API_KEY/);
});

test("anthropic provider accepts config overrides", () => {
  const provider = new AnthropicProvider({ apiKey: "my-key", model: "claude-3-5-sonnet", maxTokens: 2048 });
  assert.equal(provider.capabilities.model, "claude-3-5-sonnet");
  assert.equal(provider.capabilities.outputTokenLimit, 8192); // default, aligns with maxTokens default
});