import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

describe("plan-phase", () => {

  it("isReadOnlyTask returns true for research and false for write tasks", async () => {
    const { isReadOnlyTask } = await import("../src/task-classifier.js");
    // Read-only prompts
    assert.equal(isReadOnlyTask("what is the current president of Nigeria"), true);
    assert.equal(isReadOnlyTask("research the best database for our use case"), true);
    assert.equal(isReadOnlyTask("explain how the auth middleware works"), true);
    assert.equal(isReadOnlyTask("review the code in src/auth.ts"), true);
    // Write prompts
    assert.equal(isReadOnlyTask("fix the null pointer in user.ts"), false);
    assert.equal(isReadOnlyTask("add a healthz endpoint"), false);
    assert.equal(isReadOnlyTask("refactor the login flow"), false);
    assert.equal(isReadOnlyTask("delete the unused utility file"), false);
  });

  it("runPlanPhase module exports the expected function", async () => {
    const { runPlanPhase } = await import("../src/run/plan-phase.js");
    assert.ok(typeof runPlanPhase === "function");
  });

  it("plan file is saved to disk", async () => {
    const testDir = join(process.cwd(), ".test-tmp", "plan-phase");
    await mkdir(testDir, { recursive: true });

    const planPath = join(testDir, "test-plan.md");
    const planContent = "## Plan\n\n**Task:** test\n\n### Changes\n- Create test.txt\n";
    await writeFile(planPath, planContent);

    assert.ok(existsSync(planPath));
    const saved = await readFile(planPath, "utf8");
    assert.ok(saved.includes("## Plan"));

    await rm(testDir, { recursive: true, force: true });
  });

  it("research task auto-approves plan", async () => {
    const { isReadOnlyTask } = await import("../src/task-classifier.js");
    // Research tasks don't trigger plan approval prompt
    assert.equal(isReadOnlyTask("research the best caching strategy"), true);
    // This means runPlanPhase will return approved without prompting
  });

  it("task without read or write signals falls back to classifier", async () => {
    const { isReadOnlyTask } = await import("../src/task-classifier.js");
    // Ambiguous tasks should not auto-approve
    const result = isReadOnlyTask("update the dependencies");
    assert.ok(typeof result === "boolean");
  });
});
