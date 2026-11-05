import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const script = resolve(root, "scripts/test-ge04-release-verify.mjs");

test("GE-04 release signature, rollback-floor, and inert entrypoint regression suite", () => {
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", script], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, [result.stdout, result.stderr, result.error?.message].join("\n"));
  assert.match(result.stdout, /# tests 9/);
  assert.match(result.stdout, /# pass 9/);
});
