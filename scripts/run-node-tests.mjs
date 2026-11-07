#!/usr/bin/env node
/**
 * Cross-platform node:test runner for dist/tests/.
 *
 * Default mode runs every compiled `*.test.js` under dist/tests/ EXCEPT the
 * `manual/` suites (tests/manual/*.test.ts), which require live model calls,
 * API keys, or a TTY and are meant to run interactively:
 *
 *   pnpm test:node        → automated suite (excludes manual/)
 *   pnpm test:manual      → only the manual suites (--manual)
 *
 * A Node runner (instead of shell globs) keeps this consistent on
 * Linux/macOS/Windows CI.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DIST_TESTS = join(process.cwd(), "dist", "tests");
const onlyManual = process.argv.includes("--manual");
const includeSlow = process.argv.includes("--slow");

// Heavy context-compilation tests (tests/repomap/warm-overhead,
// tests/repomap/context-events) compile the whole repo and can take many
// minutes. Exclude them from the default automated run; opt in explicitly
// with pnpm test:slow.
if (!onlyManual && !includeSlow) {
  process.env.ALIX_SKIP_SLOW_TESTS = "1";
}

/** Recursively collect *.test.js files, honoring the manual/ filter.
 *
 * soak/ and stress/ are timing-sensitive wall-clock suites with dedicated
 * runners (`pnpm test:soak` / `pnpm test:stress`) and workload-scaled
 * per-test budgets that only hold at low parallelism — they time out
 * nondeterministically in this default multi-file lane. They stay opt-in,
 * exactly like CI's test:node:ci filter which excludes soak/ outright.
 */
const TIMING_SENSITIVE = new Set(["soak", "stress"]);

function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    // tsconfig.tests.json emits a second copy under dist/tests/tests/.
    // Those copies resolve ../../src relative to the wrong output root;
    // run only the canonical dist/tests/<suite>/ artifacts.
    if (dir === DIST_TESTS && entry === "tests") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      const isManual = entry === "manual";
      if (onlyManual !== isManual) continue;
      if (!onlyManual && !includeSlow && TIMING_SENSITIVE.has(entry)) continue;
      collect(full, out);
    } else if (entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
}

const files = [];
collect(DIST_TESTS, files);
console.log(`[test:${onlyManual ? "manual" : includeSlow ? "slow" : "node"}] ${files.length} test file(s)`);
if (process.argv.includes("--list")) {
  // stdout can be asynchronous when piped to a parent process. Calling
  // process.exit() here truncates the manifest intermittently before the
  // buffered writes drain (observed as 575/672/751 of 751 test paths).
  for (const file of files) console.log(file);
  process.exitCode = 0;
} else {
  const testArgs = ["--test", "--test-timeout=30000"];
  // Bound concurrent test processes: the Node default scales with CPU count,
  // which can overwhelm daemon startup and child-process timeout tests.
  // Keep manual tests serial; allow explicit override for CI/diagnostics.
  const configuredConcurrency = process.env.ALIX_NODE_TEST_CONCURRENCY;
  const concurrency = onlyManual ? 1 : configuredConcurrency === undefined ? 4 : Number(configuredConcurrency);
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error("ALIX_NODE_TEST_CONCURRENCY must be a positive integer");
  }
  testArgs.push(`--test-concurrency=${concurrency}`);
  // DaemonManager changes HOME and exercises the per-user daemon socket.
  // Other daemon tests also spawn real processes; run this suite in its own
  // lane to avoid cross-file ownership races, without serializing all tests.
  const exclusive = onlyManual ? [] : files.filter((f) => f.endsWith("/daemon/daemon-manager.test.js"));
  const parallel = files.filter((f) => !exclusive.includes(f));
  const run = (paths, args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [...args, ...paths], { stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
  const parallelExit = await run(parallel, testArgs);
  // Always execute the exclusive lane even if the main lane failed, so the
  // report captures both results and doesn't hide a daemon regression.
  const exclusiveExit = exclusive.length
    ? await run(exclusive, ["--test", "--test-timeout=30000", "--test-concurrency=1"])
    : 0;
  process.exitCode = parallelExit || exclusiveExit ? 1 : 0;
}
