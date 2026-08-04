import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runSandboxed } from "../../src/skills/sandbox.js";

describe("runSandboxed", () => {
  it("runs a command and captures stdout", async () => {
    const r = await runSandboxed("printf", { args: ["hello-from-sandbox"] });
    assert.equal(r.ok, true);
    assert.equal(r.stdout, "hello-from-sandbox");
    assert.equal(r.exitCode, 0);
  });

  it("isolates HOME to a fresh temp dir and filters the environment", async () => {
    const script = "printf '%s' \"$HOME|$SECRET\"";
    const r = await runSandboxed("sh", { args: ["-c", script] });
    assert.match(r.stdout, /^\/tmp\/alix-sandbox-/);
    assert.match(r.stdout, /\|$/); // $SECRET is undefined -> empty
    assert.notEqual(r.stdout.split("|")[0], process.env.HOME);
  });

  it("kills long-running scripts on timeout", async () => {
    const r = await runSandboxed("sleep", { args: ["5"], timeoutMs: 300 });
    assert.equal(r.timedOut, true);
    assert.equal(r.ok, false);
  });

  it("reports non-zero exit codes", async () => {
    const r = await runSandboxed("sh", { args: ["-c", "exit 3"] });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 3);
  });

  it("reports networkIsolated as a boolean and respects noNetwork=false", async () => {
    const r = await runSandboxed("true", { noNetwork: false });
    assert.equal(r.ok, true);
    assert.equal(r.networkIsolated, false);
  });
});
