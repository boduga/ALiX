// tests/providers/_openai-base.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";

describe("openaiBaseSpec.toRequestBody", () => {
  it("maps system prompt to system message", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "You are helpful",
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-4o",
    });
    assert.equal((body as any).messages[0].role, "system");
    assert.equal((body as any).messages[0].content, "You are helpful");
  });

  it("maps user/assistant messages preserving order", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "",
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ],
      model: "gpt-4o",
    });
    const msgs = (body as any).messages;
    assert.equal(msgs[0].content, "first");
    assert.equal(msgs[1].content, "reply");
    assert.equal(msgs[2].content, "second");
  });

  it("includes tools when provided", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "",
      messages: [],
      model: "gpt-4o",
      tools: [{
        name: "file.read",
        description: "Read a file",
        input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      }],
    });
    assert.equal((body as any).tools[0].function.name, "file.read");
  });

  it("includes model in body", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "gpt-4o-mini",
    });
    assert.equal((body as any).model, "gpt-4o-mini");
  });

  it("includes stream flag when set", () => {
    const body = openaiBaseSpec.toRequestBody({
      systemPrompt: "", messages: [], model: "gpt-4o", stream: true,
    });
    assert.equal((body as any).stream, true);
  });
});