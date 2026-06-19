/**
 * P4.6b/c + P4.7b — Workflow skill tests including capability routing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadSkill, listSkills } from "../../src/workflow/skill.js";
import type { SkillDefinition } from "../../src/workflow/skill.js";
import { runWorkflowSkill } from "../../src/workflow/workflow-skill.js";
import { WorkflowCoordinator } from "../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { loadCardRegistry } from "../../src/registry/card-loader.js";

function tmpDir(): string {
  const dir = join("/tmp", "skill-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

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
      expect(step.agent || step.capability).toBeTruthy();
      expect(step.action).toBeTruthy();
    }
  });
});

describe("runWorkflowSkill", () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("runs a plan-only skill through intake → plan → review", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

    const skill = await loadSkill("plan-only");
    expect(skill).not.toBeNull();

    const result = await runWorkflowSkill(skill!, {
      issueNumber: 61,
      issueTitle: "Test skill binding",
      body: "## Acceptance Criteria\n- [ ] Task A\n- [ ] Task B",
      labels: [{ name: "ready-for-agent" }],
    }, { coordinator: coord, writer });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.workPackage).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.review).toBeDefined();
  });

  it("returns error when intake rejects the goal", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

    const skill = await loadSkill("plan-only");
    const result = await runWorkflowSkill(skill!, {
      issueNumber: 61,
      issueTitle: "No ready label",
      body: "",
      labels: [{ name: "type:bug" }],
    }, { coordinator: coord, writer });

    expect(result.success).toBe(false);
  });
});

describe("capability routing in skills", () => {
  let dir: string;

  beforeEach(() => { dir = tmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("resolves capability to agent and routes step", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));
    const registry = await loadCardRegistry(dir);

    const skill: SkillDefinition = {
      id: "test-capability",
      name: "Test",
      description: "Capability resolution test",
      steps: [
        { step: "intake", capability: "workflow.intake", resolve: true, action: "Intake" },
      ],
    };

    const result = await runWorkflowSkill(skill, {
      issueNumber: 61,
      issueTitle: "Cap routing test",
      body: "- [ ] AC",
      labels: [{ name: "ready-for-agent" }],
    }, { coordinator: coord, writer, registry });

    expect(result.success).toBe(true);
  });

  it("prefers capability-based routing over hardcoded agent", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));
    const registry = await loadCardRegistry(dir);

    const skill: SkillDefinition = {
      id: "test-prefer-capability",
      name: "Test",
      description: "Prefer capability test",
      steps: [
        { step: "intake", agent: "some.other.agent", capability: "workflow.intake", resolve: true, action: "Intake" },
      ],
    };

    const result = await runWorkflowSkill(skill, {
      issueNumber: 61,
      issueTitle: "Prefer cap test",
      body: "- [ ] AC",
      labels: [{ name: "ready-for-agent" }],
    }, { coordinator: coord, writer, registry });

    expect(result.success).toBe(true);
  });

  it("reports missing capability as error", async () => {
    const coord = new WorkflowCoordinator({ workflowDir: join(dir, "wf") });
    const store = new EvidenceStore({ storeDir: join(dir, "ev") });
    const writer = new EvidenceEventWriter((t, p) => store.append(t, p));
    const registry = await loadCardRegistry(dir);

    const skill: SkillDefinition = {
      id: "test-missing-cap",
      name: "Test",
      description: "Missing capability",
      steps: [
        { step: "nope", capability: "capability.does.not.exist", resolve: true, action: "Nope" },
      ],
    };

    const result = await runWorkflowSkill(skill, {
      issueNumber: 61,
      issueTitle: "Missing",
      body: "",
      labels: [{ name: "ready-for-agent" }],
    }, { coordinator: coord, writer, registry });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("capability.does.not.exist");
  });
});
