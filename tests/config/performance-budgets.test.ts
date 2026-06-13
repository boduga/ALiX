import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkBudget, checkAllBudgets, PERFORMANCE_BUDGETS } from "../../src/config/performance-budgets.js";

describe("PERFORMANCE_BUDGETS", () => {
  it("has the expected set of budgets", () => {
    const names = PERFORMANCE_BUDGETS.map(b => b.name).sort();
    assert.ok(names.includes("cli-startup"));
    assert.ok(names.includes("models-doctor"));
    assert.ok(names.includes("context-compile"));
  });

  it("all failureMs >= warningMs", () => {
    for (const b of PERFORMANCE_BUDGETS) assert.ok(b.failureMs >= b.warningMs, `${b.name}: failureMs >= warningMs`);
  });
});

describe("checkBudget", () => {
  const budget = PERFORMANCE_BUDGETS.find(b => b.name === "cli-startup")!;

  it("pass when under warning threshold", () => {
    assert.equal(checkBudget(200, budget).status, "pass");
  });

  it("warning when between warning and failure", () => {
    assert.equal(checkBudget(500, budget).status, "warning");
  });

  it("fail when over failure threshold", () => {
    assert.equal(checkBudget(900, budget).status, "fail");
  });
});

describe("checkAllBudgets", () => {
  it("unbudgeted for unknown names", () => {
    const results = checkAllBudgets([{ name: "mystery-bench", meanMs: 999 }]);
    assert.equal(results[0].status, "unbudgeted");
  });

  it("returns results for matching names", () => {
    const r = checkAllBudgets([{ name: "cli-startup", meanMs: 200 }]);
    assert.equal(r.length, 1);
    assert.equal(r[0].status, "pass");
  });
});
