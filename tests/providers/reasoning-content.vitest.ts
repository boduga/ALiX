// tests/providers/reasoning-content.vitest.ts
// Reasoning models (e.g. DeepSeek deepseek-v4-flash) emit `reasoning_content`
// in both non-streaming and streaming responses. The OpenAI-base spec must
// surface it as `reasoning` (non-streaming) / `reasoning_delta` chunks
// (streaming) so long thought-phases keep the stream alive instead of
// tripping the stream idle timeout, without polluting the final text.
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";
import { deepseekSpec } from "../../src/providers/specs/deepseek-spec.js";
import { validateStreamChunk } from "../../src/providers/provider-contract-validation.js";
import { validateNormalizedResponse } from "../../src/providers/provider-contract-validation.js";

const reasoningDelta = (text: string, content?: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: text, ...(content === undefined ? {} : { content }) } }] })}`;

describe("openaiBaseSpec reasoning_content", () => {
  it("fromResponse surfaces reasoning_content as reasoning (not text)", () => {
    const resp = openaiBaseSpec.fromResponse({
      choices: [{
        message: { content: "Final answer", reasoning_content: "Let me think..." },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 25 },
    });
    assert.equal(resp.text, "Final answer");
    assert.equal(resp.reasoning, "Let me think...");
  });

  it("fromResponse omits reasoning when absent", () => {
    const resp = openaiBaseSpec.fromResponse({
      choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
    });
    assert.equal(resp.reasoning, undefined);
  });

  it("fromStreamChunk yields reasoning_delta before content on the same line", () => {
    const chunk = openaiBaseSpec.fromStreamChunk(reasoningDelta("thinking...", "answer"));
    assert.deepEqual(chunk, { type: "reasoning_delta", text: "thinking..." });
  });

  it("fromStreamChunk yields reasoning_delta for reasoning-only lines", () => {
    const chunk = openaiBaseSpec.fromStreamChunk(reasoningDelta("thinking..."));
    assert.deepEqual(chunk, { type: "reasoning_delta", text: "thinking..." });
  });

  it("fromStreamChunk still yields text_delta for content-only lines", () => {
    const chunk = openaiBaseSpec.fromStreamChunk(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "answer" } }] })}`,
    );
    assert.deepEqual(chunk, { type: "text_delta", text: "answer" });
  });

  it("deepseekSpec inherits reasoning_content handling", () => {
    assert.deepEqual(
      deepseekSpec.fromStreamChunk(reasoningDelta("thinking...")),
      { type: "reasoning_delta", text: "thinking..." },
    );
    const resp = deepseekSpec.fromResponse({
      choices: [{ message: { content: "ok", reasoning_content: "hmm" }, finish_reason: "stop" }],
    });
    assert.equal(resp.reasoning, "hmm");
  });
});

describe("reasoning chunks pass contract validation", () => {
  it("reasoning_delta satisfies StreamChunkSchema", () => {
    const chunk = validateStreamChunk({ type: "reasoning_delta", text: "thinking..." });
    assert.deepEqual(chunk, { type: "reasoning_delta", text: "thinking..." });
  });

  it("reasoning on NormalizedResponse satisfies NormalizedResponseSchema", () => {
    const resp = validateNormalizedResponse({
      text: "answer",
      reasoning: "thoughts",
      toolCalls: [],
    });
    assert.equal(resp.reasoning, "thoughts");
  });
});