import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CostAttribution,
  PricingCatalog,
  type PricingEntry,
  type CostSummary,
} from "../../src/observability/cost-attribution.js";

describe("PricingCatalog", () => {
  it("looks up known model pricing", () => {
    const catalog = new PricingCatalog([
      { provider: "openai", model: "gpt-4", effectiveFrom: "2025-01-01", inputPerMillion: 30, outputPerMillion: 60, currency: "USD" },
    ]);
    const price = catalog.lookup("openai", "gpt-4");
    assert.ok(price);
    assert.equal(price?.inputPerMillion, 30);
    assert.equal(price?.outputPerMillion, 60);
  });

  it("returns undefined for unknown model pricing", () => {
    const catalog = new PricingCatalog([]);
    assert.equal(catalog.lookup("unknown", "unknown"), undefined);
  });

  it("returns the latest entry by effectiveFrom for the same model", () => {
    const catalog = new PricingCatalog([
      { provider: "openai", model: "gpt-4", effectiveFrom: "2024-01-01", inputPerMillion: 30, outputPerMillion: 60, currency: "USD" },
      { provider: "openai", model: "gpt-4", effectiveFrom: "2025-06-01", inputPerMillion: 15, outputPerMillion: 30, currency: "USD" },
    ]);
    const price = catalog.lookup("openai", "gpt-4");
    assert.equal(price?.inputPerMillion, 15);
  });
});

describe("CostAttribution", () => {
  let tmpDir: string;
  let attribution: CostAttribution;
  let summary: CostSummary;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "cost-test-"));
    const sessionDir = join(tmpDir, ".alix", "sessions", "test-session");
    mkdirSync(sessionDir, { recursive: true });
    const eventsPath = join(sessionDir, "events.jsonl");

    // Write a model.usage event via streaming-safe append
    const ws = createWriteStream(eventsPath, { flags: "a" });
    ws.write(JSON.stringify({
      type: "model.usage",
      timestamp: new Date().toISOString(),
      sessionId: "sess_1",
      runId: "run_1",
      payload: {
        provider: "openai",
        model: "gpt-4",
        inputTokens: 500,
        outputTokens: 300,
        cachedInputTokens: 100,
        reasoningTokens: 0,
        durationMs: 1200,
      },
    }) + "\n");
    ws.write(JSON.stringify({
      type: "model.usage",
      timestamp: new Date().toISOString(),
      sessionId: "sess_2",
      payload: {
        provider: "ollama",
        model: "llama3",
        inputTokens: 1000,
        outputTokens: 500,
      },
    }) + "\n");
    await new Promise<void>(r => ws.end(r));

    const catalog = new PricingCatalog([
      { provider: "openai", model: "gpt-4", effectiveFrom: "2025-01-01", inputPerMillion: 30, outputPerMillion: 60, currency: "USD" },
    ]);
    attribution = new CostAttribution(tmpDir, catalog);
    summary = await attribution.summary("test-session");
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("attributes known pricing correctly", () => {
    assert.equal(summary.totalTokens, 2300);
    // input: 500 * 30/1M = 0.015, output: 300 * 60/1M = 0.018 => total 0.033
    assert.ok(Math.abs(summary.totalCost - 0.033) < 0.001);
  });

  it("reports cost unknown for models without pricing", () => {
    const o = summary.byProvider["ollama"];
    assert.ok(o);
    assert.equal(o.cost, -1);
    assert.equal(o.tokens, 1500);
  });

  it("separates input/output/cached/reasoning tokens", () => {
    assert.ok(summary.byProvider["openai"]);
    const o = summary.byProvider["openai"];
    assert.equal(o.inputTokens, 500);
    assert.equal(o.outputTokens, 300);
    assert.equal(o.cachedInputTokens, 100);
    assert.equal(o.reasoningTokens, 0);
  });
});
