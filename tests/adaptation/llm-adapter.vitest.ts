import { describe, it, expect, vi } from "vitest";
import type { LLMAdapter, LLMCompletion } from "../../src/adaptation/llm-adapter.js";
import { ProviderCatalogAdapter } from "../../src/adaptation/provider-catalog-adapter.js";

describe("LLMAdapter", () => {
  it("has the correct interface shape", () => {
    const adapter: LLMAdapter = {
      complete: async () => ({ content: "test" }),
    };
    expect(typeof adapter.complete).toBe("function");
  });

  it("LLMCompletion has content and optional provider/model", () => {
    const c: LLMCompletion = { content: "test", provider: "test", model: "v1" };
    expect(c.content).toBe("test");
    expect(c.provider).toBe("test");
  });
});

describe("ProviderCatalogAdapter", () => {
  it("wraps a ModelAdapter and delegates complete()", async () => {
    const mockAdapter = {
      id: "test-provider",
      capabilities: {
        provider: "test",
        model: "test-model",
        inputTokenLimit: 100000,
        outputTokenLimit: 4096,
        supportsTools: false,
        supportsStreaming: false,
        supportsStructuredOutput: false,
        supportsVision: false,
      },
      editFormatPreference: "full_file" as const,
      longContextStrategy: "expanded_context" as const,
      complete: vi.fn().mockResolvedValue({
        text: "Hello, world!",
        toolCalls: [],
      }),
    };

    const adapter = new ProviderCatalogAdapter(mockAdapter, {
      provider: "test",
      model: "test-model",
    });

    const result = await adapter.complete({
      system: "You are a test assistant.",
      user: "Say hello",
    });

    expect(mockAdapter.complete).toHaveBeenCalledWith({
      systemPrompt: "You are a test assistant.",
      messages: [{ role: "user", content: "Say hello" }],
      temperature: 0,
      maxOutputTokens: 512,
    });
    expect(result.content).toBe("Hello, world!");
    expect(result.provider).toBe("test");
    expect(result.model).toBe("test-model");
  });

  it("throws on empty response from provider", async () => {
    const mockAdapter = {
      id: "test-provider",
      capabilities: {
        provider: "test",
        model: "test-model",
        inputTokenLimit: 100000,
        outputTokenLimit: 4096,
        supportsTools: false,
        supportsStreaming: false,
        supportsStructuredOutput: false,
        supportsVision: false,
      },
      editFormatPreference: "full_file" as const,
      longContextStrategy: "expanded_context" as const,
      complete: vi.fn().mockResolvedValue({
        text: "",
        toolCalls: [],
      }),
    };

    const adapter = new ProviderCatalogAdapter(mockAdapter, {
      provider: "test",
    });

    await expect(adapter.complete({
      system: "You are a test assistant.",
      user: "Say hello",
    })).rejects.toThrow("Empty response from provider");
  });
});
