import { describe, it, expect } from "vitest";
import type { GoalPlan, OutcomeNode, CapabilityRequirement } from "../../src/workflow/goal-types.js";

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
