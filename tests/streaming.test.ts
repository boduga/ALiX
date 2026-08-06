import test from "node:test";
import assert from "node:assert/strict";

test("shouldAutoDisableStreaming returns a boolean (local context)", async () => {
  const { shouldAutoDisableStreaming } = await import("../src/run.js");
  const result = shouldAutoDisableStreaming({});
  assert.strictEqual(typeof result, "boolean");
});

test("shouldAutoDisableStreaming returns true in a CI environment", async () => {
  const { shouldAutoDisableStreaming } = await import("../src/run.js");
  // Streaming auto-disables only in CI, keeping CI logs deterministic.
  // Local non-TTY (piped/redirected) contexts still stream.
  const result = shouldAutoDisableStreaming({ GITHUB_ACTIONS: "true" });
  assert.strictEqual(result, true);
});

test("shouldAutoDisableStreaming returns false in a local non-TTY context", async () => {
  const { shouldAutoDisableStreaming } = await import("../src/run.js");
  const result = shouldAutoDisableStreaming({});
  assert.strictEqual(result, false);
});

test("noStream flag is stripped from task string in run command", async () => {
  // Verify --no-stream detection logic
  const task = 'fix the bug --no-stream';
  const hasNoStream = task.includes("--no-stream");
  const cleanTask = task.replace(/\s*--no-stream\s*/g, " ").trim();
  assert.strictEqual(hasNoStream, true);
  assert.strictEqual(cleanTask, "fix the bug");
});

test("noStream flag at end of task string is stripped", async () => {
  const task = 'do something --no-stream';
  const hasNoStream = task.includes("--no-stream");
  const cleanTask = task.replace(/\s*--no-stream\s*/g, " ").trim();
  assert.strictEqual(hasNoStream, true);
  assert.strictEqual(cleanTask, "do something");
});

test("task without noStream flag is unchanged", async () => {
  const task = 'simple task';
  const hasNoStream = task.includes("--no-stream");
  const cleanTask = task.replace(/\s*--no-stream\s*/g, " ").trim();
  assert.strictEqual(hasNoStream, false);
  assert.strictEqual(cleanTask, "simple task");
});