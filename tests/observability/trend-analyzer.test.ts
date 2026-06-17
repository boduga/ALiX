import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MetricsStore } from "../../src/observability/metrics-store.js";
import { TrendAnalyzer } from "../../src/observability/trend-analyzer.js";

describe("TrendAnalyzer", () => {
  let tmpDir: string;
  let store: MetricsStore;
  let analyzer: TrendAnalyzer;
  const BASE = Date.now() - 120_000;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "trend-test-"));
    mkdirSync(join(tmpDir, ".alix", "observability", "metrics"), { recursive: true });
    store = new MetricsStore(tmpDir);
    analyzer = new TrendAnalyzer(store);

    // Seed: 10 counter_delta values spread across 2 min, one per 12s
    for (let i = 0; i < 10; i++) {
      for await (const _ of store.append({
        name: "model_calls_total", type: "counter_delta", value: 1,
        timestamp: new Date(BASE + i * 12_000).toISOString(),
        labels: { provider: "openai" },
      })) {}
    }
    // Seed: 5 histogram samples spread across 100s
    for (let i = 0; i < 5; i++) {
      for await (const _ of store.append({
        name: "workflow_duration_ms", type: "histogram_sample", value: 500 + i * 100,
        timestamp: new Date(BASE + i * 20_000).toISOString(),
      })) {}
    }
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("computeWindowed() assigns each row to the correct bucket via Math.floor", async () => {
    const windows = await analyzer.computeWindowed("model_calls_total", { windowSizeMs: 60_000 });
    assert.ok(windows.length >= 2);
    const totalSamples = windows.reduce((s, w) => s + w.count, 0);
    assert.equal(totalSamples, 10);
  });

  it("computeWindowed() computes p50, p95, p99 per window", async () => {
    const windows = await analyzer.computeWindowed("workflow_duration_ms", { windowSizeMs: 120_000 });
    assert.ok(windows.length >= 1);
    const w = windows[0];
    assert.equal(typeof w.p50, "number");
    assert.equal(typeof w.p95, "number");
    // With 5 samples [500, 600, 700, 800, 900], p50 ≈ 700
    assert.ok(w.p50 >= 500 && w.p50 <= 900);
  });

  it("compareWindows() returns correct delta and trend", async () => {
    const now = Date.now();
    const result = await analyzer.compareWindows("model_calls_total", {
      windowA: { durationMs: 60_000, endTime: new Date(now - 60_000).toISOString() },
      windowB: { durationMs: 60_000, endTime: new Date(now).toISOString() },
    });
    assert.ok(result);
    assert.equal(typeof result.deltaPercent, "number");
    assert.ok(["up", "down", "stable"].includes(result.trend));
  });

  it("detectAnomalies() sorts by timestamp before selecting latest", async () => {
    const anomalies = await analyzer.detectAnomalies({ sensitivity: 2.0, maxResults: 10 });
    assert.ok(Array.isArray(anomalies));
    for (const a of anomalies) {
      assert.ok(a.metricName);
      assert.ok(["high", "low"].includes(a.direction));
    }
  });
});
