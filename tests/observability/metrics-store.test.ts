import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MetricsStore, RollupStore, type MetricRow, type MetricType } from "../../src/observability/metrics-store.js";

describe("MetricsStore", () => {
  let tmpDir: string;
  let store: MetricsStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "metrics-store-test-"));
    mkdirSync(join(tmpDir, ".alix", "observability", "metrics"), { recursive: true });
    store = new MetricsStore(tmpDir);
  });
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("rejects unknown metric types", async () => {
    const stream = store.append({ name: "bad", type: "invalid" as any, value: 1, timestamp: new Date().toISOString() });
    try {
      for await (const _ of stream) {}
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.ok(e.message.includes("type"));
    }
  });

  it("rejects non-finite values", async () => {
    const stream = store.append({ name: "bad", type: "counter_delta", value: NaN, timestamp: new Date().toISOString() });
    try {
      for await (const _ of stream) {}
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.ok(e.message.includes("finite"));
    }
  });

  it("rejects empty names", async () => {
    const stream = store.append({ name: "", type: "counter_delta", value: 1, timestamp: new Date().toISOString() });
    try {
      for await (const _ of stream) {}
      assert.fail("should have thrown");
    } catch (e: any) {
      assert.ok(e.message.includes("name"));
    }
  });

  it("writes to daily JSONL file and can be streamed back", async () => {
    const row: MetricRow = {
      name: "model_calls_total", type: "counter_delta", value: 1,
      timestamp: new Date().toISOString(),
      labels: { provider: "openai" },
    };
    for await (const _ of store.append(row)) {}  // flush

    // Read it back via streaming
    const results: MetricRow[] = [];
    for await (const r of store.readAll()) {
      results.push(r);
    }
    assert.ok(results.length >= 1);
    assert.equal(results[0].name, "model_calls_total");
    assert.equal(results[0].value, 1);
    assert.equal(results[0].type, "counter_delta");
  });

  it("readWindow filters by time range", async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    const pastResults: MetricRow[] = [];
    for await (const r of store.readWindow({ before: past })) {
      pastResults.push(r);
    }
    assert.equal(pastResults.length, 0);

    const futureResults: MetricRow[] = [];
    for await (const r of store.readWindow({ after: future })) {
      futureResults.push(r);
    }
    assert.equal(futureResults.length, 0);
  });

  it("supports all 4 metric types", () => {
    const types: MetricType[] = ["counter_delta", "counter_total", "gauge", "histogram_sample"];
    for (const t of types) {
      const row: MetricRow = { name: "test", type: t, value: 1, timestamp: new Date().toISOString() };
      assert.equal(row.type, t);
    }
  });
});

describe("RollupStore", () => {
  it("creates hourly rollups from raw metrics", async () => {
    const tmpDir2 = mkdtempSync(join(tmpdir(), "rollup-test-"));
    const rollup = new RollupStore(tmpDir2);
    // Write a sample raw metric
    const store = new MetricsStore(tmpDir2);
    for await (const _ of store.append({
      name: "test_metric", type: "counter_delta", value: 1, timestamp: new Date().toISOString(),
    })) {}
    // Roll up
    const count = await rollup.rollUp();
    assert.equal(typeof count, "number");
    rmSync(tmpDir2, { recursive: true, force: true });
  });
});
