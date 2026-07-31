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

/** Recursively collect *.test.js files, honoring the manual/ filter. */
function collect(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      const isManual = entry === "manual";
      if (onlyManual !== isManual) continue;
      collect(full, out);
    } else if (entry.endsWith(".test.js")) {
      out.push(full);
    }
  }
}

const files = [];
collect(DIST_TESTS, files);
console.log(`[test:${onlyManual ? "manual" : includeSlow ? "slow" : "node"}] ${files.length} test file(s)`);

const testArgs = ["--test", "--test-timeout=30000"];
if (onlyManual) testArgs.push("--test-concurrency=1");
const child = spawn(process.execPath, [...testArgs, ...files], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
