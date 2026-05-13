import test from "node:test";
import assert from "node:assert/strict";
import { AnthropicProvider } from "../src/providers/anthropic-provider.js";

test("complete returns token usage", async () => {
  if (!process.env.ANTHROPIC_API_KEY) return; // skip without key
  const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await provider.complete({
    systemPrompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "Say hello in one word." }]
  });
  assert.ok(response.usage, "should return usage");
  assert.ok(response.usage!.inputTokens > 0, "should count input tokens");
  assert.ok(response.usage!.outputTokens > 0, "should count output tokens");
});

test("complete injects toolResults as user messages", async () => {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await provider.complete({
    systemPrompt: "You have tools.",
    messages: [{ role: "user", content: "test" }],
    toolResults: [{ toolUseId: "abc", content: "tool output here" }]
  });
  assert.ok(response.text !== undefined);
});

test("complete returns finishReason", async () => {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await provider.complete({
    systemPrompt: "Answer briefly.",
    messages: [{ role: "user", content: "What is 1+1?" }]
  });
  assert.ok(response.finishReason, "should return finishReason");
});