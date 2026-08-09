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
});
