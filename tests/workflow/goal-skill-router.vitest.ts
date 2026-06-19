import { describe, it, expect } from "vitest";
import { GoalSkillRouter } from "../../src/workflow/goal-skill-router.js";
import type { GoalPlan } from "../../src/workflow/goal-types.js";

describe("GoalSkillRouter", () => {
  it("matches existing skills to goal capabilities", async () => {
    const router = new GoalSkillRouter();
    const plan: GoalPlan = {
      goal: "Add a new feature",
      outcomeNodes: [],
      requiredCapabilities: ["workflow.intake", "workflow.planning", "workflow.review"],
      riskFlags: [],
      requiresApproval: true,
    };
    const result = await router.route(plan);
    expect(result.matchedSkill).toBe("plan-only");
    expect(result.confidence).toBe(1.0);
  });

  it("returns low confidence for unfamiliar capabilities", async () => {
    const router = new GoalSkillRouter();
    const plan: GoalPlan = {
      goal: "Custom ML pipeline",
      outcomeNodes: [],
      requiredCapabilities: ["ml.training", "ml.deploy", "data.pipeline"],
      riskFlags: [],
      requiresApproval: true,
    };
    const result = await router.route(plan);
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.alternatives.length).toBeGreaterThanOrEqual(0);
  });
});
