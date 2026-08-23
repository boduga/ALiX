import { describe, it, expect } from "vitest";
import { resolveConcreteFreeModel, deriveRequestRequirements, supportsRequest } from "../../src/providers/free-model-resolver.js";
import type { FreeModelInfo } from "../../src/providers/free-model-catalog.js";
import type { NormalizedRequest, ModelCapabilities } from "../../src/providers/types.js";

const model = (overrides: Partial<FreeModelInfo>): FreeModelInfo => ({
  id: "m",
  name: "m",
  inputTokenLimit: 32_000,
  supportsTools: false,
  supportsStructuredOutput: false,
  supportsVision: false,
  ...overrides,
});

const req: NormalizedRequest = { systemPrompt: "s", messages: [{ role: "user", content: "hi" }] };

describe("resolveConcreteFreeModel", () => {
  it("picks the largest verified context among eligible models", () => {
    const catalog = [
      model({ id: "small", inputTokenLimit: 8_000 }),
      model({ id: "big", inputTokenLimit: 64_000 }),
      model({ id: "mid", inputTokenLimit: 32_000 }),
    ];
    expect(resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: false, needsVision: false })?.id).toBe("big");
  });

  it("breaks ties deterministically by lexical model ID", () => {
    const catalog = [
      model({ id: "z/free" }),
      model({ id: "a/free" }),
      model({ id: "m/free" }),
    ];
    expect(resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: false, needsVision: false })?.id).toBe("a/free");
  });

  it("filters on tools requirement", () => {
    const catalog = [
      model({ id: "plain" }),
      model({ id: "tooled", supportsTools: true }),
    ];
    expect(resolveConcreteFreeModel(catalog, { needsTools: true, needsStructuredOutput: false, needsVision: false })?.id).toBe("tooled");
  });

  it("filters on structured-output requirement", () => {
    const catalog = [
      model({ id: "plain" }),
      model({ id: "structured", supportsStructuredOutput: true }),
    ];
    expect(resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: true, needsVision: false })?.id).toBe("structured");
  });

  it("filters on vision requirement", () => {
    const catalog = [
      model({ id: "plain" }),
      model({ id: "vision", supportsVision: true }),
    ];
    expect(resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: false, needsVision: true })?.id).toBe("vision");
  });

  it("rejects models with insufficient context", () => {
    const catalog = [model({ id: "small", inputTokenLimit: 8_000 })];
    expect(resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 16_000 })).toBeUndefined();
  });

  it("rejects unknown context when a concrete context requirement exists", () => {
    const catalog = [model({ id: "unknown-ctx", inputTokenLimit: undefined })];
    expect(resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 10_000 })).toBeUndefined();
  });

  it("returns undefined when no model is eligible", () => {
    expect(resolveConcreteFreeModel([], { needsTools: false, needsStructuredOutput: false, needsVision: false })).toBeUndefined();
  });

  it("resolves different models for different capability sets (no global concrete cache)", () => {
    const catalog = [
      model({ id: "plain", inputTokenLimit: 128_000 }),
      model({ id: "vision", inputTokenLimit: 16_000, supportsVision: true }),
    ];
    const forPlain = resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: false, needsVision: false });
    const forVision = resolveConcreteFreeModel(catalog, { needsTools: false, needsStructuredOutput: false, needsVision: true });
    expect(forPlain?.id).toBe("plain");
    expect(forVision?.id).toBe("vision");
  });

  it("excludes already-tried ids from the self-healing retry loop", () => {
    const catalog = [
      model({ id: "a/free", inputTokenLimit: 64_000 }),
      model({ id: "b/free", inputTokenLimit: 64_000 }),
    ];
    const reqs = { needsTools: false, needsStructuredOutput: false, needsVision: false };
    // Same-size tie breaks lexical -> "a/free" first.
    expect(resolveConcreteFreeModel(catalog, reqs)?.id).toBe("a/free");
    // Excluding "a/free" must yield "b/free" without reordering the input.
    expect(resolveConcreteFreeModel(catalog, reqs, new Set(["a/free"]))?.id).toBe("b/free");
    expect(resolveConcreteFreeModel(catalog, reqs, new Set(["a/free", "b/free"]))).toBeUndefined();
  });
});

describe("deriveRequestRequirements", () => {
  it("reads the existing request vocabulary", () => {
    expect(deriveRequestRequirements({ systemPrompt: "s", messages: [{ role: "user", content: "hi" }] })).toEqual({ needsTools: false, needsStructuredOutput: false, needsVision: false });
    expect(deriveRequestRequirements({ ...req, tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] }).needsTools).toBe(true);
    expect(deriveRequestRequirements({ ...req, structuredOutputSchema: { name: "o", properties: {} } }).needsStructuredOutput).toBe(true);
    expect(deriveRequestRequirements({ ...req, messages: [{ role: "user", content: [{ type: "image", source: "data:x" }] }] }).needsVision).toBe(true);
    expect(deriveRequestRequirements({ ...req, messages: [{ role: "user", content: [{ type: "file", source: "data:x", mediaType: "text", filename: "f.txt" }] }] }).needsVision).toBe(true);
  });

  it("passes through an explicit maxInputTokens", () => {
    expect(deriveRequestRequirements(req, 64_000).maxInputTokens).toBe(64_000);
    expect(deriveRequestRequirements(req).maxInputTokens).toBeUndefined();
  });
});

describe("supportsRequest", () => {
  const caps: ModelCapabilities = {
    provider: "x", model: "m", inputTokenLimit: 32_000, outputTokenLimit: 4096,
    supportsTools: true, supportsStreaming: true, supportsStructuredOutput: false, supportsVision: true,
  };

  it("filters on capabilities", () => {
    expect(supportsRequest(caps, { needsTools: true, needsStructuredOutput: false, needsVision: false })).toBe(true);
    expect(supportsRequest(caps, { needsTools: true, needsStructuredOutput: true, needsVision: false })).toBe(false);
    expect(supportsRequest({ ...caps, supportsVision: false }, { needsTools: false, needsStructuredOutput: false, needsVision: true })).toBe(false);
  });

  it("filters on context capacity", () => {
    expect(supportsRequest(caps, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 40_000 })).toBe(false);
    expect(supportsRequest(caps, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 32_000 })).toBe(true);
    expect(supportsRequest({ ...caps, inputTokenLimit: 8_000 }, { needsTools: false, needsStructuredOutput: false, needsVision: false, maxInputTokens: 16_000 })).toBe(false);
  });
});