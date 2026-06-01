import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleSpec } from "../../src/providers/specs/google-spec.js";

describe("googleSpec.toRequestBody", () => {
  it("uses Gemini's contents/parts format", () => {
    const body = googleSpec.toRequestBody({
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
      model: "gemini-2.5-flash",
    });
    assert.deepEqual((body as any).contents[0].parts[0], { text: "hi" });
    assert.equal((body as any).contents[0].role, "user");
  });

  it("puts system instruction in systemInstruction field", () => {
    const body = googleSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [],
      model: "gemini-2.5-flash",
    });
    assert.equal((body as any).systemInstruction.parts[0].text, "You are helpful");
  });

  it("maps tools to functionDeclarations", () => {
    const body = googleSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "gemini-2.5-flash",
      tools: [{
        name: "file.read",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }],
    });
    const decl = (body as any).tools[0].functionDeclarations[0];
    assert.equal(decl.name, "file.read");
  });
});

describe("googleSpec.fromResponse", () => {
  it("extracts text from candidates[0].content.parts", () => {
    const resp = googleSpec.fromResponse({
      candidates: [{
        content: { parts: [{ text: "hello" }], role: "model" },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    assert.equal(resp.text, "hello");
    assert.equal(resp.usage?.outputTokens, 5);
    assert.equal(resp.finishReason, "STOP");
  });

  it("extracts functionCall as toolCalls", () => {
    const resp = googleSpec.fromResponse({
      candidates: [{
        content: {
          parts: [
            { functionCall: { name: "file.read", args: { path: "/x" } } },
          ],
          role: "model",
        },
      }],
    });
    assert.equal(resp.toolCalls[0].name, "file.read");
    assert.deepEqual(resp.toolCalls[0].args, { path: "/x" });
  });
});

describe("googleSpec.authHeader", () => {
  it("uses x-goog-api-key (not Authorization)", () => {
    const headers = googleSpec.authHeader("gem-key-123");
    assert.equal(headers["x-goog-api-key"], "gem-key-123");
  });
});
