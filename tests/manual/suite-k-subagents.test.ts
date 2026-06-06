/**
 * Suite K: Subagents — alix agent explorer, reviewer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, assertSuccess, assertOutputContains, needsModel } from "./run-cli.js";

describe("Suite K: Subagents", () => {

  // ── K.1: Explorer subagent ────────────────────────────────────
  it("K.1: explorer subagent returns file findings", { skip: "requires model API credentials" }, () => {
    const r = runCli(["agent", "explorer", "list the files in src"], { timeoutMs: 60_000 });
    assertSuccess(r);
    assertOutputContains(r, "src", "should explore src directory");
  });

  // ── K.2: Reviewer subagent ────────────────────────────────────
  it("K.2: reviewer subagent returns code review", { skip: "requires model API credentials" }, () => {
    const r = runCli(["agent", "reviewer", "review src/task-classifier.ts"], { timeoutMs: 60_000 });
    assertSuccess(r);
  });

  // ── K.3: Worker subagent ──────────────────────────────────────
  it("K.3: worker subagent runs a write task", { skip: "requires model API credentials" }, () => {
    const r = runCli(["agent", "worker", "create a file called test.txt"], { timeoutMs: 60_000 });
    assertSuccess(r);
  });

  // ── K.4: Invalid role ─────────────────────────────────────────
  it("K.4: invalid subagent role exits with error or help", () => {
    const r = runCli(["agent", "invalid_role", "do something"], { timeoutMs: 10_000 });
    // Should either error or show valid roles
    assert.ok(
      r.exitCode !== 0 || r.stdout.includes("explorer") || r.stdout.includes("invalid"),
      "invalid role should show error or valid options",
    );
  });
});
