/**
 * Suite B: Plan Mode — plan generation, auto-approve for research, disk persistence.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  runCli, PROJECT_ROOT, assertSuccess, assertOutputContains, assertOutputNotContains, needsModel,
} from "./run-cli.js";

const BASE = ["run", "--session-mode", "bypass", "--no-stream"];

describe("Suite B: Plan Mode", () => {

  // ── B.1: Research task auto-approves ──────────────────────────
  it("B.1: research task does not show plan approval prompt", () => {
    const r = runCli([...BASE, "research the best logging pattern for Node.js"], { timeoutMs: 60_000 });
    assertSuccess(r);
    // Research tasks skip plan generation entirely
    assertOutputNotContains(r, "Approve plan");
  });

  // ── B.2: Plan saved to disk (requires TTY — plan phase is active) ──
  it("B.2: development task saves plan to .alix/plans/ (TTY only)", { skip: "requires interactive TTY for plan phase" }, () => {
    // Run without --no-stream to get plan output
    const r = runCli(["run", "--session-mode", "bypass", "add a healthz endpoint"], { timeoutMs: 60_000 });
    assertSuccess(r);

    const sessionMatch = r.stdout.match(/Session: ([a-f0-9-]+)/);
    if (sessionMatch) {
      const sessionId = sessionMatch[1];
      const planPath = `${PROJECT_ROOT}/.alix/plans/${sessionId}.md`;
      assert.equal(existsSync(planPath), true, `plan file should exist at ${planPath}`);
      const planContent = readFileSync(planPath, "utf8");
      assert.ok(planContent.includes("## Summary"), "plan should have Summary section");
      assert.ok(planContent.includes("## Changes"), "plan should have Changes section");
    }
  });

  // ── B.3: Plan mode with --no-plan skips everything ────────────
  it("B.3: --no-plan skips plan generation entirely", () => {
    const r = runCli([...BASE, "--no-plan", "echo hello"]);
    assertSuccess(r);
    assertOutputNotContains(r, "## Summary");
  });

  // ── B.4: Development task with direct execution ───────────────
  it("B.4: development task produces session output", () => {
    const r = runCli([...BASE, "fix the null pointer in user.ts"], { timeoutMs: 180_000 });
    assertSuccess(r);
    assert.ok(r.stdout.includes("Session:"), "should produce a session ID");
  });
});
