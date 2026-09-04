// Mock unified-complete so we can verify MiniMaxTokenPlanProvider.complete/stream
// delegate to it with provider id "minimax-token-plan". Preserves SPECS,
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
import { MiniMaxTokenPlanProvider } from "../../src/providers/minimax-token-plan-provider.js";
import * as unifiedComplete from "../../src/providers/unified-complete.js";

describe("MiniMaxTokenPlanProvider", () => {
  it("has id 'minimax-token-plan'", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.id).toBe("minimax-token-plan");
  });

  it("defaults model to 'MiniMax-M3'", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.capabilities.model).toBe("MiniMax-M3");
  });

  it("reads apiKey from MINIMAX_TOKEN_PLAN_KEY env when not provided in config", async () => {
    const saved = process.env.MINIMAX_TOKEN_PLAN_KEY;
    process.env.MINIMAX_TOKEN_PLAN_KEY = "sk-cp-from-env";
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "ok",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "end_turn",
    });
    try {
      const p = new MiniMaxTokenPlanProvider();
      await p.complete({
        systemPrompt: "s",
        messages: [{ role: "user", content: "m" }],
      });
      expect(unifiedComplete.complete).toHaveBeenCalledWith(
        "minimax-token-plan",
        "MiniMax-M3",
        expect.any(Object),
        expect.objectContaining({ apiKey: "sk-cp-from-env" }),
      );
    } finally {
      vi.mocked(unifiedComplete.complete).mockReset();
      if (saved === undefined) delete process.env.MINIMAX_TOKEN_PLAN_KEY;
      else process.env.MINIMAX_TOKEN_PLAN_KEY = saved;
    }
  });

  it("complete() delegates to unified-complete with provider id 'minimax-token-plan'", async () => {
    vi.mocked(unifiedComplete.complete).mockResolvedValue({
      text: "delegated",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "end_turn",
    });
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    const result = await p.complete({
      systemPrompt: "s",
      messages: [{ role: "user", content: "m" }],
    });
    expect(unifiedComplete.complete).toHaveBeenCalledWith(
      "minimax-token-plan",
      "MiniMax-M3",
      expect.any(Object),
      expect.objectContaining({ apiKey: "sk-cp-test" }),
    );
    expect(result).toEqual({
      text: "delegated",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      finishReason: "end_turn",
    });
  });

  it("stream() delegates to unified-complete with provider id 'minimax-token-plan'", async () => {
    async function* genStream() {
      yield { type: "text", text: "delegated-stream" } as never;
    }
    vi.mocked(unifiedComplete.stream).mockImplementation(() => genStream());
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    const chunks: unknown[] = [];
    for await (const chunk of p.stream({
      systemPrompt: "s",
      messages: [{ role: "user", content: "m" }],
    })) {
      chunks.push(chunk);
    }
    expect(unifiedComplete.stream).toHaveBeenCalledWith(
      "minimax-token-plan",
      "MiniMax-M3",
      expect.any(Object),
      expect.objectContaining({ apiKey: "sk-cp-test" }),
    );
    expect(chunks).toEqual([{ type: "text", text: "delegated-stream" }]);
  });

  it("returns configured capabilities", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.capabilities).toEqual({
      provider: "minimax-token-plan",
      model: "MiniMax-M3",
      inputTokenLimit: 1_000_000,
      outputTokenLimit: 64_000,
      supportsTools: true,
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsVision: true,
      parallelToolCalls: false,
    });
  });

  it("uses structured_patch edit format and expanded_context long-context strategy", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.editFormatPreference).toBe("structured_patch");
    expect(p.longContextStrategy).toBe("expanded_context");
  });

  it("is registered in unified-complete SPECS Map", async () => {
    const { SPECS } = await import("../../src/providers/unified-complete.js");
    const spec = SPECS.get("minimax-token-plan");
    expect(spec).toBeDefined();
    expect(spec?.baseUrl).toBe("https://api.minimax.io/anthropic/v1/messages");
  });

  it("createProvider returns MiniMaxTokenPlanProvider for id 'minimax-token-plan'", async () => {
    const { createProvider } = await import("../../src/providers/registry.js");
    const p = await createProvider({ provider: "minimax-token-plan" }, "sk-cp-test");
    expect(p.id).toBe("minimax-token-plan");
  });

  it("listProviders includes 'minimax-token-plan'", async () => {
    const { listProviders } = await import("../../src/providers/registry.js");
    const list = listProviders();
    expect(list.find((p) => p.id === "minimax-token-plan")).toBeDefined();
  });

  it("listModels calls https://api.minimax.io/anthropic/v1/models with x-api-key", async () => {
    const { listModels } = await import("../../src/providers/catalog.js");
    let captured: { url: string; headers: Record<string, string> } | undefined;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      captured = { url: String(url), headers: init?.headers ?? {} };
      return new Response(JSON.stringify({ data: [{ id: "MiniMax-M3", display_name: "MiniMax-M3" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;
    try {
      const models = await listModels("minimax-token-plan", "sk-cp-test");
      expect(captured?.url).toBe("https://api.minimax.io/anthropic/v1/models");
      expect(captured?.headers["x-api-key"]).toBe("sk-cp-test");
      expect(captured?.headers["anthropic-version"]).toBe("2023-06-01");
      expect(models).toEqual([{ id: "MiniMax-M3", displayName: "MiniMax-M3", maxInputTokens: undefined, maxOutputTokens: undefined }]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("getDefaultModel returns 'MiniMax-M3'", async () => {
    const { getDefaultModel } = await import("../../src/providers/catalog.js");
    expect(getDefaultModel("minimax-token-plan")).toBe("MiniMax-M3");
  });

  it("PROVIDERS array includes minimax-token-plan", async () => {
    const { PROVIDERS } = await import("../../src/providers/catalog.js");
    const p = PROVIDERS.find((x) => x.id === "minimax-token-plan");
    expect(p).toEqual({
      id: "minimax-token-plan",
      name: "MiniMax (Token Plan)",
      env: "MINIMAX_TOKEN_PLAN_KEY",
      hint: "sk-cp-...",
    });
  });
});
