import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runHook } from "../../src/hooks/runner.js";
import type { Hook } from "../../src/hooks/discover.js";

describe("runHook", () => {
  it("returns passed=true when command exits with code 0", async () => {
    const hook: Hook = { command: "echo hello", reason: "test" };
    const result = await runHook(hook, process.cwd());
    assert.equal(result.passed, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.output.includes("hello"));
  });

  it("returns passed=false when command exits with non-zero code", async () => {
    const hook: Hook = { command: "exit 1", reason: "test" };
    const result = await runHook(hook, process.cwd());
    assert.equal(result.passed, false);
    assert.equal(result.exitCode, 1);
  });

  it("returns passed=false when command is not found", async () => {
    const hook: Hook = { command: "nonexistent-command-xyz", reason: "test" };
    const result = await runHook(hook, process.cwd());
    assert.equal(result.passed, false);
    // On Linux, ENOENT (command not found) exits with code 127; on other systems may be -1
    assert.ok(result.exitCode === 127 || result.exitCode === -1);
  });

  it("passes env variables to the command", async () => {
    const hook: Hook = { command: "printenv MY_VAR", reason: "test", env: { MY_VAR: "hello-world" } };
    const result = await runHook(hook, process.cwd());
    assert.equal(result.passed, true);
    assert.ok(result.output.includes("hello-world"));
  });
});