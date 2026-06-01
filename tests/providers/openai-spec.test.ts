import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openaiSpec } from "../../src/providers/specs/openai-spec.js";

describe("openaiSpec", () => {
  it("uses OpenAI's base URL", () => {
    assert.equal(openaiSpec.baseUrl, "https://api.openai.com/v1/chat/completions");
  });
  it("uses Bearer auth", () => {
    const headers = openaiSpec.authHeader("sk-test-123");
    assert.equal(headers.Authorization, "Bearer sk-test-123");
  });
});
