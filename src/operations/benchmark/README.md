# Benchmark Harness

## Overview

Performance measurement harness: a runner that samples benchmark cases, a
typed result/run model, on-disk storage under `.alix/benchmarks`, and
comparison against a baseline run. The runner is orchestration and statistics
only; individual workloads live in the `cases/` registry, which is not part of
this contract.

## Interface

- `BenchmarkResult` — one measurement: `name`, `suite`, `label`, `durationMs`, `iterations`, `minMs`, `maxMs`, `meanMs`, `p50Ms`, `p95Ms`, optional `metadata` (`benchmark-types.ts:BenchmarkResult`).
- `BenchmarkRun` — a stored run: `runId`, `createdAt`, `cliVersion`, `results`, optional environment `metadata` (`benchmark-types.ts:BenchmarkRun`).
- `BenchmarkSuite` — closed set `"quick" | "runtime" | "daemon"` (`benchmark-types.ts:BenchmarkSuite`).
- `BenchmarkCase` / `RunOptions` — a case is `() => Promise<BenchmarkResult>`; options are `suite?` and `iterations?` (`benchmark-runner.ts:BenchmarkCase`, `benchmark-runner.ts:RunOptions`).
- `sample(...)` — runs a workload `iterations` times and computes min/max/mean/p50/p95 with two-decimal rounding (`benchmark-runner.ts:sample`).
- `runBenchmarks(cases, opts)` — filters by suite, samples each case, prints progress, and returns a `BenchmarkRun` with a `bench_<iso>` id and `cliVersion` from `ALIX_VERSION` (`benchmark-runner.ts:runBenchmarks`).
- `saveRun(cwd, run)` / `loadPreviousRuns(cwd)` — persist one run as `<runId>.json` and reload prior runs (`benchmark-runner.ts:saveRun`, `benchmark-runner.ts:loadPreviousRuns`).
- `ComparisonRow` / `compareRuns(baseline, candidate)` — per-case mean deltas with `diffPct` string and a `regression` flag (`benchmark-runner.ts:compareRuns`).
- `cases/` — workload registry keyed by kebab-case name [./cases/README.md](./cases/README.md) (`cases/index.ts:BENCHMARK_CASES`).

## Invariants

- Iterations are floored at `MIN_ITERATIONS = 1`, with `DEFAULT_ITERATIONS = 3` when unset (`benchmark-runner.ts:DEFAULT_ITERATIONS`, `benchmark-runner.ts:MIN_ITERATIONS`).
- Percentiles are computed from the sorted sample array by index, and sampled indexes are clamped for p95 (`benchmark-runner.ts:sample`).
- `compareRuns` only compares case names present in both runs, and flags `regression: true` when the candidate mean exceeds the baseline mean by more than 10% (`benchmark-runner.ts:compareRuns`).
- A missing `ALIX_VERSION` string degrades the run's `cliVersion` to `"dev"` rather than failing (`benchmark-runner.ts:runBenchmarks`).
- `loadPreviousRuns` returns `[]` when the directory is absent or reading/parsing fails; unreadable history is not an error (`benchmark-runner.ts:loadPreviousRuns`).
- `diffPct` is `"—"` when the baseline mean is zero, avoiding division by zero (`benchmark-runner.ts:compareRuns`).

## Side Effects

- `saveRun` creates `<cwd>/.alix/benchmarks` recursively and writes `<runId>.json` with two-space JSON (`benchmark-runner.ts:benchmarksDir`, `benchmark-runner.ts:saveRun`).
- `runBenchmarks` writes progress lines to stdout via `console.log` (`benchmark-runner.ts:runBenchmarks`).
- `loadPreviousRuns` reads and JSON-parses every `*.json` file in the benchmarks directory (`benchmark-runner.ts:loadPreviousRuns`).
- Case workloads themselves may spawn processes or write temporary state; that behavior belongs to `cases/`, not the runner (`benchmark-runner.ts:runBenchmarks`).

## Verification

- Run: `pnpm test`
