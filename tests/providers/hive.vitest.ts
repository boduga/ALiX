// Mock unified-complete so we can verify HiveProvider.complete/stream delegate
// to it with provider id "hive", and drive the reasoning-starvation guard
// without a live call. Preserves SPECS etc. via vi.importActual so the SPECS
// registration test below keeps working.
vi.mock("../../src/models/providers/unified-complete.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/models/providers/unified-complete.js")
  >("../../src/models/providers/unified-complete.js");
  return { ...actual, complete: vi.fn(), stream: vi.fn() };
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { HiveProvider } from "../../src/models/providers/hive-provider.js";
import {
  DEFAULT_HIVE_BASE_URL,
  DEFAULT_HIVE_MODEL,
  HIVE_OUTPUT_TOKEN_LIMIT,
  hiveInputLimitFor,
  hiveSpec,
} from "../../src/models/providers/specs/hive-spec.js";
import { openaiBaseSpec } from "../../src/models/providers/specs/_openai-base.js";
import { resolveParallelToolCalls } from "../../src/models/providers/parallel-tool-calls.js";
import * as unifiedComplete from "../../src/models/providers/unified-complete.js";

const DEFAULT_ENDPOINT = `${DEFAULT_HIVE_BASE_URL}/chat/completions`;

describe("hiveSpec", () => {
  it("targets the Hive inference endpoint whose root carries its own version segment", () => {
    expect(DEFAULT_HIVE_BASE_URL).toBe("https://api-cdn.thehive.ai/api/v3");
    expect(hiveSpec.baseUrl).toBe(DEFAULT_ENDPOINT);
    // The vendor root is /api/v3, not the /v1 convention of other OpenAI-compatible
    // providers — a copy/paste of the /v1 pattern would silently 404.
    expect(hiveSpec.baseUrl).not.toContain("/v1/");
  });

  it("inherits OpenAI Bearer auth and response normalization", () => {
    expect(hiveSpec.authHeader("hive-test")).toEqual({ Authorization: "Bearer hive-test" });
    expect(hiveSpec.fromResponse).toBe(openaiBaseSpec.fromResponse);
  });

  it("converts image content parts to OpenAI image_url", () => {
    const body = hiveSpec.toRequestBody({
      systemPrompt: "",
      messages: [
        { role: "user", content: [{ type: "text", text: "describe" }, { type: "image", source: "https://x/y.png" }] },
      ],
      model: DEFAULT_HIVE_MODEL,
    } as never) as any;
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "https://x/y.png" } },
    ]);
  });

  it("passes structuredOutputSchema through as response_format json_schema", () => {
    const body = hiveSpec.toRequestBody({
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
      model: DEFAULT_HIVE_MODEL,
      structuredOutputSchema: { name: "draft", properties: { x: { type: "string" } }, required: ["x"] },
    } as never) as any;
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "draft",
        strict: true,
        schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
      },
    });
  });
});

describe("hive registration", () => {
  it("is registered in the unified SPECS map and env table", () => {
    expect(unifiedComplete.SPECS.get("hive")).toBe(hiveSpec);
    expect(unifiedComplete.PROVIDER_KEY_ENV.hive).toBe("HIVE_API_KEY");
  });

  it("declares parallel tool calls for a concrete model id, fail-closed otherwise", () => {
    // Verified live: a two-file request returned two tool_calls in one message.
    expect(resolveParallelToolCalls({ provider: "hive", model: DEFAULT_HIVE_MODEL })).toBe(true);
    expect(resolveParallelToolCalls({ provider: "hive", model: "" })).toBe(false);
  });
});

describe("HiveProvider", () => {
  beforeEach(() => vi.mocked(unifiedComplete.complete).mockReset());

  it("targets the derived endpoint and forwards the provider id", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "HIVE_OK", toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 },
    } as never);
    const provider = new HiveProvider({ apiKey: "k", model: DEFAULT_HIVE_MODEL });
    const res = await provider.complete({ systemPrompt: "", messages: [], maxOutputTokens: 32 } as never);
    expect(res.text).toBe("HIVE_OK");
    const [, model, , opts] = vi.mocked(unifiedComplete.complete).mock.calls[0];
    expect(model).toBe(DEFAULT_HIVE_MODEL);
    expect((opts as { baseUrl: string }).baseUrl).toBe(DEFAULT_ENDPOINT);
  });

  it("honours a configured base URL override", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({ text: "x", toolCalls: [] } as never);
    const provider = new HiveProvider({ apiKey: "k", model: "m", baseUrl: "https://proxy.internal/v1" });
    await provider.complete({ systemPrompt: "", messages: [] } as never);
    const [, , , opts] = vi.mocked(unifiedComplete.complete).mock.calls[0];
    expect((opts as { baseUrl: string }).baseUrl).toBe("https://proxy.internal/v1/chat/completions");
  });

  it("reports declared capabilities including the 1M context and 32K output", () => {
    const provider = new HiveProvider({ apiKey: "k", model: DEFAULT_HIVE_MODEL });
    expect(provider.capabilities).toMatchObject({
      provider: "hive",
      inputTokenLimit: 1_048_576,
      outputTokenLimit: HIVE_OUTPUT_TOKEN_LIMIT,
      supportsTools: true,
      supportsVision: true,
      supportsStructuredOutput: true,
    });
    expect(hiveInputLimitFor("unknown-model")).toBe(1_048_576);
  });

  /**
   * Verified live (2026-10-22): Hive's `max_tokens` covers reasoning + answer,
   * and budget exhaustion still reports `finish_reason: "stop"`. At
   * `max_tokens: 300` a real request returned EMPTY content. Accepting that as a
   * normal answer would silently drop ALiX's truncation re-prompt, since that
   * keys on `finishReason === "length"` — which this provider never sends.
   */
  it("fails closed when the reasoning trace consumed the whole budget and no answer was produced", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "", reasoning: "thinking...", toolCalls: [],
      finishReason: "stop", usage: { inputTokens: 40, outputTokens: 300 },
    } as never);
    const provider = new HiveProvider({ apiKey: "k", model: DEFAULT_HIVE_MODEL });
    await expect(
      provider.complete({ systemPrompt: "", messages: [], maxOutputTokens: 300 } as never),
    ).rejects.toThrow(/exhausting the 300-token output budget on reasoning/);
  });

  it("does NOT fail closed for a legitimately empty answer that did not exhaust the budget", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "", reasoning: "brief thought", toolCalls: [],
      finishReason: "stop", usage: { inputTokens: 40, outputTokens: 30 },
    } as never);
    const provider = new HiveProvider({ apiKey: "k", model: DEFAULT_HIVE_MODEL });
    const res = await provider.complete({ systemPrompt: "", messages: [], maxOutputTokens: 300 } as never);
    expect(res.text).toBe("");
  });

  it("does NOT fail closed when an answer was produced", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "the answer", reasoning: "thought", toolCalls: [],
      finishReason: "stop", usage: { inputTokens: 40, outputTokens: 300 },
    } as never);
    const provider = new HiveProvider({ apiKey: "k", model: DEFAULT_HIVE_MODEL });
    const res = await provider.complete({ systemPrompt: "", messages: [], maxOutputTokens: 300 } as never);
    expect(res.text).toBe("the answer");
  });

  it("applies the same guard to a stream that produced reasoning but no text", async () => {
    async function* fakeStream() {
      yield { type: "reasoning_delta", text: "thinking hard" };
      yield { type: "usage", usage: { inputTokens: 40, outputTokens: 300 } };
      yield { type: "done", resolvedModel: DEFAULT_HIVE_MODEL };
    }
    vi.mocked(unifiedComplete.stream).mockReturnValue(fakeStream() as never);
    const provider = new HiveProvider({ apiKey: "k", model: DEFAULT_HIVE_MODEL });
    const drain = async () => {
      for await (const _ of provider.stream({ systemPrompt: "", messages: [], maxOutputTokens: 300 } as never)) { /* drain */ }
    };
    await expect(drain()).rejects.toThrow(/exhausting the 300-token output budget on reasoning/);
  });
});
