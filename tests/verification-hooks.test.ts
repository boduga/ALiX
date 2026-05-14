import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { discoverHooks } from "../src/hooks/discover.js";
import { runHook } from "../src/hooks/runner.js";

test("discoverHooks reads .alix/hooks.json with pre/post/task checks", async () => {
  const dir = await import("node:fs/promises").then(m => m.mkdtemp("/tmp/alix-hook-test-"));
  const hooksPath = join(dir, ".alix", "hooks.json");
  await mkdir(join(dir, ".alix"), { recursive: true });
  await writeFile(hooksPath, JSON.stringify({
    pre_task: [{ command: "echo pre", reason: "pre check" }],
    post_task: [{ command: "echo post", reason: "post check" }]
  }));
  const hooks = await discoverHooks(dir);
  assert.equal(hooks.pre_task?.length ?? 0, 1);
  assert.equal(hooks.pre_task?.[0].command ?? "", "echo pre");
  assert.equal(hooks.post_task?.length ?? 0, 1);
  await rm(dir, { recursive: true });
});

test("runHook runs command and returns passed/output/exitCode", async () => {
  const result = await runHook({ command: "echo hello world", reason: "test" }, "/tmp");
  assert.equal(result.passed, true);
  assert.ok(result.output.includes("hello world"));
  assert.equal(result.exitCode, 0);
});

test("runHook returns passed:false on non-zero exit", async () => {
  const result = await runHook({ command: "exit 1", reason: "test" }, "/tmp");
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 1);
});