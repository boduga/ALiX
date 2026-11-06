import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = resolve(root, "scripts/ge04-q2-custody-fixture.py");
const tests = resolve(root, "scripts/test-ge04-q2-custody-fixture.py");

test("GE-04 Q2: distinct-process deny-only custody fixture", {
  skip: process.platform !== "linux",
}, () => {
  const python = spawnSync("python3", ["--version"], { encoding: "utf8", timeout: 5_000 });
  assert.equal(python.status, 0, "Linux CI must provide Python 3");
  const run = spawnSync("python3", [tests], {
    cwd: root, encoding: "utf8", timeout: 30_000,
  });
  assert.equal(run.status, 0, [run.stdout, run.stderr, run.error?.message].join("\n"));
  assert.match(run.stderr, /Ran 13 tests/);
  assert.match(run.stderr, /OK/);
});

test("GE-04 Q2: fixture executable never starts a supervisor", {
  skip: process.platform !== "linux",
}, () => {
  const run = spawnSync("python3", [fixture], {
    cwd: root, encoding: "utf8", timeout: 5_000,
  });
  assert.equal(run.status, 78, run.stderr);
  assert.match(run.stderr, /SECURITY HOLD/);
});
