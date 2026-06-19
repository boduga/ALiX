import { describe, it, expect } from "vitest";
import { GoalDecomposer } from "../../src/workflow/goal-decomposer.js";
import type { GoalPlan } from "../../src/workflow/goal-types.js";

describe("GoalPlan types", () => {
  it("constructs a valid GoalPlan", () => {
    const plan: GoalPlan = {
      goal: "Add workflow status dashboard",
      outcomeNodes: [
        {
          id: "node-1",
          description: "Create status page component",
          requiredCapabilities: ["ui.react", "ui.routing"],
          estimatedEffort: "medium",
        },
      ],
      requiredCapabilities: ["ui.react", "ui.routing", "api.read"],
      suggestedSkill: "feature-development",
      riskFlags: [],
      requiresApproval: true,
    };
    expect(plan.goal).toBeTruthy();
    expect(plan.outcomeNodes.length).toBe(1);
    expect(plan.requiredCapabilities).toContain("ui.react");
    expect(plan.requiresApproval).toBe(true);
  });
});

describe("GoalDecomposer", () => {
  it("decomposes a simple feature goal", () => {
    const decomposer = new GoalDecomposer();
    const plan = decomposer.decompose("Add a workflow status dashboard showing active workflows and their current state");
    expect(plan.goal).toBeTruthy();
    expect(plan.outcomeNodes.length).toBeGreaterThan(0);
    expect(plan.requiredCapabilities.length).toBeGreaterThan(0);
    expect(plan.requiresApproval).toBe(true);
  });

  it("decomposes a bug-fix goal", () => {
    const decomposer = new GoalDecomposer();
    const plan = decomposer.decompose("Fix the evidence query endpoint returning 500 errors on empty store");
    expect(plan.outcomeNodes.length).toBeGreaterThan(0);
    expect(plan.riskFlags.some(f => f.toLowerCase().includes("bug") || f.toLowerCase().includes("fix"))).toBe(true);
  });

  it("sets risk flags for infrastructure goals", () => {
    const decomposer = new GoalDecomposer();
    const plan = decomposer.decompose("Migrate the database from SQLite to PostgreSQL");
    expect(plan.riskFlags.length).toBeGreaterThan(0);
  });
});
