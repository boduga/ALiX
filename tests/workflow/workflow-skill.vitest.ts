/**
 * P4.6b — Workflow skill tests.
 */

import { describe, it, expect } from "vitest";
import { loadSkill, listSkills } from "../../src/workflow/skill.js";

describe("workflow skills", () => {
  it("loads the built-in issue-lifecycle skill", async () => {
    const skill = await loadSkill("issue-lifecycle");
    expect(skill).not.toBeNull();
    expect(skill!.name).toBe("Issue Lifecycle");
    expect(skill!.steps.length).toBeGreaterThan(0);
    expect(skill!.steps[0].agent).toBe("workflow.intake");
  });

  it("lists available workflow skills", async () => {
    const skills = await listSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some(s => s.name === "Issue Lifecycle")).toBe(true);
  });

  it("skill steps have required fields", async () => {
    const skill = await loadSkill("issue-lifecycle");
    for (const step of skill!.steps) {
      expect(step.step).toBeTruthy();
      expect(step.agent).toBeTruthy();
      expect(step.action).toBeTruthy();
    }
  });
});
