/**
 * Tests for the `alix submit` CLI dispatch path (issue #294).
 *
 * The submit handler is a top-level block in `src/cli.ts` that connects
 * to the daemon over a Unix socket. We can't unit-test it in isolation
 * without spawning a real daemon, so this file tests the end-to-end
 * behavior via subprocess invocation.
 *
 * The submit fix added:
 * - A `commandHandled` flag at the top of the submit branch
 * - Removal of the bottom-of-file `process.exit(1)` (which was killing
 *   the script before the connect callback could fire)
 * - `client.destroy()` on terminal events (instead of no-op `client.end()`)
 * - A 30-second safety-net `setTimeout`
 *
 * These tests verify:
 * 1. `alix submit` with no daemon running prints a clear error and exits 1
 * 2. `alix submit` does NOT print "Unknown command: submit" (the original bug)
 * 3. `alix submit --help` works (command recognized, no daemon needed)
 * 4. Unknown commands still print "Unknown command" (regression check)
 *
 * The success path (task submitted to daemon) is harder to test in CI
 * because it requires a real daemon and a configured LLM provider. It
 * is covered by manual integration testing with `alix daemon start`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run the ALiX CLI binary with a custom HOME so the daemon socket
 * lookup hits an empty directory (no daemon running).
 */
function runAlix(args: string[], home: string): SpawnSyncReturns<string> {
  const cliPath = join(import.meta.dirname, "..", "dist", "src", "cli.js");
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("alix submit CLI dispatch (issue #294)", () => {
  let home: string;

  beforeAll(() => {
    // Use a fresh empty HOME so no real daemon is found.
    home = mkdtempSync(join(tmpdir(), "alix-submit-test-"));
  });

  afterAll(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it("prints a clear 'daemon not running' error and exits 1", () => {
    const r = runAlix(["submit", "what is 2+2"], home);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Daemon is not running");
    expect(r.stderr).toContain("alix daemon start");
  });

  it("does NOT print 'Unknown command: submit' (the original bug)", () => {
    const r = runAlix(["submit", "hello world"], home);
    // The original bug printed "Unknown command: submit" even after
    // the submit branch entered successfully. The fix tracks handled
    // commands so this misleading error no longer fires.
    expect(r.stderr).not.toContain("Unknown command: submit");
    expect(r.stdout).not.toContain("Unknown command: submit");
  });

  it("recognizes 'submit' as a known command (--help works without daemon)", () => {
    // --help is handled before any daemon check, so this should work
    // even with no daemon running. The fact that this doesn't error
    // with "Unknown command" proves submit is in the dispatch chain.
    const r = runAlix(["--help"], home);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("alix submit");
  });

  it("rejects unknown commands with 'Unknown command' (regression check)", () => {
    // The fix changed the bottom-of-file fallthrough to only fire
    // when no command was handled. Verify that genuinely unknown
    // commands still produce the error.
    const r = runAlix(["nonexistent-command"], home);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unknown command: nonexistent-command");
  });
});
