// Mock unified-complete so we can verify InternProvider.complete/stream
// delegate to it with provider id "intern". Preserves SPECS, PROVIDER_KEY_ENV,
// etc. via vi.importActual so the SPECS registration test below continues to work.
vi.mock("../../src/models/providers/unified-complete.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/models/providers/unified-complete.js")
  >("../../src/models/providers/unified-complete.js");
  return {
    ...actual,
    complete: vi.fn(),
    stream: vi.fn(),
  };
});

import { describe, it, expect, vi } from "vitest";
import { InternProvider } from "../../src/models/providers/intern-provider.js";
import {
  DEFAULT_INTERN_BASE_URL,
  DEFAULT_INTERN_MODEL,
  INTERN_OUTPUT_TOKEN_LIMIT,
  internInputLimitFor,
  internSpec,
} from "../../src/models/providers/specs/intern-spec.js";
import { openaiBaseSpec } from "../../src/models/providers/specs/_openai-base.js";
import * as unifiedComplete from "../../src/models/providers/unified-complete.js";

const DEFAULT_ENDPOINT = `${DEFAULT_INTERN_BASE_URL}/chat/completions`;

describe("internSpec", () => {
  it("targets the Intern InkStone Token Plan OpenAI-compat endpoint", () => {
    expect(DEFAULT_INTERN_BASE_URL).toBe("https://discovery-api.intern-ai.org.cn/v1");
    expect(internSpec.baseUrl).toBe(DEFAULT_ENDPOINT);
  });

  it("inherits OpenAI Bearer auth and response normalization", () => {
    expect(internSpec.authHeader("intern-test")).toEqual({ Authorization: "Bearer intern-test" });
    expect(internSpec.fromResponse).toBe(openaiBaseSpec.fromResponse);
  });

  it("converts image content parts to OpenAI image_url with the required detail", () => {
    const body = internSpec.toRequestBody({
      systemPrompt: "",
      messages: [
        { role: "user", content: [{ type: "text", text: "describe" }, { type: "image", source: "https://x/y.png" }] },
      ],
      model: DEFAULT_INTERN_MODEL,
    }) as any;
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "https://x/y.png", detail: "auto" } },
    ]);
  });

  it("passes structuredOutputSchema through as response_format json_schema", () => {
    const body = internSpec.toRequestBody({
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
      model: DEFAULT_INTERN_MODEL,
      structuredOutputSchema: { name: "draft", properties: { x: { type: "string" } }, required: ["x"] },
    }) as any;
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "draft",
        strict: true,
        schema: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
      },
    });
  });

  it("leaves max_tokens (OpenAI field) untouched", () => {
    const body = internSpec.toRequestBody({
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
      model: DEFAULT_INTERN_MODEL,
      maxOutputTokens: 8192,
    }) as any;
    expect(body.max_tokens).toBe(8192);
  });
});

describe("internInputLimitFor", () => {
  it("returns 1M for the vendor's 1M models", () => {
    for (const id of ["deepseek-v4-flash-0731", "deepseek-v4-flash-vision", "deepseek-v4-pro-0813", "glm-5.3", "minimax-m3"]) {
      expect(internInputLimitFor(id)).toBe(1_048_576);
    }
  });

  it("defaults to 256K for the other models and unknown ids", () => {
    for (const id of ["intern-s2", "Atria-Dawn-Preview", "Agents-A1", "kimi-k2.6", "qwen3.8-27b", "unknown"]) {
      expect(internInputLimitFor(id)).toBe(262_144);
    }
  });
});

describe("InternProvider", () => {
  it("has id 'intern'", () => {
    const p = new InternProvider({ apiKey: "intern-test" });
    expect(p.id).toBe("intern");
  });

  it("defaults model to the vision-capable 1M model", () => {
    const p = new InternProvider({ apiKey: "intern-test" });
    expect(p.capabilities.model).toBe(DEFAULT_INTERN_MODEL);
    expect(DEFAULT_INTERN_MODEL).toBe("deepseek-v4-flash-vision");
  });

  it("complete() delegates to unified-complete with provider id and endpoint", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "delegated",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    });
    const p = new InternProvider({ apiKey: "intern-test" });
    const result = await p.complete({
      systemPrompt: "s",
      messages: [{ role: "user", content: "m" }],
    });
    expect(unifiedComplete.complete).toHaveBeenCalledWith(
      "intern",
      DEFAULT_INTERN_MODEL,
      expect.any(Object),
      expect.objectContaining({ apiKey: "intern-test", baseUrl: DEFAULT_ENDPOINT }),
    );
    expect(result.text).toBe("delegated");
  });

  it("stream() delegates to unified-complete with provider id and endpoint", async () => {
    async function* genStream() {
      yield { type: "text_delta", text: "delegated-stream" } as never;
    }
    vi.mocked(unifiedComplete.stream).mockImplementation(() => genStream());
    const p = new InternProvider({ apiKey: "intern-test" });
    const chunks: unknown[] = [];
    for await (const chunk of p.stream({
      systemPrompt: "s",
      messages: [{ role: "user", content: "m" }],
    })) {
      chunks.push(chunk);
    }
    expect(unifiedComplete.stream).toHaveBeenCalledWith(
      "intern",
      DEFAULT_INTERN_MODEL,
      expect.any(Object),
      expect.objectContaining({ apiKey: "intern-test", baseUrl: DEFAULT_ENDPOINT }),
    );
    expect(chunks).toEqual([{ type: "text_delta", text: "delegated-stream" }]);
  });

  it("honors a configured baseUrl override (ModelConfig.internBaseUrl)", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    });
    const p = new InternProvider({
      apiKey: "intern-test",
      baseUrl: "https://discovery-api.intern-ai.org.cn/v2/",
    });
    await p.complete({ systemPrompt: "s", messages: [{ role: "user", content: "m" }] });
    expect(unifiedComplete.complete).toHaveBeenCalledWith(
      "intern",
      DEFAULT_INTERN_MODEL,
      expect.any(Object),
      expect.objectContaining({ baseUrl: "https://discovery-api.intern-ai.org.cn/v2/chat/completions" }),
    );
  });

  it("resolves inputTokenLimit per model", () => {
    const big = new InternProvider({ apiKey: "x", model: "glm-5.3" });
    expect(big.capabilities.inputTokenLimit).toBe(1_048_576);
    const small = new InternProvider({ apiKey: "x", model: "intern-s2" });
    expect(small.capabilities.inputTokenLimit).toBe(262_144);
  });

  it("returns configured capabilities (parallel tool calls fail-closed)", () => {
    const p = new InternProvider({ apiKey: "intern-test" });
    expect(p.capabilities).toEqual({
      provider: "intern",
      model: DEFAULT_INTERN_MODEL,
      inputTokenLimit: 1_048_576,
      outputTokenLimit: INTERN_OUTPUT_TOKEN_LIMIT,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      parallelToolCalls: false,
    });
  });

  it("is registered in unified-complete SPECS Map", async () => {
    const { SPECS } = await import("../../src/models/providers/unified-complete.js");
    const spec = SPECS.get("intern");
    expect(spec).toBeDefined();
    expect(spec?.baseUrl).toBe(DEFAULT_ENDPOINT);
  });

  it("createProvider returns InternProvider for id 'intern'", async () => {
    const { createProvider } = await import("../../src/models/providers/registry.js");
    const p = await createProvider({ provider: "intern" }, "intern-test");
    expect(p.id).toBe("intern");
  });

  it("listProviders includes 'intern'", async () => {
    const { listProviders } = await import("../../src/models/providers/registry.js");
    const list = listProviders();
    expect(list.find((p) => p.id === "intern")).toEqual({
      id: "intern",
      name: "Intern InkStone (Token Plan)",
      envKey: "INTERN_API_KEY",
    });
  });

  it("listModels calls the Intern /models endpoint with Bearer auth", async () => {
    const { listModels } = await import("../../src/models/providers/catalog.js");
    let captured: { url: string; headers: Record<string, string> } | undefined;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url: String(url), headers: init?.headers ?? {} };
      return new Response(
        JSON.stringify({ object: "list", data: [{ id: "deepseek-v4-flash-0731", object: "model" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as any;
    try {
      const models = await listModels("intern", "intern-test");
      expect(captured?.url).toBe(`${DEFAULT_INTERN_BASE_URL}/models`);
      expect(captured?.headers["Authorization"]).toBe("Bearer intern-test");
      expect(models).toEqual([{ id: "deepseek-v4-flash-0731", displayName: "deepseek-v4-flash-0731" }]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("getDefaultModel returns the vision default", async () => {
    const { getDefaultModel } = await import("../../src/models/providers/catalog.js");
    expect(getDefaultModel("intern")).toBe(DEFAULT_INTERN_MODEL);
  });

  it("PROVIDERS array includes intern", async () => {
    const { PROVIDERS } = await import("../../src/models/providers/catalog.js");
    const p = PROVIDERS.find((x) => x.id === "intern");
    expect(p).toEqual({
      id: "intern",
      name: "Intern InkStone (Token Plan)",
      env: "INTERN_API_KEY",
      hint: "(token-plan key)",
    });
  });
});
