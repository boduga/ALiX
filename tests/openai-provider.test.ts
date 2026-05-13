import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIProvider } from "../src/providers/openai-provider.js";

test("openai provider returns correct capabilities", () => {
  const provider = new OpenAIProvider({ apiKey: "test" });
  assert.equal(provider.id, "openai");
  assert.equal(provider.capabilities.provider, "openai");
  assert.equal(provider.capabilities.model, "gpt-4o");
  assert.ok(provider.capabilities.supportsTools);
  assert.equal(provider.editFormatPreference, "search_replace");
  assert.equal(provider.longContextStrategy, "trimmed_context");
});

test("openai provider accepts config overrides", () => {
  const provider = new OpenAIProvider({ apiKey: "test", model: "gpt-4o-mini", maxTokens: 4096 });
  assert.equal(provider.capabilities.model, "gpt-4o-mini");
  assert.equal(provider.capabilities.outputTokenLimit, 4096);
});

test("openai provider requires API key", async () => {
  const provider = new OpenAIProvider({ apiKey: "" });
  await assert.rejects(() => provider.complete({
    systemPrompt: "",
    messages: [{ role: "user", content: "hi" }]
  }), /OPENAI_API_KEY/);
});