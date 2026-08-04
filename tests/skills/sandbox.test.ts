import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSandboxed } from "../../src/skills/sandbox.js";

const UNSHARE_ENV = "ALIX_UNSHARE";

/** Point ALIX_UNSHARE at an executable fake `unshare` script for the test, then restore. */
async function withFakeUnshare(script: string, fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "alix-fake-unshare-"));
  const fakeUnshare = join(dir, "unshare");
  await writeFile(fakeUnshare, script);
  await chmod(fakeUnshare, 0o755);
  const prev = process.env[UNSHARE_ENV];
  process.env[UNSHARE_ENV] = fakeUnshare;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[UNSHARE_ENV];
    else process.env[UNSHARE_ENV] = prev;
    await rm(dir, { recursive: true, force: true });
  }
}

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

  it("falls back to plain spawn when unshare fails at the syscall level (EPERM)", async () => {
    // Simulate a locked-down host where the unshare() syscall fails: util-linux
    // prints this marker to stderr and exits 1 WITHOUT running the command. The
    // runner must treat that as a start failure and fall back to the plain spawn.
    await withFakeUnshare(
      "#!/bin/sh\necho 'unshare: unshare failed: Operation not permitted' >&2\nexit 1\n",
      async () => {
        const r = await runSandboxed("printf", { args: ["fell-back"] });
        assert.equal(r.ok, true);
        assert.equal(r.stdout, "fell-back");
        assert.equal(r.networkIsolated, false); // fell through to plain spawn
      },
    );
  });

  it("keeps unshare: failed to execute (exit 127) as a real result without falling back", async () => {
    // Namespace created but the inner command is missing — a REAL result, not a
    // start failure. The result is reported as-is with networkIsolated: true.
    await withFakeUnshare(
      "#!/bin/sh\necho 'unshare: failed to execute /nope: No such file or directory' >&2\nexit 127\n",
      async () => {
        const r = await runSandboxed("printf", { args: ["not-run"] });
        assert.equal(r.ok, false);
        assert.equal(r.exitCode, 127);
        assert.equal(r.networkIsolated, true);
        assert.equal(r.stdout, "");
      },
    );
  });
});
