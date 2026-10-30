import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve, sep } from "node:path";

// The test-only tsc output is nested under dist/tests/tests and must not be
// discovered alongside the canonical build's dist/tests/<suite> output.
test("node runner discovers each canonical compiled test exactly once", () => {
  const output = execFileSync(process.execPath, ["scripts/run-node-tests.mjs", "--list"], {
    cwd: resolve("."), encoding: "utf8", timeout: 15_000,
  });
  const files = output.split(/\r?\n/).filter(line => line.endsWith(".test.js"));
  assert.ok(files.length > 0, "expected compiled tests");
  assert.equal(files.length, new Set(files).size, "duplicate compiled test path");
  assert.ok(files.every(file => !file.includes(`${sep}dist${sep}tests${sep}tests${sep}`)),
    "nested test-only output must not be executed");
  assert.ok(files.some(file => file.endsWith(`${sep}security${sep}d9-full-daemon.test.js`)),
    "canonical daemon security test must remain discoverable");
});
