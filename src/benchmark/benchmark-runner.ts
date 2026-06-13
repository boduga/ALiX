/**
 * benchmark-runner.ts — Orchestrate benchmark cases, store and compare results.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { BenchmarkResult, BenchmarkRun, BenchmarkSuite } from "./benchmark-types.js";
import { ALIX_VERSION } from "../index.js";

// ─── Runner ────────────────────────────────────────────────────────────

export type BenchmarkCase = () => Promise<BenchmarkResult>;

export type RunOptions = {
  suite?: BenchmarkSuite;
  iterations?: number;
};

const DEFAULT_ITERATIONS = 3;
const MIN_ITERATIONS = 1;

/** Run multiple samples of a benchmark case and compute stats. */
export async function sample(
  name: string,
  suite: BenchmarkSuite,
  label: string,
  fn: () => Promise<void>,
  iterations: number,
): Promise<BenchmarkResult> {
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const elapsed = performance.now() - start;
    samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    name, suite, label,
    durationMs: Math.round(sum / samples.length * 100) / 100,
    iterations: samples.length,
    minMs: Math.round(samples[0] * 100) / 100,
    maxMs: Math.round(samples[samples.length - 1] * 100) / 100,
    meanMs: Math.round(sum / samples.length * 100) / 100,
    p50Ms: Math.round(samples[Math.floor(samples.length * 0.5)] * 100) / 100,
    p95Ms: Math.round(samples[Math.min(Math.floor(samples.length * 0.95), samples.length - 1)] * 100) / 100,
  };
}

/** Run all benchmark cases, optionally filtered by suite. */
export async function runBenchmarks(
  cases: Map<string, { suite: BenchmarkSuite; label: string; run: () => Promise<void> }>,
  opts: RunOptions = {},
): Promise<BenchmarkRun> {
  const iterations = Math.max(opts.iterations ?? DEFAULT_ITERATIONS, MIN_ITERATIONS);
  const results: BenchmarkResult[] = [];

  for (const [name, def] of cases) {
    if (opts.suite && def.suite !== opts.suite) continue;
    console.log(`  Running: ${def.label} (${iterations}x)`);
    const result = await sample(name, def.suite, def.label, def.run, iterations);
    results.push(result);
    console.log(`    ${result.durationMs} ms mean (p50: ${result.p50Ms}, p95: ${result.p95Ms})`);
  }

  const runId = `bench_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const run: BenchmarkRun = {
    runId,
    createdAt: new Date().toISOString(),
    cliVersion: typeof ALIX_VERSION === "string" ? ALIX_VERSION : "dev",
    results,
  };
  return run;
}

// ─── Storage ───────────────────────────────────────────────────────────

function benchmarksDir(cwd: string): string {
  return join(cwd, ".alix", "benchmarks");
}

export function saveRun(cwd: string, run: BenchmarkRun): void {
  const dir = benchmarksDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${run.runId}.json`), JSON.stringify(run, null, 2), "utf-8");
}

export function loadPreviousRuns(cwd: string): BenchmarkRun[] {
  const dir = benchmarksDir(cwd);
  if (!existsSync(dir)) return [];
  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith(".json"));
    return files.map(f => JSON.parse(readFileSync(join(dir, f), "utf-8")) as BenchmarkRun);
  } catch {
    return [];
  }
}

// ─── Comparison ────────────────────────────────────────────────────────

export type ComparisonRow = {
  name: string;
  label: string;
  baselineMs: number;
  candidateMs: number;
  diffMs: number;
  diffPct: string;
  regression: boolean;
};

export function compareRuns(baseline: BenchmarkRun, candidate: BenchmarkRun): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  for (const bResult of baseline.results) {
    const cResult = candidate.results.find(r => r.name === bResult.name);
    if (!cResult) continue;
    const diffMs = cResult.meanMs - bResult.meanMs;
    const diffPct = bResult.meanMs > 0
      ? `${diffMs > 0 ? "+" : ""}${(diffMs / bResult.meanMs * 100).toFixed(1)}%`
      : "—";
    rows.push({
      name: bResult.name,
      label: bResult.label,
      baselineMs: bResult.meanMs,
      candidateMs: cResult.meanMs,
      diffMs: Math.round(diffMs * 100) / 100,
      diffPct,
      regression: diffMs > bResult.meanMs * 0.1,
    });
  }
  return rows;
}
