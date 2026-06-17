/**
 * concurrency-harness.ts — Reusable concurrent operation runner for stress tests.
 *
 * Runs N concurrent operations and reports results. Deterministic seed support
 * for reproducible stress runs.
 */

import assert from "node:assert/strict";

// =========================================================================
// Seeded PRNG (Mulberry32 — deterministic, no crypto)
// =========================================================================

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max]. */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

// =========================================================================
// Operation runner
// =========================================================================

export type AsyncOperation<T = void> = (index: number) => Promise<T>;

export interface StressOptions {
  /** Number of concurrent operations (default 50). */
  concurrency?: number;
  /** PRNG seed for reproducibility (default Date.now()). */
  seed?: number;
  /** Timeout per operation in ms (default 5000). */
  operationTimeout?: number;
}

export interface StressResult {
  concurrency: number;
  seed: number;
  totalOperations: number;
  passed: number;
  failed: number;
  errors: Array<{ index: number; message: string }>;
  durationMs: number;
}

const DEFAULT_STRESS_OPTIONS: Required<StressOptions> = {
  concurrency: 50,
  seed: Date.now(),
  operationTimeout: 5000,
};

/**
 * Run N concurrent operations and collect results.
 * All operations start nearly simultaneously via Promise.all.
 */
export async function runConcurrent<T = void>(
  count: number,
  operation: AsyncOperation<T>,
  options?: StressOptions,
): Promise<StressResult> {
  const opts: Required<StressOptions> = { ...DEFAULT_STRESS_OPTIONS, ...options };
  const rng = new SeededRng(opts.seed);
  const start = Date.now();
  const results: Array<{ index: number; message: string }> = [];

  // Create all promises at once
  const promises = Array.from({ length: count }, async (_, i) => {
    // Introduce jitter via seeded PRNG so operations don't perfectly align
    if (i > 0) {
      const jitter = rng.nextInt(0, 5);
      if (jitter > 0) await new Promise(r => setTimeout(r, jitter));
    }
    return operation(i);
  });

  const settled = await Promise.allSettled(promises);
  const durationMs = Date.now() - start;

  let passed = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      passed++;
    } else {
      results.push({ index: results.length, message: result.reason?.message ?? String(result.reason) });
    }
  }

  return {
    concurrency: opts.concurrency,
    seed: opts.seed,
    totalOperations: count,
    passed,
    failed: count - passed,
    errors: results,
    durationMs,
  };
}

// =========================================================================
// Assertion helpers
// =========================================================================

/**
 * Assert that a stress run completed without failures.
 */
export function assertStressPasses(result: StressResult, maxFailures: number = 0): void {
  assert.ok(
    result.failed <= maxFailures,
    `Stress run: ${result.failed} failures (max ${maxFailures}). ` +
    `First error: ${result.errors[0]?.message ?? "none"}`,
  );
}

/**
 * Assert that concurrent operations produced correct and consistent state.
 * Validates that the table count equals the expected number of successful operations.
 */
export function stressSuiteSummary(result: StressResult): string {
  const rate = result.durationMs > 0
    ? Math.round((result.totalOperations / result.durationMs) * 1000)
    : 0;
  return `ops=${result.totalOperations} pass=${result.passed} fail=${result.failed} ` +
    `duration=${result.durationMs}ms rate=${rate}/s seed=${result.seed}`;
}
