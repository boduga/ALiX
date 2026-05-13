import test from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "../src/providers/mock-provider.js";

test("mock provider returns a deterministic plan", async () => {
  const provider = new MockProvider();
  const response = await provider.complete({
    systemPrompt: "You are ALiX.",
    messages: [{ role: "user", content: "fix tests" }]
  });
  assert.match(response.text, /Plan:/);
  assert.match(response.text, /fix tests/);
  assert.deepEqual(response.toolCalls, []);
});
