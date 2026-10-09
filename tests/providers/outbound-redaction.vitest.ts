/**
 * R5.1 — outbound (egress) redaction gate.
 *
 * Provider-bound prompts embed memory/repomap content. The gate redacts
 * secrets before any remote adapter sees the request; local providers are
 * exempt. Fail-closed: an unknown provider id is treated as remote.
 */
import { describe, expect, it } from "vitest";
import type { ModelAdapter, NormalizedRequest, StreamChunk } from "../../src/models/providers/types.js";
import { withProviderContracts } from "../../src/models/providers/provider-contract-validation.js";
import { isLocalProvider, isRemoteProvider } from "../../src/models/providers/provider-locality.js";
import { redactOutboundRequest } from "../../src/models/providers/outbound-redaction.js";

/** A string the security detector classifies as an api_key. */
const SECRET = "sk-abcdefghijklmnopqrstuvwxyz123456";

describe("provider locality (R5.1)", () => {
  it("treats known local providers (and the eval mock) as local", () => {
    for (const id of ["ollama", "local-llama", "mock", "scripted-mock"]) {
      expect(isLocalProvider(id)).toBe(true);
    }
  });

  it("is fail-closed: remote and unknown providers are remote", () => {
    for (const id of ["anthropic", "openai", "openrouter", "deepseek", "freellmapi", "brand-new-provider"]) {
      expect(isRemoteProvider(id)).toBe(true);
    }
  });
});

describe("redactOutboundRequest (R5.1)", () => {
  it("redacts secrets in the system prompt, preserving surrounding text", () => {
    const out = redactOutboundRequest({ systemPrompt: `memory: ${SECRET} end`, messages: [] });
    expect(out.systemPrompt).not.toContain(SECRET);
    expect(out.systemPrompt).toContain("[REDACTED_API_KEY]");
    expect(out.systemPrompt).toContain("memory:");
    expect(out.systemPrompt).toContain("end");
  });

  it("redacts message string content, text parts, and tool-result content", () => {
    const out = redactOutboundRequest({
      systemPrompt: "sys",
      messages: [
        { role: "user", content: `key ${SECRET}` },
        { role: "user", content: [{ type: "text", text: `also ${SECRET}` }, { type: "image", source: "data:image/png;base64,AAAA" }] },
      ],
      toolResults: [{ toolUseId: "t", invocationId: "i", executionId: "e", content: `out ${SECRET}` }],
    });
    expect(out.messages[0]!.content).not.toContain(SECRET);
    const parts = out.messages[1]!.content as Array<{ type: string; text?: string; source?: string }>;
    expect(parts[0]!.text).not.toContain(SECRET);
    expect(parts[1]).toEqual({ type: "image", source: "data:image/png;base64,AAAA" });
    expect(out.toolResults![0]!.content).not.toContain(SECRET);
  });

  it("does not mutate the input request", () => {
    const request: NormalizedRequest = { systemPrompt: `x ${SECRET}`, messages: [] };
    redactOutboundRequest(request);
    expect(request.systemPrompt).toContain(SECRET);
  });

  it("preserves a long prompt (no preview truncation)", () => {
    const longPrefix = "context ".repeat(200);
    const longSuffix = "tail ".repeat(200);
    const out = redactOutboundRequest({
      systemPrompt: `${longPrefix}${SECRET}${longSuffix}`,
      messages: [],
    });
    expect(out.systemPrompt).toContain("[REDACTED_API_KEY]");
    expect(out.systemPrompt.length).toBeGreaterThan(1000);
  });
});

function makeAdapter(provider: string, capture: { request?: NormalizedRequest }): ModelAdapter {
  return {
    id: `${provider}-adapter`,
    capabilities: {
      provider,
      model: "test-model",
      inputTokenLimit: 1000,
      outputTokenLimit: 1000,
      supportsTools: false,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsVision: false,
      parallelToolCalls: false,
    },
    editFormatPreference: "structured_patch",
    longContextStrategy: "expanded_context",
    complete: async (request: NormalizedRequest) => {
      capture.request = request;
      return { text: "ok", toolCalls: [] };
    },
    stream: async function* (request: NormalizedRequest): AsyncGenerator<StreamChunk> {
      capture.request = request;
      yield { type: "text_delta", text: "ok" };
      yield { type: "done" };
    },
  };
}

describe("withProviderContracts egress gate (R5.1)", () => {
  it("redacts a secret before a remote adapter.complete", async () => {
    const capture: { request?: NormalizedRequest } = {};
    const wrapped = withProviderContracts(makeAdapter("openai", capture));
    await wrapped.complete({
      systemPrompt: `sys ${SECRET}`,
      messages: [{ role: "user", content: `msg ${SECRET}` }],
    });
    expect(capture.request!.systemPrompt).not.toContain(SECRET);
    expect(capture.request!.systemPrompt).toContain("[REDACTED_API_KEY]");
    expect(capture.request!.messages[0]!.content).not.toContain(SECRET);
  });

  it("does not redact for a local adapter", async () => {
    const capture: { request?: NormalizedRequest } = {};
    const wrapped = withProviderContracts(makeAdapter("ollama", capture));
    await wrapped.complete({ systemPrompt: `sys ${SECRET}`, messages: [] });
    expect(capture.request!.systemPrompt).toContain(SECRET);
  });

  it("redacts before a remote adapter.stream", async () => {
    const capture: { request?: NormalizedRequest } = {};
    const wrapped = withProviderContracts(makeAdapter("anthropic", capture));
    for await (const _chunk of wrapped.stream!({ systemPrompt: `sys ${SECRET}`, messages: [] })) {
      // drain
    }
    expect(capture.request!.systemPrompt).not.toContain(SECRET);
  });
});
