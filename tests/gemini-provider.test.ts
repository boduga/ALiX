import test from "node:test";
import assert from "node:assert/strict";
import { GeminiProvider } from "../src/providers/gemini-provider.js";

test("gemini provider returns correct capabilities", () => {
  const provider = new GeminiProvider({ apiKey: "test" });
  assert.equal(provider.id, "gemini");
  assert.equal(provider.capabilities.provider, "gemini");
  assert.equal(provider.capabilities.model, "gemini-2.0-flash");
  assert.ok(provider.capabilities.supportsVision);
  assert.equal(provider.longContextStrategy, "expanded_context");
  assert.equal(provider.editFormatPreference, "search_replace");
  assert.equal(provider.capabilities.inputTokenLimit, 1_000_000);
});

test("gemini provider accepts config overrides", () => {
  const provider = new GeminiProvider({ apiKey: "test", model: "gemini-1.5-pro", maxTokens: 4096 });
  assert.equal(provider.capabilities.model, "gemini-1.5-pro");
});

test("gemini provider requires API key", async () => {
  const provider = new GeminiProvider({ apiKey: "" });
  await assert.rejects(() => provider.complete({
    systemPrompt: "",
    messages: [{ role: "user", content: "hi" }]
  }), /GEMINI_API_KEY/);
});
