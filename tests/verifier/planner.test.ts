import { describe, it } from "node:test";
import assert from "node:assert";
import { buildVerificationPlan, addSkippedCheck, type VerificationCheck } from "../../src/verifier/planner.js";

describe("VerificationPlanner", () => {
  it("builds plan with single check", () => {
    const checks: VerificationCheck[] = [
      { id: "1", command: "npm test", reason: "test file changed", cost: "expensive", required: true },
    ];
    const plan = buildVerificationPlan(checks);
    assert.equal(plan.checks.length, 1);
    assert.equal(plan.checks[0].command, "npm test");
    assert.ok(plan.id.startsWith("plan_"));
  });

  it("orders checks by cost (cheap first)", () => {
    const checks: VerificationCheck[] = [
      { id: "1", command: "npm test", reason: "", cost: "expensive", required: false },
      { id: "2", command: "npm run typecheck", reason: "", cost: "cheap", required: true },
      { id: "3", command: "npm run build", reason: "", cost: "medium", required: false },
    ];
    const plan = buildVerificationPlan(checks);
    assert.equal(plan.checks[0].cost, "cheap");
    assert.equal(plan.checks[1].cost, "medium");
    assert.equal(plan.checks[2].cost, "expensive");
  });

  it("marks required checks first within cost tier", () => {
    const checks: VerificationCheck[] = [
      { id: "1", command: "npm run typecheck", reason: "", cost: "cheap", required: false },
      { id: "2", command: "npm run typecheck:strict", reason: "", cost: "cheap", required: true },
    ];
    const plan = buildVerificationPlan(checks);
    assert.ok(plan.checks[0].required);
  });

  it("adds skipped checks", () => {
    const checks: VerificationCheck[] = [
      { id: "1", command: "npm test", reason: "", cost: "expensive", required: false },
    ];
    const plan = buildVerificationPlan(checks);
    const updated = addSkippedCheck(plan, "npm test", "skipped by policy");
    assert.equal(updated.skipped.length, 1);
    assert.equal(updated.skipped[0].reason, "skipped by policy");
  });
});