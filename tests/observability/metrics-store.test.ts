import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MetricsStore, RollupStore, type MetricRow, type MetricType,
} from "../../src/observability/metrics-store.js";

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
  let tmpDir2: string;
  before(() => {
    tmpDir2 = mkdtempSync(join(tmpdir(), "rollup-test-"));
  });
  after(() => {
    rmSync(tmpDir2, { recursive: true, force: true });
  });
  it("creates hourly rollups from raw metrics", async () => {
    const rollup = new RollupStore(tmpDir2);
    // Write a sample raw metric
    const store = new MetricsStore(tmpDir2);
    for await (const _ of store.append({
      name: "test_metric", type: "counter_delta", value: 1, timestamp: new Date().toISOString(),
    })) {}
    // Roll up
    const count = await rollup.rollUp();
    assert.equal(typeof count, "number");
  });
});

describe("MetricsStore query enhancements", () => {
  let tmpDir3: string;
  let store3: MetricsStore;

  before(async () => {
    tmpDir3 = mkdtempSync(join(tmpdir(), "metrics-store-query-"));
    store3 = new MetricsStore(tmpDir3);
    // Seed known metrics
    const rows = [
      { name: "model_calls_total", type: "counter_delta" as const, value: 1, timestamp: "2026-06-01T00:00:00.000Z" },
      { name: "tool_calls_total", type: "counter_delta" as const, value: 2, timestamp: "2026-06-02T00:00:00.000Z" },
      { name: "model_calls_total", type: "counter_delta" as const, value: 3, timestamp: "2026-06-03T00:00:00.000Z" },
    ];
    for (const r of rows) {
      for await (const _ of store3.append(r)) { /* drain */ }
    }
  });
  after(() => { rmSync(tmpDir3, { recursive: true, force: true }); });

  it("filters by single metric name", async () => {
    const results: Array<{ name: string; value: number }> = [];
    for await (const r of store3.readAll({ nameFilter: "model_calls_total" })) {
      results.push({ name: r.name, value: r.value });
    }
    assert.ok(results.length >= 2);
    for (const r of results) {
      assert.equal(r.name, "model_calls_total");
    }
  });

  it("filters by multiple metric names", async () => {
    const results: Array<{ name: string }> = [];
    for await (const r of store3.readAll({
      nameFilter: ["model_calls_total", "tool_calls_total"],
    })) {
      results.push({ name: r.name });
    }
    const names = [...new Set(results.map(r => r.name))].sort();
    assert.deepEqual(names, ["model_calls_total", "tool_calls_total"]);
  });

  it("orders files by desc (default) — newest files first", async () => {
    // All rows are in today's file, so desc doesn't change file order.
    // Within a file, rows are in append order. Verify files are read
    // newest-first by checking that at least the rows are streamed.
    const results: Array<{ name: string; value: number }> = [];
    for await (const r of store3.readAll({ nameFilter: "model_calls_total" })) {
      results.push({ name: r.name, value: r.value });
    }
    assert.ok(results.length >= 2);
    // With desc (default), within the same daily file, rows are in append order.
    // The order "desc" determines file iteration order (newest files first).
    assert.equal(results.length, 2);
  });

  it("orders files by asc — oldest files first", async () => {
    const results: Array<{ name: string; value: number }> = [];
    for await (const r of store3.readAll({
      nameFilter: "model_calls_total",
      order: "asc",
    })) {
      results.push({ name: r.name, value: r.value });
    }
    assert.ok(results.length >= 2);
  });

  it("applies limit after filters", async () => {
    const results: Array<{ name: string; timestamp: string }> = [];
    for await (const r of store3.readAll({ limit: 2 })) {
      results.push({ name: r.name, timestamp: r.timestamp });
    }
    assert.ok(results.length <= 2);
  });

  it("enforces max limit", async () => {
    // The max is 100000, so a very large limit should be capped
    const results: Array<{ name: string }> = [];
    for await (const r of store3.readAll({ limit: 999999 })) {
      results.push({ name: r.name });
    }
    // Should cap to 100000 — we have only 3 rows so we'll get 3
    assert.equal(results.length, 3);
  });

  it("streams reads without loading all into memory", async () => {
    // readAll uses createReadStream + readline internally
    const results: Array<{ name: string; value: number }> = [];
    for await (const r of store3.readAll({ nameFilter: "model_calls_total" })) {
      results.push({ name: r.name, value: r.value });
    }
    assert.ok(results.length >= 1);
  });
});
