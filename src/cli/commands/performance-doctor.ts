/**
 * performance-doctor.ts — Passive budget check against stored benchmarks.
 *
 * Reads the latest saved benchmark run from .alix/benchmarks/ and
 * checks each measurement against its performance budget.
 * Does NOT run new benchmarks.
 *
 * Returns a numeric exit code: 0 = pass/warning, 1 = fail, 2 = no data.
 */

import { loadPreviousRuns } from "../../benchmark/benchmark-runner.js";
import { checkAllBudgets } from "../../config/performance-budgets.js";

export async function runPerformanceDoctor(cwd: string): Promise<number> {
  const runs = loadPreviousRuns(cwd);
  if (runs.length === 0) {
    console.log("No benchmark data found. Run: alix benchmark run --suite quick");
    return 2;
  }

  // Use the most recent run
  const latest = runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  console.log(`Checking budgets against ${latest.runId} (${latest.createdAt})\n`);

  const results = checkAllBudgets(latest.results);
  let hasFailure = false;
  let hasWarning = false;

  for (const r of results) {
    if (r.status === "fail") hasFailure = true;
    if (r.status === "warning") hasWarning = true;
    console.log(`  ${r.message}`);
  }

  if (hasFailure) {
    console.log("\n  ❌ Some budgets exceeded — review data or tune thresholds.");
    return 1;
  }
  if (hasWarning) {
    console.log("\n  ⚠️  Some budgets in warning range.");
    return 0;
  }
  console.log("\n  ✅ All budgets pass.");
  return 0;
}
