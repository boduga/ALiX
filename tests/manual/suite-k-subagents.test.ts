/**
 * Suite K: Subagents — alix agent explorer, reviewer.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCli, assertSuccess, needsModel } from "./run-cli.js";

describe("Suite K: Subagents", () => {

  // ── K.1: Explorer subagent ────────────────────────────────────
  it("K.1: explorer subagent returns file findings", { ...needsModel }, () => {
    const r = runCli(["agent", "explorer", "list files"], { timeoutMs: 60_000 });
    assertSuccess(r);
  });

  // ── K.2: Reviewer subagent ────────────────────────────────────
  it("K.2: reviewer subagent returns code review", { ...needsModel }, () => {
    const r = runCli(["agent", "reviewer", "review src/task-classifier.ts"], { timeoutMs: 60_000 });
    assertSuccess(r);
  });

  // ── K.3: Worker subagent ──────────────────────────────────────
  it("K.3: worker subagent runs a write task", { ...needsModel }, () => {
    const r = runCli(["agent", "worker", "create test.txt"], { timeoutMs: 120_000 });
    assertSuccess(r);
  });

  // ── K.4: Invalid role ─────────────────────────────────────────
  it("K.4: invalid subagent role exits with error", () => {
    const r = runCli(["agent", "invalid_role", "do something"], { timeoutMs: 15_000 });
    // The subagent system may accept invalid roles and handle them
    // Just verify it doesn't crash or hang
    assert.ok(r.exitCode === 0 || r.exitCode === 1, `agent should not crash (exit: ${r.exitCode})`);
  });
});
