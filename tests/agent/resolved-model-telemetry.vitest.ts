import { describe, it, expect } from "vitest";
import { buildModelUsageEventPayload } from "../../src/agent/messages.js";

describe("buildModelUsageEventPayload", () => {
  it("includes resolvedModel when present", () => {
    expect(buildModelUsageEventPayload("openrouter", "openrouter/free", { inputTokens: 1, outputTokens: 1 }, "qwen/qwen3-14b:free")).toEqual({
      provider: "openrouter",
      model: "openrouter/free",
      inputTokens: 1,
      outputTokens: 1,
      resolvedModel: "qwen/qwen3-14b:free",
    });
  });

  it("omits resolvedModel when absent", () => {
    expect(buildModelUsageEventPayload("openai", "gpt-4o", { inputTokens: 1, outputTokens: 1 })).toEqual({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 1,
      outputTokens: 1,
    });
  });
});