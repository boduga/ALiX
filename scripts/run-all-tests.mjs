#!/usr/bin/env node
/**
 * Run the node:test and vitest lanes sequentially and aggregate their exit
 * codes, so a failure in one lane can never hide the other's results (#726).
 *
 *   node scripts/run-all-tests.mjs        → test:node + test:vitest
 *   node scripts/run-all-tests.mjs --ci   → test:node:ci + test:vitest
 *
 * Both lanes always run; the process exits non-zero if either failed.
 */

import { spawn } from "node:child_process";

const ci = process.argv.includes("--ci");
const lanes = [ci ? "test:node:ci" : "test:node", "test:vitest"];

function run(script) {
  return new Promise((resolve) => {
    const child = spawn("pnpm", [script], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", (err) => {
      console.error(`[test] failed to start ${script}: ${err.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let failed = false;
for (const lane of lanes) {
  const code = await run(lane);
  if (code !== 0) {
    failed = true;
    console.error(`\n[test] ${lane} failed (exit ${code})`);
  }
}
process.exit(failed ? 1 : 0);
