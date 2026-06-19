import { describe, it, expect } from "vitest";
import { GoalDecomposer } from "../../src/workflow/goal-decomposer.js";

describe("GoalDecomposer", () => {
  it("decomposes a simple feature goal", async () => {
    const decomposer = new GoalDecomposer();
    const plan = await decomposer.decompose("Add a workflow status dashboard showing active workflows and their current state");
    expect(plan.goal).toBeTruthy();
    expect(plan.outcomeNodes.length).toBeGreaterThan(0);
    expect(plan.requiredCapabilities.length).toBeGreaterThan(0);
    expect(plan.requiresApproval).toBe(true);
  });

  it("decomposes a bug-fix goal", async () => {
    const decomposer = new GoalDecomposer();
    const plan = await decomposer.decompose("Fix the evidence query endpoint returning 500 errors on empty store");
    expect(plan.outcomeNodes.length).toBeGreaterThan(0);
    expect(plan.riskFlags.some(f => f.toLowerCase().includes("bug") || f.toLowerCase().includes("fix"))).toBe(true);
  });

  it("sets risk flags for infrastructure goals", async () => {
    const decomposer = new GoalDecomposer();
    const plan = await decomposer.decompose("Migrate the database from SQLite to PostgreSQL");
    expect(plan.riskFlags.length).toBeGreaterThan(0);
  });
});
