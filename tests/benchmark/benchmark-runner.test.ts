import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sample, runBenchmarks, saveRun, loadPreviousRuns, compareRuns } from "../../src/benchmark/benchmark-runner.js";

describe("benchmark-runner", () => {
  it("sample returns stats for a function", async () => {
    const result = await sample("test", "quick", "Test", () => Promise.resolve(), 3);
    assert.equal(result.name, "test");
    assert.equal(result.iterations, 3);
    assert.ok(result.durationMs >= 0);
    assert.ok(result.p50Ms >= 0);
  });

  it("runBenchmarks returns a BenchmarkRun", async () => {
    const cases = new Map([["test", { suite: "quick" as const, label: "Test", run: () => Promise.resolve() }]]);
    const run = await runBenchmarks(cases, { iterations: 1 });
    assert.equal(run.results.length, 1);
    assert.ok(run.runId.startsWith("bench_"));
  });

  it("runBenchmarks filters by suite", async () => {
    const cases = new Map([
      ["quick-one", { suite: "quick" as const, label: "Quick", run: () => Promise.resolve() }],
      ["runtime-one", { suite: "runtime" as const, label: "Runtime", run: () => Promise.resolve() }],
    ]);
    const run = await runBenchmarks(cases, { suite: "quick", iterations: 1 });
    assert.equal(run.results.length, 1);
    assert.equal(run.results[0].name, "quick-one");
  });
});

describe("benchmark storage", () => {
  const TEST_DIR = join(process.cwd(), `.test-bench-${Date.now()}`);
  const BENCH_DIR = join(TEST_DIR, ".alix", "benchmarks");

  beforeEach(() => { mkdirSync(BENCH_DIR, { recursive: true }); });
  afterEach(() => { rmSync(TEST_DIR, { recursive: true, force: true }); });

  it("saveRun and loadPreviousRuns round-trips", () => {
    const run = { runId: "bench_test", createdAt: "2026-01-01", cliVersion: "test", results: [] };
    saveRun(TEST_DIR, run);
    const loaded = loadPreviousRuns(TEST_DIR);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].runId, "bench_test");
  });

  it("loadPreviousRuns returns empty when no directory", () => {
    assert.deepEqual(loadPreviousRuns("/nonexistent"), []);
  });
});

describe("compareRuns", () => {
  it("detects regression", () => {
    const baseline = { runId: "a", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick" as const, label: "Test", durationMs: 100, iterations: 1, minMs: 100, maxMs: 100, meanMs: 100, p50Ms: 100, p95Ms: 100 }] };
    const candidate = { runId: "b", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick" as const, label: "Test", durationMs: 150, iterations: 1, minMs: 150, maxMs: 150, meanMs: 150, p50Ms: 150, p95Ms: 150 }] };
    const rows = compareRuns(baseline, candidate);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].regression, true);
    assert.ok(rows[0].diffPct.includes("+50"));
  });

  it("no regression when within threshold", () => {
    const baseline = { runId: "a", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick" as const, label: "Test", durationMs: 100, iterations: 1, minMs: 100, maxMs: 100, meanMs: 100, p50Ms: 100, p95Ms: 100 }] };
    const candidate = { runId: "b", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick" as const, label: "Test", durationMs: 105, iterations: 1, minMs: 105, maxMs: 105, meanMs: 105, p50Ms: 105, p95Ms: 105 }] };
    const rows = compareRuns(baseline, candidate);
    assert.equal(rows[0].regression, false);
  });
});
