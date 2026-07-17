/**
 * Live provider tests — gated on env var per provider.
 *
 * Run with secrets:
 *   OPENAI_API_KEY=... pnpm test:vitest -- tests/cli/helpers/init-live.vitest.ts
 *
 * Missing secrets ⇒ describe.skipIf(true) skips the suite without failing
 * the whole run. See spec §16, §17.
 */
import { describe, it, expect } from "vitest";
import { getAvailableModels } from "../../../src/cli/helpers/provider-selection.js";

function live(providerId: string): boolean {
  const providerEnv = process.env[`${providerId.toUpperCase()}_LIVE`] === "1";
  const hasKey = Boolean(process.env[getEnvName(providerId)]);
  return providerEnv || hasKey;
}

function getEnvName(providerId: string): string {
  const map: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    perplexity: "PERPLEXITY_API_KEY",
  };
  return map[providerId] ?? `${providerId.toUpperCase()}_API_KEY`;
}

// vitest 4.x: `describe.skipIf(condition)(name, fn)` or `describe.runIf(condition)(name, fn)`.
// `describe.skip(name, condition, fn)` does NOT exist as a 3-arg form.
// We want to RUN the suite when `live()` returns true (key present) and SKIP otherwise,
// so `describe.runIf(live(providerId))` is the natural fit.
describe.runIf(live("openai"))("openai live", () => {
  it("returns non-empty model list", async () => {
    const models = await getAvailableModels("openai");
    expect(models.length).toBeGreaterThan(0);
    for (const m of models) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
    }
  }, 30_000);
});

describe.runIf(live("anthropic"))("anthropic live", () => {
  it("returns non-empty model list", async () => {
    const models = await getAvailableModels("anthropic");
    expect(models.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.runIf(live("deepseek"))("deepseek live", () => {
  it("returns non-empty model list", async () => {
    const models = await getAvailableModels("deepseek");
    expect(models.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.runIf(live("google"))("google live", () => {
  it("returns non-empty model list", async () => {
    const models = await getAvailableModels("google");
    expect(models.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.runIf(live("groq"))("groq live", () => {
  it("returns non-empty model list", async () => {
    const models = await getAvailableModels("groq");
    expect(models.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.runIf(live("openrouter"))("openrouter live", () => {
  it("returns non-empty model list", async () => {
    const models = await getAvailableModels("openrouter");
    expect(models.length).toBeGreaterThan(0);
  }, 30_000);
});

describe.runIf(live("perplexity"))("perplexity live", () => {
  it("returns non-empty model list", async () => {
    const models = await getAvailableModels("perplexity");
    expect(models.length).toBeGreaterThan(0);
  }, 30_000);
});