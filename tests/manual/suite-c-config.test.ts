/**
 * Suite C: Configuration — alix config show, set-key, set-default-model, set-tier.
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

  // ── C.3: Set default model launches interactive menu ───────────
  it("C.3: config set-default-model shows provider selection", () => {
    const r = runCli(["config", "set-default-model"], { timeoutMs: 10_000 });
    assertOutputContains(r, "Select a provider");
  });

  // ── C.4: Set tier launches interactive menu ────────────────────
  it("C.4: config set-tier shows tier selection", () => {
    const r = runCli(["config", "set-tier"], { timeoutMs: 5_000 });
    assertOutputContains(r, "thinking");
  });
});
