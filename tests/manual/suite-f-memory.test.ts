/**
 * Suite F: Memory — alix memory add/list/query.
 *
 * Split from the original suite-e-f-chat-memory.test.ts (which combined
 * unrelated Chat and Memory suites). The Chat suite (Suite E) tested
 * `alix chat` which was removed in commit 3a56aca0; restoring it would
 * just reintroduce broken tests. Memory tests (Suite F) are independent
 * of the chat command and are preserved here.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, assertSuccess } from "./run-cli.js";

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
