# Benchmark Cases

## Overview
Runnable benchmark bodies registered by name for the operations benchmark runner. Each case wraps one measurable ALiX path — CLI cold start, model doctor, runtime index build, daemon submit, context compilation, and a mock-provider end-to-end task — behind a uniform `() => Promise<void>` signature so the runner can time it without knowing its internals.

## Interface
- `CaseDef` — `{suite, label, run}` descriptor for a registered case [index.ts:CaseDef]
- `BENCHMARK_CASES` — `Map<string, CaseDef>` keyed by case name, spanning suites `quick`, `runtime`, and `daemon` [index.ts:BENCHMARK_CASES]
- `findRepoRoot(startDir)`, `resolveBuiltCliPath(startDir?)`, `runCliStartupBenchmark()` [cli-startup.ts:findRepoRoot], [cli-startup.ts:resolveBuiltCliPath], [cli-startup.ts:runCliStartupBenchmark]
- `runContextCompileBenchmark()` [context-compile.ts:runContextCompileBenchmark]
- `runDaemonSubmitBenchmark()` [daemon-submit.ts:runDaemonSubmitBenchmark]
- `runModelsDoctorBenchmark()` [models-doctor.ts:runModelsDoctorBenchmark]
- `runNoToolTaskBenchmark()` [no-tool-task.ts:runNoToolTaskBenchmark]
- `runRuntimeIndexBenchmark()` [runtime-index.ts:runRuntimeIndexBenchmark]
- No subdirectories.

## Invariants
- Case names are the map keys, and only the six registered names are discoverable [index.ts:BENCHMARK_CASES]
- Every case is async and returns `void`; success is completion without throwing [index.ts:CaseDef]
- `BENCHMARK_CASES` is the single registry; adding a case requires a new entry there [index.ts:BENCHMARK_CASES]
- `findRepoRoot` skips any directory named `dist` so a copied package.json cannot be mistaken for the repo root, and throws when it reaches the filesystem root [cli-startup.ts:findRepoRoot]
- `resolveBuiltCliPath` resolves `<repoRoot>/dist/src/cli.js`, i.e. it requires a completed build [cli-startup.ts:resolveBuiltCliPath]
- `runDaemonSubmitBenchmark` swallows any failure, so a missing daemon produces a fast success instead of a benchmark error [daemon-submit.ts:runDaemonSubmitBenchmark]
- `runContextCompileBenchmark` throws when `buildRepoMapLite` returns null [context-compile.ts:runContextCompileBenchmark]
- `runNoToolTaskBenchmark` always removes its temporary workspace in a `finally` block [no-tool-task.ts:runNoToolTaskBenchmark]
- `runNoToolTaskBenchmark` pins a `mock` provider and disables repo map/semantic search in its generated config [no-tool-task.ts:runNoToolTaskBenchmark]

## Side Effects
- Spawns child processes for CLI startup and daemon submit with 15 s and 10 s timeouts [cli-startup.ts:runCliStartupBenchmark], [daemon-submit.ts:runDaemonSubmitBenchmark]
- Builds a runtime index over `process.cwd()` and exercises `byAction`, `bySession`, `byGraph`, and `events` [runtime-index.ts:runRuntimeIndexBenchmark]
- Compiles the repo map for `process.cwd()` [context-compile.ts:runContextCompileBenchmark]
- Detects hardware and loads profiles, then runs the model doctor [models-doctor.ts:runModelsDoctorBenchmark]
- Creates and deletes a temp directory under `tmpdir()`, writing `.alix/config.json` and running a real task loop [no-tool-task.ts:runNoToolTaskBenchmark]
- No network calls are made directly by these modules; any network use is inside the delegated code paths [index.ts:BENCHMARK_CASES]

## Verification
- Run: `pnpm test`
