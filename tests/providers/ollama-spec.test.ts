import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ollamaSpec } from "../../src/providers/specs/ollama-spec.js";

describe("ollamaSpec.toRequestBody", () => {
  it("uses Ollama's generate endpoint shape", () => {
    const body = ollamaSpec.toRequestBody({
      systemPrompt: "", messages: [{ role: "user", content: "hi" }], model: "llama3.2",
    });
    assert.equal((body as any).model, "llama3.2");
    assert.equal((body as any).prompt, "hi");
  });

  it("includes system prompt as separate field when present", () => {
    const body = ollamaSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      model: "llama3.2",
    });
    assert.equal((body as any).system, "You are helpful");
  });
});

describe("ollamaSpec.fromResponse", () => {
  it("extracts text from response field", () => {
    const resp = ollamaSpec.fromResponse({
      response: "hello there", done: true, model: "llama3.2",
    });
    assert.equal(resp.text, "hello there");
  });
});

describe("ollamaSpec.authHeader", () => {
  it("returns empty headers (no auth needed for local)", () => {
    const headers = ollamaSpec.authHeader("");
    assert.deepEqual(headers, {});
  });
});
