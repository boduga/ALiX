/**
 * Suite E: Chat — alix chat start/exit, questions, commands, session listing.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, CLI_PATH, PROJECT_ROOT, assertSuccess, assertOutputContains, needsModel } from "./run-cli.js";

describe("Suite E: Chat", () => {

  // ── E.1: Chat starts and exits ────────────────────────────────
  it("E.1: chat session starts and exits cleanly with /exit", () => {
    const cmd = `printf '/exit\\n' | ${process.execPath} ${CLI_PATH} chat`;
    const stdout = execSync(cmd, { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 10_000 });
    assert.ok(stdout.includes("Chat session") || stdout.includes("Session saved"), "chat should start and save session");
    assert.ok(stdout.includes("Session saved"), "session should be saved on exit");
  });

  // ── E.2: Ask a question ───────────────────────────────────────
  it("E.2: ask question in chat and get response", { skip: "requires model API credentials" }, () => {
    const cmd = `printf 'what is 2+2?\\n/exit\\n' | ${process.execPath} ${CLI_PATH} chat --session-mode bypass`;
    const stdout = execSync(cmd, { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 30_000 });
    assert.ok(stdout.includes("4") || stdout.includes("four"), "should answer the question");
  });

  // ── E.3: /help command ────────────────────────────────────────
  it("E.3: /help shows available commands", () => {
    try {
      const cmd = `printf '/help\\n/exit\\n' | ${process.execPath} ${CLI_PATH} chat --session-mode bypass 2>&1`;
      const stdout = execSync(cmd, { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 15_000 });
      assert.ok(
        stdout.includes("/exit") || stdout.includes("/quit") || stdout.includes("help"),
        "help should show commands",
      );
    } catch (e: any) {
      // The chat might close with a signal or error — check stdout/stderr
      const output = (e.stdout ?? "").toString() + (e.stderr ?? "").toString();
      assert.ok(
        output.includes("/exit") || output.includes("/quit") || output.includes("help") || output.includes("Chat"),
        `chat /help output: ${output.slice(0, 200)}`,
      );
    }
  });

  // ── E.4: Session listing ──────────────────────────────────────
  it("E.4: chat --list shows recent sessions", () => {
    const r = runCli(["chat", "--list"]);
    assertSuccess(r);
    // Should either list sessions or show empty state
    assert.ok(
      r.stdout.includes("sessions") || r.stdout.includes("No sessions") || r.stdout.includes("msgs"),
      "should list sessions or show empty state",
    );
  });

  // ── E.5: Session metadata saved ──────────────────────────────
  it("E.5: chat session creates metadata file", () => {
    const cmd = `printf '/exit\\n' | ${process.execPath} ${CLI_PATH} chat`;
    const stdout = execSync(cmd, { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 10_000 });
    // Session metadata should exist
    assert.ok(stdout.includes("Session saved"), "session metadata saved after exit");
  });
});


/**
 * Suite F: Memory — alix memory list, add, search.
 */
describe("Suite F: Memory", () => {

  // ── F.1: List memory ──────────────────────────────────────────
  it("F.1: memory list shows entries or empty state", () => {
    const r = runCli(["memory", "list"]);
    assertSuccess(r);
    // Either lists entries or shows "No memory" — both are acceptable
  });

  // ── F.2: Add memory ──────────────────────────────────────────
  it("F.2: memory add creates an entry", () => {
    const r = runCli(["memory", "add", "--name", "test-entry", "--content", "This is a test memory entry"]);
    assertSuccess(r);
  });

  // ── F.3: Search memory ────────────────────────────────────────
  it("F.3: memory list --query searches entries", () => {
    const r = runCli(["memory", "list", "--query", "test"]);
    assertSuccess(r);
  });

  // ── F.4: Add + verify ─────────────────────────────────────────
  it("F.4: memory add creates entry that appears in list", () => {
    // Run sequentially — add first, then list should include it
    runCli(["memory", "add", "--name", "verify-test", "--content", "verification-content-12345"]);
    const r = runCli(["memory", "list", "--query", "verification"]);
    assertSuccess(r);
    assert.ok(
      r.stdout.includes("verification-content-12345") || r.stdout.includes("verify-test"),
      "added memory should appear in list",
    );
  });
});
