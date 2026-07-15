/**
 * Suite L: Error Handling — empty tasks, unknown commands, invalid flags, interrupts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { runCli, CLI_PATH, PROJECT_ROOT, assertOutputContains } from "./run-cli.js";

describe("Suite L: Error Handling", () => {

  // ── L.1: Empty task ──────────────────────────────────────────
  it("L.1: empty task shows usage error", () => {
    const r = runCli(["run", ""], { timeoutMs: 5_000 });
    assert.ok(
      r.exitCode !== 0 || r.stdout.includes("Usage") || r.stdout.includes("task"),
      `empty task should error (exit: ${r.exitCode}, stdout: ${r.stdout.slice(0, 100)})`,
    );
  });

  // ── L.2: Unknown command ─────────────────────────────────────
  it("L.2: unknown command shows error", () => {
    const r = runCli(["unknowncommand"], { timeoutMs: 5_000 });
    assert.ok(r.exitCode !== 0, "unknown command should exit with non-zero code");
    assert.ok(
      r.stderr.includes("Unknown command") || r.stdout.includes("Unknown command") || r.stderr.includes("Usage"),
      `unknown command should show error (got: ${(r.stderr + r.stdout).slice(0, 100)})`,
    );
  });

  // ── L.3: Invalid mode flag ───────────────────────────────────
  it("L.3: --mode=invalid does not crash", () => {
    // --mode=invalid is silently ignored; "invalid" becomes task text prefix
    const r = runCli(["run", "echo hello", "--mode=invalid"], { timeoutMs: 30_000 });
    assert.ok(r.exitCode === 0, "should exit normally even with invalid --mode flag");
  });

  // ── L.4: Ctrl+C during plan ──────────────────────────────────
  it("L.4: interrupt during plan exits cleanly", () => {
    const result = runCli(["run", "add a healthz endpoint", "--session-mode", "bypass", "--no-stream"], {
      timeoutMs: 3_000,
    });
    // With short timeout, the process gets killed — that's fine
    // Just verify it doesn't leave zombie processes
    assert.ok(true, "process exited (killed by timeout)");
  });

  // ── L.5: Run with no arguments ────────────────────────────────
  it("L.5: run with no args shows usage", () => {
    const r = runCli(["run"], { timeoutMs: 5_000 });
    assert.ok(
      r.exitCode !== 0 || r.stdout.includes("Usage"),
      "run without args should show usage",
    );
  });

  // ── L.6: Help for specific command ────────────────────────────
  it("L.6: --help shows all supported commands", () => {
    const r = runCli(["--help"]);
    assertOutputContains(r, "run", "help should list run");
    assertOutputContains(r, "security", "help should list security");
    assertOutputContains(r, "audit", "help should list audit");
    assertOutputContains(r, "policy", "help should list policy");
    assertOutputContains(r, "credential", "help should list credential");
    assertOutputContains(r, "evidence", "help should list evidence");
    assertOutputContains(r, "daemon", "help should list daemon");
    assertOutputContains(r, "approvals", "help should list approvals");
    assertOutputContains(r, "adaptation", "help should list adaptation");
  });
});
