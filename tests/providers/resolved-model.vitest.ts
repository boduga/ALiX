import { describe, it, expect } from "vitest";
import { openrouterSpec } from "../../src/providers/specs/openrouter-spec.js";
import { complete, stream, _setFetchForTesting } from "../../src/providers/unified-complete.js";
import { streamToResponse } from "../../src/run/helpers.js";
import type { ModelAdapter, NormalizedRequest } from "../../src/providers/types.js";

const req: NormalizedRequest = { systemPrompt: "s", messages: [{ role: "user", content: "hi" }] };

describe("resolved-model capture", () => {
  it("openrouterSpec.resolveModel reads res.model", () => {
    expect(openrouterSpec.resolveModel?.({ model: "qwen/qwen3-14b:free", choices: [] })).toBe("qwen/qwen3-14b:free");
    expect(openrouterSpec.resolveModel?.({})).toBeUndefined();
  });

  it("complete() attaches resolvedModel when the spec provides one", async () => {
    _setFetchForTesting(async () => new Response(JSON.stringify({
      model: "qwen/qwen3-14b:free",
      choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      const res = await complete("openrouter", "openrouter/free", req, { apiKey: "k" });
      expect(res.resolvedModel).toBe("qwen/qwen3-14b:free");
    } finally {
      _setFetchForTesting(globalThis.fetch);
    }
  });

  it("stream() emits done with resolvedModel sniffed from SSE lines", async () => {
    const lines = [
      'data: {"id":"x","model":"qwen/qwen3-14b:free","choices":[{"delta":{"content":"hi"}}]}',
      'data: {"id":"x","model":"qwen/qwen3-14b:free","choices":[{"delta":{},"finish_reason":"stop"}]}',
      "data: [DONE]",
    ];
    _setFetchForTesting(async () => new Response(lines.join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    try {
      const chunks = [];
      for await (const c of stream("openrouter", "openrouter/free", req, { apiKey: "k" })) chunks.push(c);
      const done = chunks.find((c) => c.type === "done");
      expect(done).toEqual({ type: "done", resolvedModel: "qwen/qwen3-14b:free" });
    } finally {
      _setFetchForTesting(globalThis.fetch);
    }
  });

  it("streamToResponse surfaces resolvedModel from the done chunk", async () => {
    const fake: ModelAdapter = {
      id: "openrouter",
      editFormatPreference: "search_replace",
      longContextStrategy: "trimmed_context",
      capabilities: { provider: "openrouter", model: "openrouter/free", inputTokenLimit: 200_000, outputTokenLimit: 8192, supportsTools: true, supportsStreaming: true, supportsStructuredOutput: true, supportsVision: true,
      parallelToolCalls: false
},
      complete: async () => ({ text: "", toolCalls: [] }),
      stream: async function* () {
        yield { type: "text_delta", text: "hi" };
        yield { type: "done", resolvedModel: "qwen/qwen3-14b:free" };
      },
    };
    const out = await streamToResponse(fake, req);
    expect(out.resolvedModel).toBe("qwen/qwen3-14b:free");
  });
});