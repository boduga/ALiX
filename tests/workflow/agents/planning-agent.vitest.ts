/**
 * P4.5b — PlanningAgent tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PlanningAgent } from "../../../src/workflow/agents/planning-agent.js";
import { WorkflowCoordinator } from "../../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { WorkPackage } from "../../../src/workflow/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validWorkPackage(overrides?: Partial<WorkPackage>): WorkPackage {
  return {
    issueNumber: 62,
    issueTitle: "P4.5a — IssueIntakeAgent: read issues, estimate, package",
    labels: ["type:feature", "phase:p4.5", "ready-for-agent"],
    priority: "medium",
    complexity: "medium",
    estimatedFiles: [
      "src/workflow/agents/issue-intake-agent.ts",
      "tests/workflow/agents/issue-intake-agent.vitest.ts",
      "src/workflow/types.ts",
    ],
    dependencies: [61],
    acceptanceCriteria: [
      "Reads issue from GitHub",
      "Validates the ready-for-agent label",
      "Estimates complexity from body content",
      "Detects dependency references in body",
    ],
    riskFlags: [],
    ...overrides,
  };
}

function tmpDir(): string {
  const dir = join("/tmp", "plan-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlanningAgent", () => {
  let agent: PlanningAgent;

  beforeEach(() => {
    agent = new PlanningAgent();
  });

  describe("plan — valid work packages", () => {
    it("produces an ExecutionPlan from a WorkPackage", async () => {
      const result = await agent.plan(validWorkPackage());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan.workPackage.issueNumber).toBe(62);
      expect(result.plan.subtasks.length).toBeGreaterThan(0);
    });

    it("creates a setup subtask when files exist", async () => {
      const wp = validWorkPackage();
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // Setup subtask (step-0) + 4 AC subtasks = 5
      expect(result.plan.subtasks.length).toBe(5);
      expect(result.plan.subtasks[0].id).toBe("step-0");
      expect(result.plan.subtasks[0].description).toContain("Set up");
    });

    it("creates one subtask per acceptance criterion", async () => {
      const wp = validWorkPackage();
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const acSubtasks = result.plan.subtasks.slice(1); // skip setup
      expect(acSubtasks.length).toBe(wp.acceptanceCriteria.length);
      expect(acSubtasks[0].description).toBe("Reads issue from GitHub");
      expect(acSubtasks[3].description).toBe("Detects dependency references in body");
    });

    it("assigns sequential dependency chain", async () => {
      const result = await agent.plan(validWorkPackage());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan.subtasks[0].dependsOn).toEqual([]);
      for (let i = 1; i < result.plan.subtasks.length; i++) {
        expect(result.plan.subtasks[i].dependsOn).toEqual([
          result.plan.subtasks[i - 1].id,
        ]);
      }
    });

    it("distributes files round-robin across subtasks", async () => {
      const wp = validWorkPackage({
        estimatedFiles: [
          "src/a.ts",
          "src/b.ts",
          "src/c.ts",
          "src/d.ts",
        ],
        acceptanceCriteria: [
          "AC one",
          "AC two",
        ],
      });
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // Setup gets src/a.ts, AC one gets even indices (0=a.ts, 2=c.ts),
      // AC two gets odd indices (1=b.ts, 3=d.ts)
      expect(result.plan.subtasks.length).toBe(3); // setup + 2 ACs
      expect(result.plan.subtasks[0].files).toContain("src/a.ts");

      // AC subtasks filter over full file list (not excluding setup)
      const ac1 = result.plan.subtasks[1]; // AC one — even indices (0, 2)
      const ac2 = result.plan.subtasks[2]; // AC two — odd indices (1, 3)
      expect(ac1.files).toContain("src/a.ts");
      expect(ac1.files).toContain("src/c.ts");
      expect(ac2.files).toContain("src/b.ts");
      expect(ac2.files).toContain("src/d.ts");
    });

    it("derives test files from source files", async () => {
      const wp = validWorkPackage({
        estimatedFiles: [
          "src/workflow/types.ts",
        ],
        acceptanceCriteria: ["Add WorkPackage interface"],
      });
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // Setup gets the file, AC subtask gets the test file derived from it
      const acSubtask = result.plan.subtasks[1];
      expect(acSubtask.testFiles).toContain("tests/workflow/types.test.ts");
    });

    it("skips test derivation for existing test files", async () => {
      const wp = validWorkPackage({
        estimatedFiles: [
          "tests/workflow/types.test.ts",
        ],
        acceptanceCriteria: ["AC"],
      });
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // Setup gets the file, AC subtask should not derive a test from a test file
      const acSubtask = result.plan.subtasks[1];
      expect(acSubtask.testFiles).toEqual([]);
    });

    it("generates a deterministic branch name", async () => {
      const result = await agent.plan(validWorkPackage());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan.branchName).toMatch(
        /^feature\/issue-62-/,
      );
      expect(result.plan.branchName.length).toBeLessThan(100);
    });

    it("sets approvalRequired to true", async () => {
      const result = await agent.plan(validWorkPackage());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan.approvalRequired).toBe(true);
    });

    it("estimates commits as subtasks + 1", async () => {
      const result = await agent.plan(validWorkPackage());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan.estimatedCommits).toBe(
        result.plan.subtasks.length + 1,
      );
    });

    it("handles work package with no estimated files", async () => {
      const wp = validWorkPackage({
        estimatedFiles: [],
        acceptanceCriteria: ["AC one"],
      });
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // No setup subtask since no files
      expect(result.plan.subtasks.length).toBe(1);
      expect(result.plan.subtasks[0].id).toBe("step-1");
    });

    it("acceptanceCheck contains AC text, file list, and test instruction", async () => {
      const wp = validWorkPackage({
        estimatedFiles: [
          "src/foo.ts",
        ],
        acceptanceCriteria: ["Implement foo"],
      });
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const acSubtask = result.plan.subtasks[1];
      expect(acSubtask.acceptanceCheck).toContain("Implement foo");
      expect(acSubtask.acceptanceCheck).toContain("src/foo.ts");
      expect(acSubtask.acceptanceCheck).toContain("Run tests");
    });

    it("branch name truncates to 50 chars for slug", async () => {
      const wp = validWorkPackage({
        issueTitle: "A very long issue title that should definitely be truncated to fit within the branch name limit of fifty characters or so",
      });
      const result = await agent.plan(wp);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const slug = result.plan.branchName.replace("feature/issue-62-", "");
      expect(slug.length).toBeLessThanOrEqual(50);
    });
  });

  describe("plan — rejection", () => {
    it("rejects null work package", async () => {
      const result = await agent.plan(null as unknown as WorkPackage);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("empty_work_package");
    });

    it("rejects work package without acceptance criteria", async () => {
      const wp = validWorkPackage({ acceptanceCriteria: [] });
      const result = await agent.plan(wp);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("no_acceptance_criteria");
    });

    it("rejects work package with no issueNumber", async () => {
      const wp = validWorkPackage({ issueNumber: 0 });
      const result = await agent.plan(wp);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("invalid_work_package");
    });

    it("rejects work package with empty title", async () => {
      const wp = validWorkPackage({ issueTitle: "" });
      const result = await agent.plan(wp);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("invalid_work_package");
    });
  });

  describe("plan — custom injectors", () => {
    it("uses custom branch name function", async () => {
      const custom = new PlanningAgent({
        branchNameFn: () => "custom-branch",
      });
      const result = await custom.plan(validWorkPackage());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.plan.branchName).toBe("custom-branch");
    });

    it("uses custom file existence check", async () => {
      const custom = new PlanningAgent({
        fileExistsFn: () => true,
      });
      // Just verify it doesn't crash — fileExistsFn isn't used in the main flow
      // but is available for future use
      const result = await custom.plan(validWorkPackage());
      expect(result.success).toBe(true);
    });
  });

  describe("execute — full flow", () => {
    let dir: string;
    let coordinator: WorkflowCoordinator;
    let writer: EvidenceEventWriter;
    let store: EvidenceStore;

    beforeEach(() => {
      dir = tmpDir();
      coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      writer = new EvidenceEventWriter(
        (type, payload) => store.append(type, payload),
      );
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("transitions SELECTED → PLANNED and records evidence", async () => {
      const wp = validWorkPackage();

      // Set up the issue in SELECTED state first
      await coordinator.transition(62, "NEW", { actor: "system" });
      await coordinator.transition(62, "SELECTED", { actor: "IssueIntakeAgent" });

      const result = await agent.execute(wp, coordinator, writer);
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Verify state transition
      const state = await coordinator.currentState(62);
      expect(state).not.toBeNull();
      expect(state!.state).toBe("PLANNED");

      // Verify evidence was recorded
      const evidence = await store.query({ type: "plan_generated" });
      expect(evidence.records.length).toBe(1);
      expect(result.evidenceFingerprint).toBeTruthy();

      // Verify plan is attached to result
      expect(result.plan.subtasks.length).toBeGreaterThan(0);
      expect(result.plan.branchName).toBeTruthy();
    });

    it("rejects invalid work package in execute flow", async () => {
      // Set up a valid state first
      await coordinator.transition(62, "NEW", { actor: "system" });
      await coordinator.transition(62, "SELECTED", { actor: "IssueIntakeAgent" });

      const invalidWp = validWorkPackage({ acceptanceCriteria: [] });
      const result = await agent.execute(invalidWp, coordinator, writer);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("no_acceptance_criteria");

      // State should still be SELECTED — no transition happened
      const state = await coordinator.currentState(62);
      expect(state?.state).toBe("SELECTED");
    });

    it("produces plan with all required fields", async () => {
      const wp = validWorkPackage();
      await coordinator.transition(62, "NEW", { actor: "system" });
      await coordinator.transition(62, "SELECTED", { actor: "IssueIntakeAgent" });

      const result = await agent.execute(wp, coordinator, writer);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const plan = result.plan;
      expect(plan.workPackage).toBe(wp);
      expect(plan.branchName).toBeTruthy();
      expect(plan.subtasks.every((s) => s.id.startsWith("step-"))).toBe(true);
      expect(plan.subtasks.every((s) => s.description.length > 0)).toBe(true);
      expect(plan.subtasks.every((s) => s.acceptanceCheck.length > 0)).toBe(true);
      expect(plan.approvalRequired).toBe(true);
      expect(plan.estimatedCommits).toBeGreaterThan(0);
    });
  });
});
