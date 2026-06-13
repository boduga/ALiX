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
    const regressed = row.regression ? "⚠ YES" : "—";
    if (row.regression) hasRegression = true;
    console.log(`  ${row.name.padEnd(28)} ${String(row.baselineMs).padEnd(10)} ${String(row.candidateMs).padEnd(10)} ${row.diffPct.padEnd(8)} ${regressed}`);
  }

  if (hasRegression) {
    console.log("\n  ⚠  Regression detected — candidate is >10% slower on one or more benchmarks.");
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
