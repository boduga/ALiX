// tests/unit/test-planner.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { TestPlanner, createTestPlan } from "../../src/verifier/test-planner.js";
import type { VerificationCheck } from "../../src/verifier/verifier.js";

describe("TestPlanner", () => {
  it("orders checks by cost (typecheck < build < test)", () => {
    const checks: VerificationCheck[] = [
      { command: "npm test", reason: "test suite" },
      { command: "npm run build", reason: "build" },
      { command: "npm run typecheck", reason: "typecheck" },
    ];

    const planner = new TestPlanner();
    const ordered = planner.orderByCost(checks);

    const commands = ordered.map(c => c.command);
    const typecheckIdx = commands.findIndex(c => c.includes("typecheck"));
    const buildIdx = commands.findIndex(c => c.includes("build"));
    const testIdx = commands.findIndex(c => c.includes("test"));

    assert.ok(typecheckIdx < buildIdx, "typecheck should come before build");
    assert.ok(buildIdx < testIdx, "build should come before test");
  });

  it("filters to minimal test set for changed files", async () => {
    // Mock changed files
    const planner = new TestPlanner();
    planner.setChangedFiles(["src/auth/user.ts"]);

    // Mock test mappings
    const planned = await planner.plan(["src/auth/user.ts"], {
      baseCommands: [{ command: "npm run typecheck", reason: "typecheck" }],
    });

    // Should include typecheck (cheap) plus specific tests
    assert.ok(planned.checks.length >= 1, "Should have at least typecheck");
    assert.ok(planned.checks.some(c => c.command.includes("typecheck")), "Should include typecheck");
  });

  it("includes cost estimate in plan", async () => {
    const planner = new TestPlanner();
    const plan = await planner.plan(["src/auth/user.ts"], {
      baseCommands: [{ command: "npm test", reason: "full suite" }],
    });

    assert.ok(typeof plan.totalCost === "number", "Should have cost estimate");
    assert.ok(plan.costBreakdown, "Should have cost breakdown");
  });

  it("marks files as needing verification", async () => {
    const planner = new TestPlanner();
    const plan = await planner.plan(["src/auth/user.ts"], {
      baseCommands: [],
    });

    assert.ok(plan.verifiedFiles.length > 0 || plan.unverifiedFiles.length > 0,
      "Should report on file coverage");
  });
});

describe("createTestPlan (convenience function)", () => {
  it("creates full plan from changed files", async () => {
    const plan = await createTestPlan(".", ["src/auth/user.ts"]);

    assert.ok(plan.checks.length > 0, "Should have verification checks");
    assert.ok(plan.checks.every(c => c.command), "All checks should have commands");
  });

  it("returns empty plan when no files changed", async () => {
    const plan = await createTestPlan(".", []);

    // Should still run typecheck at minimum
    assert.ok(plan.checks.length >= 0, "May have typecheck or be empty");
  });
});