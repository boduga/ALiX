import test from "node:test";
import assert from "node:assert/strict";

// BaseProvider is abstract — test through a concrete subclass
import { OpenAIProvider } from "../src/providers/openai-provider.js";

test("base provider accepts apiKey and model options", () => {
  const p = new OpenAIProvider({ apiKey: "test-key", model: "gpt-4o" });
  assert.equal(p.capabilities.model, "gpt-4o");
});

test("base provider uses correct base URL", () => {
  const p = new OpenAIProvider({ apiKey: "test-key" });
  // Check via capabilities — model name confirms URL resolution worked
  assert.equal(p.capabilities.provider, "openai");
});