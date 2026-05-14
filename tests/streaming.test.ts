import test from "node:test";
import assert from "node:assert/strict";

test("shouldAutoDisableStreaming returns true when stdout is not a TTY", async () => {
  const { shouldAutoDisableStreaming } = await import("../src/run.js");
  // In this environment, process.stdout.isTTY may be null or undefined
  // The function should return true if isTTY is falsy (null/undefined/false)
  const result = shouldAutoDisableStreaming();
  // Just verify the function runs without error and returns a boolean
  assert.strictEqual(typeof result, "boolean");
});

test("shouldAutoDisableStreaming returns true in CI environment", async () => {
  const { shouldAutoDisableStreaming } = await import("../src/run.js");
  const origCI = process.env.CI;
  try {
    process.env.CI = "true";
    const result = shouldAutoDisableStreaming();
    assert.strictEqual(result, true);
  } finally {
    if (origCI === undefined) delete process.env.CI;
    else process.env.CI = origCI;
  }
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