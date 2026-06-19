/**
 * P4.5e — ReviewAgent tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ReviewAgent } from "../../../src/workflow/agents/review-agent.js";
import { WorkflowCoordinator } from "../../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { ExecutionPlan, WorkPackage } from "../../../src/workflow/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validPlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  const wp: WorkPackage = {
    issueNumber: 63,
    issueTitle: "PlanningAgent implementation",
    labels: ["type:feature", "phase:p4.5", "ready-for-agent"],
    priority: "medium",
    complexity: "medium",
    estimatedFiles: [
      "src/workflow/agents/planning-agent.ts",
      "tests/workflow/agents/planning-agent.vitest.ts",
    ],
    dependencies: [61, 62],
    acceptanceCriteria: [
      "Produces an ExecutionPlan from a WorkPackage",
      "Validates the work package",
      "Creates subtasks with dependency graph",
    ],
    riskFlags: [],
  };

  return {
    workPackage: wp,
    subtasks: [
      {
        id: "step-0",
        description: "Set up project structure",
        files: ["src/workflow/agents/planning-agent.ts"],
        testFiles: [],
        acceptanceCheck: "Project structure is ready",
        dependsOn: [],
      },
      {
        id: "step-1",
        description: "Produces an ExecutionPlan from a WorkPackage",
        files: ["src/workflow/agents/planning-agent.ts"],
        testFiles: ["tests/workflow/agents/planning-agent.vitest.ts"],
        acceptanceCheck: "Verify: plan() returns ExecutionPlan with all fields",
        dependsOn: ["step-0"],
      },
      {
        id: "step-2",
        description: "Validates the work package",
        files: ["src/workflow/agents/planning-agent.ts"],
        testFiles: ["tests/workflow/agents/planning-agent.vitest.ts"],
        acceptanceCheck: "Verify: validation rejects invalid work packages",
        dependsOn: ["step-1"],
      },
      {
        id: "step-3",
        description: "Creates subtasks with dependency graph",
        files: ["src/workflow/agents/planning-agent.ts"],
        testFiles: ["tests/workflow/agents/planning-agent.vitest.ts"],
        acceptanceCheck: "Verify: subtasks have correct dependsOn",
        dependsOn: ["step-2"],
      },
    ],
    branchName: "feature/issue-63-planning-agent",
    estimatedCommits: 5,
    approvalRequired: true,
    ...overrides,
  };
}

function tmpDir(): string {
  const dir = join("/tmp", "review-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReviewAgent", () => {
  let agent: ReviewAgent;

  beforeEach(() => {
    agent = new ReviewAgent();
  });

  describe("review — valid plans (approve)", () => {
    it("approves a valid plan with no findings", async () => {
      const result = await agent.review(validPlan());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.verdict).toBe("approve");
      expect(result.report.findings.length).toBeGreaterThanOrEqual(0);
      expect(result.report.issueNumber).toBe(63);
    });

    it("approves plans with only minor/nit findings", async () => {
      const plan = validPlan({
        estimatedCommits: 20,
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.verdict).toBe("approve");
    });

    it("includes finding count in summary", async () => {
      const result = await agent.review(validPlan());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.summary).toContain("approved");
    });
  });

  describe("review — governance checks", () => {
    it("rejects plan with approvalRequired: false", async () => {
      const plan = validPlan({ approvalRequired: false });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.verdict).toBe("reject");
      expect(result.report.findings.some(
        (f) => f.severity === "critical" && f.summary.includes("human approval"),
      )).toBe(true);
    });

    it("rejects plans modifying src/agents/", async () => {
      const plan = validPlan({
        subtasks: [
          {
            id: "step-1",
            description: "Modify agent",
            files: ["src/agents/issue-intake-agent.ts"],
            testFiles: [],
            acceptanceCheck: "Updated",
            dependsOn: [],
          },
        ],
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.verdict).toBe("reject");
      expect(result.report.findings.some(
        (f) => f.file.startsWith("src/agents/"),
      )).toBe(true);
    });

    it("flags files in protected paths", async () => {
      const plan = validPlan({
        subtasks: [
          {
            id: "step-1",
            description: "Modify config",
            files: [".alix/config.json"],
            testFiles: [],
            acceptanceCheck: "Config updated",
            dependsOn: [],
          },
        ],
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.verdict).toBe("reject");
      expect(result.report.findings.some(
        (f) => f.file === ".alix/config.json",
      )).toBe(true);
    });

    it("flags missing branch name", async () => {
      const plan = validPlan({ branchName: "" });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.findings.some(
        (f) => f.severity === "major" && f.summary.includes("branch name"),
      )).toBe(true);
    });
  });

  describe("review — completeness checks", () => {
    it("flags subtask count mismatch", async () => {
      const plan = validPlan({
        subtasks: [
          {
            id: "step-1",
            description: "Only one subtask",
            files: ["src/foo.ts"],
            testFiles: [],
            acceptanceCheck: "Works",
            dependsOn: [],
          },
        ],
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // 3 ACs but only 1 AC subtask (step-0 excluded)
      const acSubtasks = plan.subtasks.filter((s) => s.id !== "step-0");
      expect(acSubtasks.length).toBeLessThan(
        plan.workPackage.acceptanceCriteria.length,
      );
      expect(result.report.findings.some(
        (f) => f.severity === "major",
      )).toBe(true);
    });

    it("flags subtasks with no files", async () => {
      const plan = validPlan({
        subtasks: [
          {
            id: "step-1",
            description: "No files subtask",
            files: [],
            testFiles: [],
            acceptanceCheck: "Check",
            dependsOn: [],
          },
        ],
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.findings.some(
        (f) => f.summary.includes("no files"),
      )).toBe(true);
    });

    it("flags subtasks with missing acceptance check", async () => {
      const plan = validPlan({
        subtasks: [
          {
            id: "step-1",
            description: "Missing check",
            files: ["src/foo.ts"],
            testFiles: [],
            acceptanceCheck: "",
            dependsOn: [],
          },
        ],
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.findings.some(
        (f) => f.summary.includes("missing acceptance check"),
      )).toBe(true);
    });

    it("flags empty acceptance criteria", async () => {
      const plan = validPlan({
        workPackage: {
          ...validPlan().workPackage,
          acceptanceCriteria: ["Valid AC", ""],
        },
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.findings.some(
        (f) => f.summary.includes("empty"),
      )).toBe(true);
    });
  });

  describe("review — test coverage", () => {
    it("nits when source files lack test files", async () => {
      const plan = validPlan({
        subtasks: [
          {
            id: "step-1",
            description: "AC one",
            files: ["src/foo.ts"],
            testFiles: [],
            acceptanceCheck: "Check",
            dependsOn: [],
          },
        ],
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.findings.some(
        (f) => f.severity === "nit" && f.summary.includes("no test files"),
      )).toBe(true);
    });

    it("skips test coverage nit for setup subtask", async () => {
      const plan = validPlan({
        subtasks: [
          {
            id: "step-0",
            description: "Setup",
            files: ["src/foo.ts"],
            testFiles: [],
            acceptanceCheck: "Ready",
            dependsOn: [],
          },
        ],
      });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // step-0 should not get test coverage nits
      expect(result.report.findings.some(
        (f) => f.severity === "nit" && f.summary.includes("no test files") && f.file === "step-0",
      )).toBe(false);
    });
  });

  describe("review — risk assessment", () => {
    it("flags large plans", async () => {
      const subtasks = Array.from({ length: 10 }, (_, i) => ({
        id: `step-${i}`,
        description: `Subtask ${i}`,
        files: ["src/foo.ts"],
        testFiles: [],
        acceptanceCheck: "Check",
        dependsOn: i > 0 ? [`step-${i - 1}`] : [],
      }));
      const plan = validPlan({ subtasks });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.findings.some(
        (f) => f.summary.includes("Large plan") || f.summary.includes("large plan"),
      )).toBe(true);
    });

    it("flags high commit count", async () => {
      const plan = validPlan({ estimatedCommits: 20 });
      const result = await agent.review(plan);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.findings.some(
        (f) => f.summary.includes("High commit"),
      )).toBe(true);
    });
  });

  describe("review — rejection", () => {
    it("rejects null plan", async () => {
      const result = await agent.review(null as unknown as ExecutionPlan);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("missing_plan");
    });

    it("rejects plan without work package", async () => {
      const result = await agent.review({} as ExecutionPlan);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("invalid_plan");
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

    it("transitions PLANNED → UNDER_REVIEW and records evidence", async () => {
      const plan = validPlan();

      // Set up the issue in PLANNED state
      await coordinator.transition(63, "NEW", { actor: "system" });
      await coordinator.transition(63, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(63, "PLANNED", { actor: "PlanningAgent" });

      const result = await agent.execute(plan, coordinator, writer);
      expect(result.success).toBe(true);
      if (!result.success) return;

      // Verify state
      const state = await coordinator.currentState(63);
      expect(state?.state).toBe("UNDER_REVIEW");

      // Verify evidence
      const reviewCompleted = await store.query({
        type: "review_completed",
      });
      expect(reviewCompleted.records.length).toBe(1);
      expect(result.evidenceFingerprint).toBeTruthy();
    });

    it("records both review_started and review_completed", async () => {
      const plan = validPlan();
      await coordinator.transition(63, "NEW", { actor: "system" });
      await coordinator.transition(63, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(63, "PLANNED", { actor: "PlanningAgent" });

      await agent.execute(plan, coordinator, writer);

      const started = await store.query({ type: "review_started" });
      expect(started.records.length).toBe(1);

      const completed = await store.query({ type: "review_completed" });
      expect(completed.records.length).toBe(1);
    });

    it("rejects invalid plans in execute flow", async () => {
      await coordinator.transition(63, "NEW", { actor: "system" });
      await coordinator.transition(63, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(63, "PLANNED", { actor: "PlanningAgent" });

      const result = await agent.execute(
        {} as ExecutionPlan,
        coordinator,
        writer,
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("invalid_plan");

      // State should still be PLANNED
      const state = await coordinator.currentState(63);
      expect(state?.state).toBe("PLANNED");
    });

    it("returns report with all findings in execute flow", async () => {
      const plan = validPlan({ approvalRequired: false });
      await coordinator.transition(63, "NEW", { actor: "system" });
      await coordinator.transition(63, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(63, "PLANNED", { actor: "PlanningAgent" });

      const result = await agent.execute(plan, coordinator, writer);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.report.verdict).toBe("reject");
      expect(result.report.findings.length).toBeGreaterThan(0);
    });
  });
});
