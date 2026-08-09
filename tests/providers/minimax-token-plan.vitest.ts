import { describe, it, expect } from "vitest";
import { MiniMaxTokenPlanProvider } from "../../src/providers/minimax-token-plan-provider.js";

describe("MiniMaxTokenPlanProvider", () => {
  it("has id 'minimax-token-plan'", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect(p.id).toBe("minimax-token-plan");
  });

  it("defaults model to 'MiniMax-M3'", () => {
    const p = new MiniMaxTokenPlanProvider({ apiKey: "sk-cp-test" });
    expect((p as any)._model).toBe("MiniMax-M3");
  });

  it("reads apiKey from env when not provided in config", () => {
    const saved = process.env.MINIMAX_TOKEN_PLAN_KEY;
    process.env.MINIMAX_TOKEN_PLAN_KEY = "sk-cp-from-env";
    try {
      const p = new MiniMaxTokenPlanProvider();
      expect((p as any)._apiKey).toBe("sk-cp-from-env");
    } finally {
      if (saved === undefined) delete process.env.MINIMAX_TOKEN_PLAN_KEY;
      else process.env.MINIMAX_TOKEN_PLAN_KEY = saved;
    }
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
    expect(spec?.baseUrl).toBe("https://api.minimax.io/anthropic");
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
