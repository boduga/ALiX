import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const script = resolve(root, "scripts/test-ge04-inert-supervisor.py");

test("GE-04 inert supervisor tests deny every request and refuse production startup", {
  skip: process.platform !== "linux",
}, () => {
  const availability = spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 });
  if (availability.error) {
    throw new Error("Linux CI requires Python 3 for the inert supervisor qualification tests");
  }
  const result = spawnSync("python3", [script], {
    cwd: root, encoding: "utf8", timeout: 25_000,
  });
  assert.equal(result.status, 0, [result.stdout, result.stderr, result.error?.message].join("\n"));
  assert.match(result.stderr, /Ran 8 tests/);
  assert.match(result.stderr, /OK/);
});
