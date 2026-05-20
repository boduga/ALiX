import { describe, it } from "node:test";
import assert from "node:assert";
import { CommandRunner } from "../../src/verification/command-runner.js";

describe("CommandRunner", () => {
  it("executes command and captures output", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("echo 'hello world'", { timeout: 5000 });

    assert.ok(result.success);
    assert.ok(result.stdout.includes("hello world"));
    assert.equal(result.exitCode, 0);
  });

  it("respects timeout", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("sleep 10", { timeout: 100 });

    assert.ok(!result.success);
    assert.equal(result.error, "timeout");
  });

  it("captures stderr separately", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("echo error >&2", { timeout: 5000 });

    assert.ok(result.stderr.includes("error"));
  });

  it("tracks duration", async () => {
    const runner = new CommandRunner();
    const result = await runner.run("echo test", { timeout: 5000 });

    assert.ok(result.durationMs >= 0);
    assert.ok(result.durationMs < 5000);
  });
});
