/**
 * Suite C: Configuration — alix config show, set-key, models set-default/set-tier.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  runCli, PROJECT_ROOT, tempDir, assertSuccess, assertOutputContains,
} from "./run-cli.js";

describe("Suite C: Configuration", () => {

  // ── C.1: Show config ─────────────────────────────────────────
  it("C.1: config show prints current configuration", () => {
    const r = runCli(["config", "show"]);
    assertSuccess(r);
    assertOutputContains(r, "provider");
    assertOutputContains(r, "permissions");
  });

  // ── C.2: Set key launches interactive menu ────────────────────
  it("C.2: config set-key shows provider selection", () => {
    const r = runCli(["config", "set-key"], { timeoutMs: 10_000 });
    // Without stdin, it should show the menu then exit/error
    // Check for provider names in the output
    const output = r.stdout + r.stderr;
    assert.ok(
      output.includes("Select a provider") ||
      output.includes("deepseek") ||
      output.includes("google") ||
      output.includes("openai"),
      "should show provider selection or provider list",
    );
  });

  // ── C.3: Legacy set-default-model is now unknown ──────────────
  it("C.3: config set-default-model is an unknown command", () => {
    const r = runCli(["config", "set-default-model"], { timeoutMs: 10_000 });
    assert.notEqual(r.exitCode, 0, "legacy command must be rejected");
    assertOutputContains(r, "Unknown command", "stderr should report unknown command");
  });

  // ── C.4: Legacy set-tier is now unknown ───────────────────────
  it("C.4: config set-tier is an unknown command", () => {
    const r = runCli(["config", "set-tier"], { timeoutMs: 5_000 });
    assert.notEqual(r.exitCode, 0, "legacy command must be rejected");
    assertOutputContains(r, "Unknown command", "stderr should report unknown command");
  });

  // ── C.5: models set-default is recognized (interactive menu) ──
  it("C.5: models set-default is a recognized command", () => {
    const r = runCli(["models", "set-default"], { timeoutMs: 10_000 });
    // On EOF stdin the command prints its provider menu then cancels — it must
    // NOT fall through to "Unknown command".
    assert.ok(
      !`${r.stdout}\n${r.stderr}`.includes("Unknown command"),
      "should be a recognized command (no 'Unknown command')",
    );
  });

  // ── C.6: models set-tier is recognized (interactive menu) ─────
  it("C.6: models set-tier is a recognized command", () => {
    const r = runCli(["models", "set-tier"], { timeoutMs: 5_000 });
    assert.ok(
      !`${r.stdout}\n${r.stderr}`.includes("Unknown command"),
      "should be a recognized command (no 'Unknown command')",
    );
  });
});
