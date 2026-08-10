import { describe, it, expect } from "vitest";
import { resolveEffectiveModel } from "../../src/agents/subagent-cli.js";
import type { AlixConfig } from "../../src/config/schema.js";

const DEFAULT_MODEL = { provider: "openai", name: "gpt-4o" };
const CODING_MODEL = { provider: "anthropic", name: "claude-3-5-sonnet" };

function makeConfig(models: AlixConfig["models"]): AlixConfig {
  // `model` is the loader-derived projection — present here only to prove
  // resolveEffectiveModel never mutates it.
  return {
    models,
    model: { provider: DEFAULT_MODEL.provider, name: DEFAULT_MODEL.name },
  } as AlixConfig;
}

describe("resolveEffectiveModel precedence (§10.3/§10.4)", () => {
  const cfg = makeConfig({ default: DEFAULT_MODEL, coding: CODING_MODEL });

  it("models.<tier> beats models.default", () => {
    const r = resolveEffectiveModel(cfg, "coding", {});
    expect(r).toEqual(CODING_MODEL);
  });

  it("falls back to models.default when the tier is unset", () => {
    const r = resolveEffectiveModel(cfg, "thinking", {});
    expect(r).toEqual(DEFAULT_MODEL);
  });

  it("explicit overrides beat models.<tier>", () => {
    const r = resolveEffectiveModel(cfg, "coding", {
      provider: "google",
      name: "gemini-2.5-flash",
    });
    expect(r).toEqual({ provider: "google", name: "gemini-2.5-flash" });
  });

  it("a per-field override only replaces that field (rest from tier)", () => {
    const r = resolveEffectiveModel(cfg, "coding", { provider: "google" });
    expect(r).toEqual({ provider: "google", name: CODING_MODEL.name });
    const r2 = resolveEffectiveModel(cfg, "coding", { name: "custom" });
    expect(r2).toEqual({ provider: CODING_MODEL.provider, name: "custom" });
  });

  it("never mutates config.model", () => {
    const before = JSON.stringify(cfg.model);
    resolveEffectiveModel(cfg, "coding", { provider: "google", name: "gemini" });
    resolveEffectiveModel(cfg, "coding", {});
    expect(JSON.stringify(cfg.model)).toBe(before);
  });
});
