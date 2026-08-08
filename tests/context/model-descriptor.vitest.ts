import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveModelDescriptor,
  clearModelDescriptorCache,
  getEncoding,
  SAFETY_FACTOR,
} from "../../src/config/context-limits.js";

describe("resolveModelDescriptor", () => {
  beforeEach(() => {
    clearModelDescriptorCache();
  });

  it("returns a ModelDescriptor with the full shape", async () => {
    const d = await resolveModelDescriptor("anthropic", "claude-sonnet-4-6");
    expect(d).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      contextWindowTokens: 1_000_000,
      tokenizer: "cl100k_base",
      safetyFactor: 1.2,
    });
  });

  it("resolves the (previously misspelled) grok provider to its intended 131k window", async () => {
    const d = await resolveModelDescriptor("grokai", "grok-2-latest");
    expect(d.contextWindowTokens).toBe(131_000);
    expect(d.tokenizer).toBe("cl100k_base");
  });

  it("tags the OpenAI provider family with o200k_base", async () => {
    const d = await resolveModelDescriptor("openai", "gpt-4o-mini");
    expect(d.tokenizer).toBe("o200k_base");
    expect(d.contextWindowTokens).toBe(128_000);
  });

  it("tags the gpt-4o model override with o200k_base", async () => {
    const d = await resolveModelDescriptor("openai", "gpt-4o");
    expect(d.tokenizer).toBe("o200k_base");
    expect(d.contextWindowTokens).toBe(128_000);
  });

  it("no longer uses char/4 as an admission tokenizer (mock resolves to cl100k_base)", async () => {
    const d = await resolveModelDescriptor("mock", "mock-gpt-4o");
    expect(d.tokenizer).toBe("cl100k_base");
  });

  it("keeps google's o200k_base tokenizer", async () => {
    const d = await resolveModelDescriptor("google", "gemini-2.5-pro");
    expect(d.tokenizer).toBe("o200k_base");
    expect(d.contextWindowTokens).toBe(1_000_000);
  });

  it("falls back to the local 64k default for unknown providers", async () => {
    const d = await resolveModelDescriptor("not-a-provider", "some-model");
    expect(d.contextWindowTokens).toBe(64_000);
    expect(d.tokenizer).toBe("cl100k_base");
  });

  it("caches the descriptor once per process per model", async () => {
    const a = await resolveModelDescriptor("openai", "gpt-4o");
    const b = await resolveModelDescriptor("openai", "gpt-4o");
    expect(b).toBe(a);
  });

  it("re-resolves on model change (cache keyed by provider:model)", async () => {
    const a = await resolveModelDescriptor("openai", "gpt-4o");
    const b = await resolveModelDescriptor("openai", "gpt-4-turbo");
    expect(b).not.toBe(a);
    expect(a.contextWindowTokens).toBe(128_000);
    expect(b.contextWindowTokens).toBe(128_000);
  });

  it("clearModelDescriptorCache invalidates the cache", async () => {
    const a = await resolveModelDescriptor("openai", "gpt-4o");
    clearModelDescriptorCache();
    const b = await resolveModelDescriptor("openai", "gpt-4o");
    expect(b).not.toBe(a);
  });

  it("exposes SAFETY_FACTOR = 1.20", () => {
    expect(SAFETY_FACTOR).toBe(1.2);
  });
});

describe("getEncoding", () => {
  it("returns o200k_base for the OpenAI family", () => {
    expect(getEncoding("openai")).toBe("o200k_base");
  });

  it("returns o200k_base for google", () => {
    expect(getEncoding("google")).toBe("o200k_base");
  });

  it("returns cl100k_base for grokai", () => {
    expect(getEncoding("grokai")).toBe("cl100k_base");
  });

  it("never returns char4 for the mock provider", () => {
    expect(getEncoding("mock")).toBe("cl100k_base");
  });

  it("defaults unknown providers to cl100k_base", () => {
    expect(getEncoding("unknown")).toBe("cl100k_base");
  });
});
