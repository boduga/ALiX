// Mock unified-complete so we can verify XiaomiMimoTokenPlanProvider.complete/stream
// delegate to it with provider id "xiaomi-mimo-token-plan". Preserves SPECS,
// PROVIDER_KEY_ENV, etc. via vi.importActual so the SPECS registration test
// below continues to work.
vi.mock("../../src/providers/unified-complete.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/providers/unified-complete.js")
  >("../../src/providers/unified-complete.js");
  return {
    ...actual,
    complete: vi.fn(),
    stream: vi.fn(),
  };
});

import { describe, it, expect, vi } from "vitest";
import {
  XiaomiMimoTokenPlanProvider,
} from "../../src/providers/xiaomi-mimo-token-plan-provider.js";
import {
  DEFAULT_XIAOMI_MIMO_BASE_URL,
  xiaomiMimoTokenPlanSpec,
} from "../../src/providers/specs/xiaomi-mimo-token-plan-spec.js";
import { openaiBaseSpec } from "../../src/providers/specs/_openai-base.js";
import * as unifiedComplete from "../../src/providers/unified-complete.js";

const DEFAULT_MODEL = "mimo-v2.6-pro";
const DEFAULT_ENDPOINT = `${DEFAULT_XIAOMI_MIMO_BASE_URL}/chat/completions`;

describe("xiaomiMimoTokenPlanSpec", () => {
  it("targets the Token Plan OpenAI-compat endpoint", () => {
    expect(DEFAULT_XIAOMI_MIMO_BASE_URL).toBe("https://token-plan-sgp.xiaomimimo.com/v1");
    expect(xiaomiMimoTokenPlanSpec.baseUrl).toBe(DEFAULT_ENDPOINT);
  });

  it("inherits OpenAI Bearer auth and response normalization", () => {
    expect(xiaomiMimoTokenPlanSpec.authHeader("tp-abc")).toEqual({
      Authorization: "Bearer tp-abc",
    });
    expect(xiaomiMimoTokenPlanSpec.fromResponse).toBe(openaiBaseSpec.fromResponse);
  });

  it("maps max_tokens to max_completion_tokens (MiMo's documented field)", () => {
    const body = xiaomiMimoTokenPlanSpec.toRequestBody({
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
      model: "mimo-v2.6-pro",
      maxOutputTokens: 4096,
    }) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.max_tokens).toBeUndefined();
    expect(body.model).toBe("mimo-v2.6-pro");
  });

  it("leaves bodies without an output budget untouched", () => {
    const body = xiaomiMimoTokenPlanSpec.toRequestBody({
      systemPrompt: "",
      messages: [{ role: "user", content: "hi" }],
      model: "mimo-v2.6-pro",
    }) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
  });
});

describe("XiaomiMimoTokenPlanProvider", () => {
  it("has id 'xiaomi-mimo-token-plan'", () => {
    const p = new XiaomiMimoTokenPlanProvider({ apiKey: "tp-test" });
    expect(p.id).toBe("xiaomi-mimo-token-plan");
  });

  it("defaults model to 'mimo-v2.6-pro'", () => {
    const p = new XiaomiMimoTokenPlanProvider({ apiKey: "tp-test" });
    expect(p.capabilities.model).toBe(DEFAULT_MODEL);
  });

  it("reads apiKey from XIAOMI_MIMO_TOKEN_PLAN_KEY env when not provided in config", async () => {
    const saved = process.env.XIAOMI_MIMO_TOKEN_PLAN_KEY;
    process.env.XIAOMI_MIMO_TOKEN_PLAN_KEY = "tp-from-env";
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    });
    try {
      const p = new XiaomiMimoTokenPlanProvider();
      await p.complete({
        systemPrompt: "s",
        messages: [{ role: "user", content: "m" }],
      });
      expect(unifiedComplete.complete).toHaveBeenCalledWith(
        "xiaomi-mimo-token-plan",
        DEFAULT_MODEL,
        expect.any(Object),
        expect.objectContaining({ apiKey: "tp-from-env", baseUrl: DEFAULT_ENDPOINT }),
      );
    } finally {
      vi.mocked(unifiedComplete.complete).mockReset();
      if (saved === undefined) delete process.env.XIAOMI_MIMO_TOKEN_PLAN_KEY;
      else process.env.XIAOMI_MIMO_TOKEN_PLAN_KEY = saved;
    }
  });

  it("complete() delegates to unified-complete with provider id and endpoint", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "delegated",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    });
    const p = new XiaomiMimoTokenPlanProvider({ apiKey: "tp-test" });
    const result = await p.complete({
      systemPrompt: "s",
      messages: [{ role: "user", content: "m" }],
    });
    expect(unifiedComplete.complete).toHaveBeenCalledWith(
      "xiaomi-mimo-token-plan",
      DEFAULT_MODEL,
      expect.any(Object),
      expect.objectContaining({ apiKey: "tp-test", baseUrl: DEFAULT_ENDPOINT }),
    );
    expect(result.text).toBe("delegated");
  });

  it("stream() delegates to unified-complete with provider id and endpoint", async () => {
    async function* genStream() {
      yield { type: "text_delta", text: "delegated-stream" } as never;
    }
    vi.mocked(unifiedComplete.stream).mockImplementation(() => genStream());
    const p = new XiaomiMimoTokenPlanProvider({ apiKey: "tp-test" });
    const chunks: unknown[] = [];
    for await (const chunk of p.stream({
      systemPrompt: "s",
      messages: [{ role: "user", content: "m" }],
    })) {
      chunks.push(chunk);
    }
    expect(unifiedComplete.stream).toHaveBeenCalledWith(
      "xiaomi-mimo-token-plan",
      DEFAULT_MODEL,
      expect.any(Object),
      expect.objectContaining({ apiKey: "tp-test", baseUrl: DEFAULT_ENDPOINT }),
    );
    expect(chunks).toEqual([{ type: "text_delta", text: "delegated-stream" }]);
  });

  it("honors a configured baseUrl override (ModelConfig.xiaomiMimoBaseUrl)", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "stop",
    });
    const p = new XiaomiMimoTokenPlanProvider({
      apiKey: "tp-test",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1/",
    });
    await p.complete({ systemPrompt: "s", messages: [{ role: "user", content: "m" }] });
    expect(unifiedComplete.complete).toHaveBeenCalledWith(
      "xiaomi-mimo-token-plan",
      DEFAULT_MODEL,
      expect.any(Object),
      expect.objectContaining({ baseUrl: "https://token-plan-cn.xiaomimimo.com/v1/chat/completions" }),
    );
  });

  it("returns configured capabilities", () => {
    const p = new XiaomiMimoTokenPlanProvider({ apiKey: "tp-test" });
    expect(p.capabilities).toEqual({
      provider: "xiaomi-mimo-token-plan",
      model: DEFAULT_MODEL,
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 128_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      parallelToolCalls: true,
    });
  });

  it("uses structured_patch edit format and expanded_context long-context strategy", () => {
    const p = new XiaomiMimoTokenPlanProvider({ apiKey: "tp-test" });
    expect(p.editFormatPreference).toBe("structured_patch");
    expect(p.longContextStrategy).toBe("expanded_context");
  });

  it("is registered in unified-complete SPECS Map", async () => {
    const { SPECS } = await import("../../src/providers/unified-complete.js");
    const spec = SPECS.get("xiaomi-mimo-token-plan");
    expect(spec).toBeDefined();
    expect(spec?.baseUrl).toBe(DEFAULT_ENDPOINT);
  });

  it("createProvider returns XiaomiMimoTokenPlanProvider for id 'xiaomi-mimo-token-plan'", async () => {
    const { createProvider } = await import("../../src/providers/registry.js");
    const p = await createProvider({ provider: "xiaomi-mimo-token-plan" }, "tp-test");
    expect(p.id).toBe("xiaomi-mimo-token-plan");
  });

  it("listProviders includes 'xiaomi-mimo-token-plan'", async () => {
    const { listProviders } = await import("../../src/providers/registry.js");
    const list = listProviders();
    expect(list.find((p) => p.id === "xiaomi-mimo-token-plan")).toEqual({
      id: "xiaomi-mimo-token-plan",
      name: "Xiaomi MiMo (Token Plan)",
      envKey: "XIAOMI_MIMO_TOKEN_PLAN_KEY",
    });
  });

  it("listModels calls the Token Plan /models endpoint with Bearer auth", async () => {
    const { listModels } = await import("../../src/providers/catalog.js");
    let captured: { url: string; headers: Record<string, string> } | undefined;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url: String(url), headers: init?.headers ?? {} };
      return new Response(
        JSON.stringify({ data: [{ id: "mimo-v2.6-pro", display_name: "MiMo V2.6 Pro" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as any;
    try {
      const models = await listModels("xiaomi-mimo-token-plan", "tp-test");
      expect(captured?.url).toBe(`${DEFAULT_XIAOMI_MIMO_BASE_URL}/models`);
      expect(captured?.headers["Authorization"]).toBe("Bearer tp-test");
      expect(models).toEqual([
        { id: "mimo-v2.6-pro", displayName: "MiMo V2.6 Pro" },
      ]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("getDefaultModel returns 'mimo-v2.6-pro'", async () => {
    const { getDefaultModel } = await import("../../src/providers/catalog.js");
    expect(getDefaultModel("xiaomi-mimo-token-plan")).toBe(DEFAULT_MODEL);
  });

  it("PROVIDERS array includes xiaomi-mimo-token-plan", async () => {
    const { PROVIDERS } = await import("../../src/providers/catalog.js");
    const p = PROVIDERS.find((x) => x.id === "xiaomi-mimo-token-plan");
    expect(p).toEqual({
      id: "xiaomi-mimo-token-plan",
      name: "Xiaomi MiMo (Token Plan)",
      env: "XIAOMI_MIMO_TOKEN_PLAN_KEY",
      hint: "tp-...",
    });
  });
});
