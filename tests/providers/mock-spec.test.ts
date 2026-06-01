import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockSpec } from "../../src/providers/specs/mock-spec.js";

describe("mockSpec.fromResponse", () => {
  it("echoes input back as text", () => {
    const resp = mockSpec.fromResponse({ input: "hello", text: "mocked response" });
    assert.equal(resp.text, "mocked response");
  });
});

describe("mockSpec.toRequestBody", () => {
  it("preserves all input fields as-is (no transformation)", () => {
    const input = { systemPrompt: "x", messages: [{ role: "user" as const, content: "y" }], model: "mock" };
    const body = mockSpec.toRequestBody(input);
    assert.deepEqual(body, input);
  });
});
