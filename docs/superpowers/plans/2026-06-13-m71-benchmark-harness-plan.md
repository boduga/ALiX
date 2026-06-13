# M0.71 — Performance Benchmark Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a repeatable benchmark harness that measures ALiX performance across startup, diagnostic, RuntimeIndex, daemon, context, and task execution dimensions — storing results in `.alix/benchmarks/<run-id>.json` for comparison.

**Architecture:** Each benchmark is an async function in `src/benchmark/cases/` that returns a timestamped result. A `BenchmarkRunner` orchestrates them, writes JSON results, and supports `--suite` filtering. Two CLI commands: `alix benchmark run` and `alix benchmark compare`.

**Tech Stack:** TypeScript, `performance.now()` / `Date.now()` for timing, `node:child_process` for subprocess benchmarks, existing `RuntimeIndex`/`loadConfig`/`detectSystem`/`daemon-server`, `node:test`.

---

## File Structure

### Create
- `src/benchmark/benchmark-types.ts` — `BenchmarkResult`, `BenchmarkSuite`, `BenchmarkRun`
- `src/benchmark/benchmark-runner.ts` — `runBenchmarks()`, `loadPreviousRun()`, `compareRuns()`
- `src/benchmark/cases/cli-startup.ts` — spawn `node dist/src/cli.js --help` measure wall clock
- `src/benchmark/cases/models-doctor.ts` — call `detectSystem()` + `runDoctor()` capture duration
- `src/benchmark/cases/runtime-index.ts` — build `RuntimeIndex` and execute queries
- `src/benchmark/cases/daemon-submit.ts` — connect to daemon, submit task, measure ack
- `src/benchmark/cases/context-compile.ts` — compile a repo map via context pipeline
- `src/benchmark/cases/no-tool-task.ts` — run a lightweight `alix run` that produces no side effects
- `src/cli/commands/benchmark.ts` — `alix benchmark run` and `alix benchmark compare` handlers
- `tests/benchmark/benchmark-runner.test.ts`
- `tests/benchmark/cases.test.ts`

### Modify
- `src/cli.ts` — add `alix benchmark` command dispatch and help text

---

### Task 1: Benchmark Types

**Files:**
- Create: `src/benchmark/benchmark-types.ts`

- [ ] **Step 1: Create benchmark-types.ts**

```typescript
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
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 3: Commit**

```bash
git add src/benchmark/benchmark-types.ts
git commit -m "feat(bench): add benchmark types (BenchmarkResult, BenchmarkRun, BenchmarkSuite)"
```

---

### Task 2: Benchmark Runner

**Files:**
- Create: `src/benchmark/benchmark-runner.ts`

- [ ] **Step 1: Create benchmark-runner.ts**

```typescript
/**
 * benchmark-runner.ts — Orchestrate benchmark cases, store and compare results.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { BenchmarkResult, BenchmarkRun, BenchmarkSuite } from "./benchmark-types.js";
import { ALIX_VERSION } from "../index.js";

// ─── Runner ────────────────────────────────────────────────────────────

export type BenchmarkCase = () => Promise<BenchmarkResult>;

export type RunOptions = {
  suite?: BenchmarkSuite;
  iterations?: number;     // samples per case (default 3, min 1)
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
    const files = readFileSync(dir, "utf-8")
      .split("\n")
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
  diffPct: string;   // "+12.3%" / "-5.1%"
  regression: boolean; // true if candidate > baseline by more than 10%
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
```

- [ ] **Step 2: Compile check**

Run: `npx tsc --noEmit`
Expected: clean compile

- [ ] **Step 3: Commit**

```bash
git add src/benchmark/benchmark-runner.ts
git commit -m "feat(bench): add benchmark runner with sampling, storage, and comparison"
```

---

### Task 3: Benchmark Cases

**Files:**
- Create: `src/benchmark/cases/cli-startup.ts`
- Create: `src/benchmark/cases/models-doctor.ts`
- Create: `src/benchmark/cases/runtime-index.ts`
- Create: `src/benchmark/cases/daemon-submit.ts`
- Create: `src/benchmark/cases/context-compile.ts`
- Create: `src/benchmark/cases/no-tool-task.ts`

- [ ] **Step 1: Create cli-startup.ts**

```typescript
/**
 * cli-startup.ts — Measure cold CLI startup by spawning `node dist/src/cli.js --help`.
 */

import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "dist", "src", "cli.js");

export async function runCliStartupBenchmark(): Promise<void> {
  execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf-8", timeout: 15000 });
}
```

- [ ] **Step 2: Create models-doctor.ts**

```typescript
/**
 * models-doctor.ts — Measure alix models doctor end-to-end (hardware + doctor + profile loading).
 */

export async function runModelsDoctorBenchmark(): Promise<void> {
  const { detectSystem } = await import("../../config/hardware-detect.js");
  const { runDoctor } = await import("../../models/model-doctor.js");
  const { loadProfiles } = await import("../../config/profile-registry.js");
  const system = detectSystem();
  const profiles = loadProfiles();
  runDoctor(system, {}, profiles);
}
```

- [ ] **Step 3: Create runtime-index.ts**

```typescript
/**
 * runtime-index.ts — Measure RuntimeIndex build and query in a real repo.
 */

import { join } from "node:path";
import { RuntimeIndex } from "../../runtime/runtime-index.js";

export async function runRuntimeIndexBenchmark(): Promise<void> {
  const cwd = process.cwd();
  const index = new RuntimeIndex(cwd);
  await index.build();
  await index.query({});            // unfiltered
  await index.query({ source: "session" });
  await index.query({ source: "graph" });
}
```

- [ ] **Step 4: Create daemon-submit.ts**

```typescript
/**
 * daemon-submit.ts — Measure daemon task submission acknowledgment.
 *
 * Requires daemon to be running. Skips gracefully if not.
 */

import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export async function runDaemonSubmitBenchmark(): Promise<void> {
  // Submit via CLI: alix daemon submit "echo ping" and measure until "task.accepted"
  // This is a best-effort benchmark — daemon may not be running
  try {
    execFileSync(process.execPath, [
      join(process.cwd(), "dist", "src", "cli.js"),
      "daemon", "submit", "echo ping", "--wait", "1000",
    ], { encoding: "utf-8", timeout: 10000 });
  } catch {
    // Daemon not available — the benchmark returns with max duration
  }
}
```

- [ ] **Step 5: Create context-compile.ts**

```typescript
/**
 * context-compile.ts — Measure repo map + context compilation in the current project.
 */

export async function runContextCompileBenchmark(): Promise<void> {
  const { buildRepoMapLite } = await import("../../repomap/repomap-lite.js");
  const result = await buildRepoMapLite(process.cwd());
  if (!result) throw new Error("context compile returned null");
}
```

- [ ] **Step 6: Create no-tool-task.ts**

```typescript
/**
 * no-tool-task.ts — Measure end-to-end alix run with a trivial task.
 *
 * Uses the mock provider to avoid API calls.
 */

export async function runNoToolTaskBenchmark(): Promise<void> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { randomUUID } = await import("node:crypto");

  const tmpDir = join(tmpdir(), `bench-task-${randomUUID()}`);
  mkdirSync(join(tmpDir, ".alix"), { recursive: true });
  writeFileSync(join(tmpDir, ".alix", "config.json"), JSON.stringify({
    model: { provider: "mock", name: "mock" },
    permissions: { default: "allow", tools: {}, protectedPaths: [], allowNetworkDomains: [], denyCommands: [] },
    context: { repoMap: false, repoMapMode: "lite", maxRepoMapTokens: 1000, semanticSearch: false, includeGitStatus: false, pinnedFiles: [] },
    runtime: { provider: "process", shell: "/bin/sh", commandTimeoutMs: 30000, envAllowlist: [] },
    ui: { enabled: false, host: "localhost", port: 3000, transport: "sse" },
    mcpServers: [],
  }));

  const { runTask } = await import("../../run.js");
  await runTask(tmpDir, 'respond with "hello"', { planMode: false, skipContext: true, sessionMode: "bypass" });
}
```

- [ ] **Step 7: Register all cases in a central registry**

Create a helper export in `src/benchmark/cases/index.ts`:

```typescript
/**
 * cases/index.ts — Registry of all benchmark cases, keyed by name.
 */

import type { BenchmarkSuite } from "../benchmark-types.js";
import { runCliStartupBenchmark } from "./cli-startup.js";
import { runModelsDoctorBenchmark } from "./models-doctor.js";
import { runRuntimeIndexBenchmark } from "./runtime-index.js";
import { runDaemonSubmitBenchmark } from "./daemon-submit.js";
import { runContextCompileBenchmark } from "./context-compile.js";
import { runNoToolTaskBenchmark } from "./no-tool-task.js";

export type CaseDef = { suite: BenchmarkSuite; label: string; run: () => Promise<void> };

export const BENCHMARK_CASES = new Map<string, CaseDef>([
  ["cli-startup",       { suite: "quick",   label: "CLI startup (--help)",           run: runCliStartupBenchmark }],
  ["models-doctor",     { suite: "quick",   label: "Hardware + model doctor",        run: runModelsDoctorBenchmark }],
  ["runtime-index",     { suite: "runtime", label: "RuntimeIndex build + query",     run: runRuntimeIndexBenchmark }],
  ["daemon-submit",     { suite: "daemon",  label: "Daemon submit + ack",            run: runDaemonSubmitBenchmark }],
  ["context-compile",   { suite: "runtime", label: "Context compilation (repo map)", run: runContextCompileBenchmark }],
  ["no-tool-task",      { suite: "quick",   label: "End-to-end no-tool task (mock)", run: runNoToolTaskBenchmark }],
]);
```

- [ ] **Step 8: Commit**

```bash
git add src/benchmark/cases/
git commit -m "feat(bench): add 6 benchmark cases (startup, doctor, index, daemon, compile, task)"
```

---

### Task 4: CLI Commands

**Files:**
- Create: `src/cli/commands/benchmark.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Create benchmark CLI**

```typescript
/**
 * benchmark.ts — CLI commands for the benchmark harness.
 *
 * alix benchmark run          Run all benchmark suites
 * alix benchmark run --suite quick
 * alix benchmark compare <baseline-run-id> <candidate-run-id>
 */

import { performance } from "node:perf_hooks";

export async function handleBenchmarkRun(args: string[]): Promise<void> {
  const { runBenchmarks, saveRun } = await import("../../benchmark/benchmark-runner.js");
  const { BENCHMARK_CASES } = await import("../../benchmark/cases/index.js");

  // Parse --suite argument
  let suite: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--suite" && args[i + 1]) suite = args[++i];
  }

  const start = performance.now();
  console.log(`Running benchmarks${suite ? ` (suite: ${suite})` : ""}...\n`);

  const run = await runBenchmarks(BENCHMARK_CASES, { suite: suite as any, iterations: 3 });
  saveRun(process.cwd(), run);

  const totalMs = Math.round((performance.now() - start) * 100) / 100;
  console.log(`\nDone. ${run.results.length} benchmarks completed in ${totalMs} ms.`);
  console.log(`Results saved to .alix/benchmarks/${run.runId}.json\n`);

  // Print summary table
  console.log("Summary:");
  console.log("  Name".padEnd(30) + "Mean (ms)".padEnd(12) + "p50".padEnd(10) + "p95");
  for (const r of run.results) {
    console.log(`  ${r.name.padEnd(28)} ${String(r.meanMs).padEnd(10)} ${String(r.p50Ms).padEnd(8)} ${r.p95Ms}`);
  }
}

export async function handleBenchmarkCompare(args: string[]): Promise<void> {
  const { loadPreviousRuns, compareRuns } = await import("../../benchmark/benchmark-runner.js");
  const baselineId = args[0];
  const candidateId = args[1];

  if (!baselineId || !candidateId) {
    console.error("Usage: alix benchmark compare <baseline-run-id> <candidate-run-id>");
    process.exit(1);
  }

  const runs = loadPreviousRuns(process.cwd());
  const baseline = runs.find(r => r.runId === baselineId);
  const candidate = runs.find(r => r.runId === candidateId);

  if (!baseline) { console.error(`Baseline run not found: ${baselineId}`); process.exit(1); }
  if (!candidate) { console.error(`Candidate run not found: ${candidateId}`); process.exit(1); }

  const rows = compareRuns(baseline, candidate);
  let hasRegression = false;

  console.log(`\nComparing ${baseline.runId} → ${candidate.runId}\n`);
  console.log("  Name".padEnd(30) + "Baseline".padEnd(12) + "Candidate".padEnd(12) + "Diff".padEnd(10) + "Regressed");
  for (const row of rows) {
    const regressed = row.regression ? "⚠️ YES" : "—";
    if (row.regression) hasRegression = true;
    console.log(`  ${row.name.padEnd(28)} ${String(row.baselineMs).padEnd(10)} ${String(row.candidateMs).padEnd(10)} ${row.diffPct.padEnd(8)} ${regressed}`);
  }

  if (hasRegression) {
    console.log("\n  ⚠️  Regression detected — candidate is >10% slower on one or more benchmarks.");
  } else {
    console.log("\n  ✅ No regression detected.");
  }
}

const HANDLERS: Record<string, (args: string[]) => Promise<void>> = {
  "run": handleBenchmarkRun,
  "compare": handleBenchmarkCompare,
};

export async function handleBenchmarkCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const handler = HANDLERS[sub];
  if (!handler) {
    console.error("Usage: alix benchmark <run|compare>");
    console.error("  alix benchmark run              Run all benchmarks");
    console.error("  alix benchmark run --suite quick Run quick benchmarks only");
    console.error("  alix benchmark compare <id> <id> Compare two benchmark runs");
    process.exit(1);
  }
  await handler(args.slice(1));
}
```

- [ ] **Step 2: Add dispatch and help text in src/cli.ts**

Find the command dispatch area and add:
```typescript
if (command === "benchmark") {
  const { handleBenchmarkCommand } = await import("./cli/commands/benchmark.js");
  await handleBenchmarkCommand(args);
}
```

Add to help text:
```
  alix benchmark run          Run performance benchmarks
  alix benchmark run --suite quick
  alix benchmark compare <id> <id>
```

- [ ] **Step 3: Build and compile check**

```bash
npm run build && npx tsc --noEmit
```

- [ ] **Step 4: Smoke test**

```bash
node dist/src/cli.js benchmark run --suite quick
```
Expected: runs CLI startup + models doctor + no-tool-task benchmarks, prints results.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/benchmark.ts src/cli.ts
git commit -m "feat(cli): add benchmark run and compare commands"
```

---

### Task 5: Tests

**Files:**
- Create: `tests/benchmark/benchmark-runner.test.ts`
- Create: `tests/benchmark/cases.test.ts`

- [ ] **Step 1: Test the runner**

Create `tests/benchmark/benchmark-runner.test.ts`:
```typescript
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
  afterEach(() => { rmSync(join(TEST_DIR, ".alix"), { recursive: true, force: true }); });

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
    const baseline = { runId: "a", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick", label: "Test", durationMs: 100, iterations: 1, minMs: 100, maxMs: 100, meanMs: 100, p50Ms: 100, p95Ms: 100 }] };
    const candidate = { runId: "b", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick", label: "Test", durationMs: 150, iterations: 1, minMs: 150, maxMs: 150, meanMs: 150, p50Ms: 150, p95Ms: 150 }] };
    const rows = compareRuns(baseline, candidate);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].regression, true);
    assert.ok(rows[0].diffPct.includes("+50"));
  });

  it("no regression when within threshold", () => {
    const baseline = { runId: "a", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick", label: "Test", durationMs: 100, iterations: 1, minMs: 100, maxMs: 100, meanMs: 100, p50Ms: 100, p95Ms: 100 }] };
    const candidate = { runId: "b", createdAt: "", cliVersion: "t", results: [{ name: "test", suite: "quick", label: "Test", durationMs: 105, iterations: 1, minMs: 105, maxMs: 105, meanMs: 105, p50Ms: 105, p95Ms: 105 }] };
    const rows = compareRuns(baseline, candidate);
    assert.equal(rows[0].regression, false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm run build && node --test dist/tests/benchmark/benchmark-runner.test.js
```
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/benchmark/benchmark-runner.test.ts
git commit -m "test(bench): add runner, storage, and comparison tests"
```

---

### Verification

1. `npm run build` — clean compile
2. `node --test dist/tests/benchmark/benchmark-runner.test.js` — all tests pass
3. `node dist/src/cli.js benchmark run --suite quick` — 3 benchmarks run in < 30 s
4. `ls .alix/benchmarks/` — JSON result file present
5. `node dist/src/cli.js benchmark compare <first> <second>` — comparison table printed
6. Per CLAUDE.md: `mcp__gitnexus__detect_changes` — confirm only intended files changed
