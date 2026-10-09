/**
 * benchmark-types.ts — Shared types for the performance benchmark harness.
 */

/** A single benchmark measurement. */
export type BenchmarkResult = {
  name: string;           // kebab-case unique name, e.g. "cli-startup"
  suite: string;          // "quick" | "runtime" | "daemon"
  label: string;          // human-readable, e.g. "CLI startup (--help)"
  durationMs: number;     // wall-clock duration in milliseconds
  iterations: number;     // number of samples taken
  minMs: number;
  maxMs: number;
  meanMs: number;
  p50Ms: number;          // median
  p95Ms: number;
  metadata?: Record<string, string | number>;  // e.g. { eventCount: "5000", modelCount: "3" }
};

/** A complete benchmark run stored on disk. */
export type BenchmarkRun = {
  runId: string;          // iso-timestamp-based, e.g. "bench_20260613_120000"
  createdAt: string;      // ISO timestamp
  cliVersion: string;     // from ALIX_VERSION
  results: BenchmarkResult[];
  metadata?: {
    profile?: string;     // active modelProfile, if any
    os?: string;
    cpu?: string;
    ramGb?: number;
  };
};

/** Suite names used with --suite filtering. */
export type BenchmarkSuite = "quick" | "runtime" | "daemon";
