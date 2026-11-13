# Concurrency Testing Harness

## Overview

A single-module test harness for concurrent behaviour: a seeded Mulberry32 pseudo-random number generator, a `runConcurrent` runner that starts N operations at once and collects settled outcomes into a `StressResult`, and assertion/summary helpers built on `node:assert/strict`. It is consumed by the stress suites under `tests/stress/` and holds no production state.

## Interface

- Deterministic PRNG: `SeededRng` with `next()` returning a float in `[0, 1)` and `nextInt(min, max)` returning an inclusive integer `[concurrency-harness.ts:SeededRng]` `[concurrency-harness.ts:SeededRng.nextInt]`.
- Operation shape: `AsyncOperation<T>` is `(index: number) => Promise<T>` `[concurrency-harness.ts:AsyncOperation]`.
- Options: `StressOptions` carries `concurrency`, `seed`, and `operationTimeout` `[concurrency-harness.ts:StressOptions]`.
- Report shape: `StressResult` carries `concurrency`, `seed`, `totalOperations`, `passed`, `failed`, `errors`, and `durationMs` `[concurrency-harness.ts:StressResult]`.
- Runner: `runConcurrent<T>(count, operation, options?)` returns a `StressResult` `[concurrency-harness.ts:runConcurrent]`.
- Assertions: `assertStressPasses(result, maxFailures = 0)` `[concurrency-harness.ts:assertStressPasses]`.
- Reporting: `stressSuiteSummary(result)` renders an `ops=/pass=/fail=/duration=/rate=/seed=` line `[concurrency-harness.ts:stressSuiteSummary]`.

## Invariants

- Defaults are a concurrency of 50, `seed: Date.now()`, and `operationTimeout: 5000`, merged with caller options `[concurrency-harness.ts:DEFAULT_STRESS_OPTIONS]`.
- Every operation promise is created up front with `Array.from`, so `count` operations start together regardless of the `concurrency` value; `concurrency` is echoed into the result and does not bound parallelism `[concurrency-harness.ts:runConcurrent]`.
- `operationTimeout` is part of `StressOptions` and the defaults, but `runConcurrent` applies no per-operation timeout; outcomes are collected only through `Promise.allSettled` `[concurrency-harness.ts:StressOptions]` `[concurrency-harness.ts:runConcurrent]`.
- Jitter is applied to every operation except index 0, drawn from the seeded PRNG as 0–5 ms, so a fixed seed reproduces the same interleaving `[concurrency-harness.ts:runConcurrent]`.
- `passed` counts fulfilled outcomes and `failed` is `count - passed`; rejected reasons are reduced to `message` or `String(reason)` `[concurrency-harness.ts:runConcurrent]`.
- Error entries record the ordinal position of the failure (`results.length`), not the operation's `index` `[concurrency-harness.ts:runConcurrent]`.
- `assertStressPasses` fails only when `failed` exceeds `maxFailures` and quotes the first error message `[concurrency-harness.ts:assertStressPasses]`.
- `stressSuiteSummary` derives throughput as `round(totalOperations / durationMs * 1000)` and reports 0 when the duration is 0 `[concurrency-harness.ts:stressSuiteSummary]`.
- `SeededRng` coerces the seed with `| 0`, so distinct large seeds can collapse to the same internal state `[concurrency-harness.ts:SeededRng]`.

## Side Effects

- Operation jitter schedules `setTimeout` timers of up to 5 ms `[concurrency-harness.ts:runConcurrent]`.
- `runConcurrent` executes caller-supplied operations; all real side effects belong to those operations `[concurrency-harness.ts:runConcurrent]`.
- `assertStressPasses` throws an `AssertionError` on a failing run `[concurrency-harness.ts:assertStressPasses]`.
- No filesystem, network, environment, or process-level effects are performed by this module `[concurrency-harness.ts:runConcurrent]`.

## Verification

- Run: `pnpm test`
