// tests/providers/finish-reason.vitest.ts
// Output-budget truncation (finish_reason=length) must be surfaced end-to-end:
// the OpenAI-base spec parses the terminal `finish_reason` into the done chunk
// (streaming) and `finishReason` (non-streaming), the routing adapter preserves
// it when injecting resolvedModel, and streamToResponse threads it so callers
// can detect a silently truncated answer.
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";
import { deepseekSpec } from "../../src/providers/specs/deepseek-spec.js";

describe("openaiBaseSpec finish_reason", () => {
  it("fromResponse surfaces finish_reason as finishReason", () => {
    const resp = openaiBaseSpec.fromResponse({
      choices: [{ message: { content: "partial" }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 50 },
    });
    assert.equal(resp.finishReason, "length");
  });

  it("fromStreamChunk yields a done chunk with finishReason on the terminal line", () => {
    const chunk = openaiBaseSpec.fromStreamChunk(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}`,
    );
    assert.deepEqual(chunk, { type: "done", finishReason: "length" });
  });

  it("fromStreamChunk reports done with no finishReason when the sentinel arrives without one", () => {
    assert.deepEqual(openaiBaseSpec.fromStreamChunk("data: [DONE]"), { type: "done" });
  });

  it("deepseekSpec inherits finish_reason handling", () => {
    const resp = deepseekSpec.fromResponse({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
    assert.equal(resp.finishReason, "stop");
    assert.deepEqual(
      deepseekSpec.fromStreamChunk(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}`,
      ),
      { type: "done", finishReason: "length" },
    );
  });
});