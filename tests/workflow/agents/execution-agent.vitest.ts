/**
 * P4.5g — ExecutionAgent tests.
 *
 * All tests inject mocks for writeFile / runTests / gitCommit.
 * No actual files, git, or tests are touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ExecutionAgent } from "../../../src/workflow/agents/execution-agent.js";
import { WorkflowCoordinator } from "../../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { ExecutionPlan, WorkPackage, ExecutionPermit, Subtask } from "../../../src/workflow/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validPlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  const wp: WorkPackage = {
    issueNumber: 68,
    issueTitle: "P4.5g — ExecutionAgent: one-subtask execution",
    labels: ["type:feature", "phase:p4.5", "ready-for-agent"],
    priority: "high",
    complexity: "medium",
    estimatedFiles: ["src/feature-x.ts", "tests/feature-x.test.ts"],
    dependencies: [],
    acceptanceCriteria: ["Implements feature X", "Tests pass"],
    riskFlags: [],
  };

  return {
    workPackage: wp,
    subtasks: [
      {
        id: "step-1",
        description: "Implement feature X",
        files: ["src/feature-x.ts"],
        testFiles: ["tests/feature-x.test.ts"],
        acceptanceCheck: "Verify: feature X works",
        dependsOn: [],
      },
      {
        id: "step-2",
        description: "Add tests for feature X",
        files: ["tests/feature-x.test.ts"],
        testFiles: [],
        acceptanceCheck: "Verify: tests pass",
        dependsOn: ["step-1"],
      },
    ],
    branchName: "feature/issue-68-execution-agent",
    estimatedCommits: 3,
    approvalRequired: true,
    ...overrides,
  };
}

function validPermit(plan: ExecutionPlan): ExecutionPermit {
  return {
    issueNumber: plan.workPackage.issueNumber,
    planFingerprint: "test-fp-123",
    allowedFiles: plan.subtasks.flatMap((s) => s.files),
    issuedAt: new Date().toISOString(),
  };
}

function tmpDir(): string {
  const dir = join("/tmp", "exec-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionAgent", () => {
  describe("execute — happy path", () => {
    it("executes all subtasks and transitions to UNDER_REVIEW", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan();

      // Set up: issue must be in APPROVED_FOR_EXECUTION
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      const agent = new ExecutionAgent({
        writeFile: async () => {},
        runTests: async () => ({ passed: true, durationMs: 100 }),
        gitCommit: async () => "abc123def456",
      });

      const result = await agent.execute(plan, coordinator, writer, validPermit(plan));
      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2);
      expect(result.results[0].subtaskId).toBe("step-1");
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].subtaskId).toBe("step-2");
      expect(result.results[1].success).toBe(true);

      // State should be UNDER_REVIEW now
      const state = await coordinator.currentState(68);
      expect(state?.state).toBe("UNDER_REVIEW");

      // Verify evidence was recorded
      const all = await store.query({ limit: 100 });
      const types = new Set(all.records.map((r) => r.type));
      expect(types.has("execution_subtask_started")).toBe(true);
      expect(types.has("execution_subtask_completed")).toBe(true);
      expect(types.has("execution_commit_created")).toBe(true);
      expect(types.has("execution_test_passed")).toBe(true);

      rmSync(dir, { recursive: true, force: true });
    });

    it("records commits per subtask", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan();
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      const agent = new ExecutionAgent({
        writeFile: async () => {},
        runTests: async () => ({ passed: true, durationMs: 50 }),
        gitCommit: async (files, msg) => `sha-${msg.slice(0, 10)}`,
      });

      await agent.execute(plan, coordinator, writer, validPermit(plan));

      const commits = await store.query({ type: "execution_commit_created" });
      expect(commits.records.length).toBe(2);
      const subtaskIds = new Set(commits.records.map((r) => r.payload.subtaskId));
      expect(subtaskIds.has("step-1")).toBe(true);
      expect(subtaskIds.has("step-2")).toBe(true);

      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("execute — safety guards", () => {
    it("rejects execution without a permit", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const agent = new ExecutionAgent({ writeFile: async () => {} });
      const result = await agent.execute(validPlan(), coordinator, writer, null as unknown as ExecutionPermit);
      expect(result.success).toBe(false);
      expect(result.code).toBe("no_permit");

      rmSync(dir, { recursive: true, force: true });
    });

    it("rejects execution when issue is not in APPROVED_FOR_EXECUTION", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan();
      // Only set up to SELECTED, not APPROVED_FOR_EXECUTION
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });

      const agent = new ExecutionAgent({ writeFile: async () => {} });
      const result = await agent.execute(plan, coordinator, writer, validPermit(plan));
      expect(result.success).toBe(false);

      rmSync(dir, { recursive: true, force: true });
    });

    it("rejects files not in the permit's allowed list", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan();
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      // Create a plan with a file NOT in the permit
      const roguePlan = validPlan({
        subtasks: [{
          id: "step-1",
          description: "Rogue file",
          files: ["src/not-allowed.ts"],
          testFiles: [],
          acceptanceCheck: "Check",
          dependsOn: [],
        }],
      });

      const agent = new ExecutionAgent({ writeFile: async () => {} });
      const result = await agent.execute(roguePlan, coordinator, writer, validPermit(plan));
      expect(result.success).toBe(false);
      expect(result.code).toBe("file_not_allowed");

      rmSync(dir, { recursive: true, force: true });
    });

    it("rejects files in protected paths", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan({
        subtasks: [{
          id: "step-1",
          description: "Modify config",
          files: ["src/config/app.ts"],
          testFiles: [],
          acceptanceCheck: "Check",
          dependsOn: [],
        }],
      });

      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      const agent = new ExecutionAgent({ writeFile: async () => {} });
      const result = await agent.execute(plan, coordinator, writer, validPermit(plan));
      expect(result.success).toBe(false);
      expect(result.code).toBe("protected_path");

      rmSync(dir, { recursive: true, force: true });
    });

    it("rejects permit/plan mismatch", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan();
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      // Permit for issue 1, plan for issue 68
      const badPermit = { ...validPermit(plan), issueNumber: 1 };
      const agent = new ExecutionAgent({ writeFile: async () => {} });
      const result = await agent.execute(plan, coordinator, writer, badPermit);
      expect(result.success).toBe(false);
      expect(result.code).toBe("permit_mismatch");

      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("execute — failure handling", () => {
    it("stops on test failure", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan();
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      let callCount = 0;
      const agent = new ExecutionAgent({
        writeFile: async () => {},
        runTests: async () => {
          callCount++;
          if (callCount === 1) return { passed: false, durationMs: 50, error: "Test 1 failed" };
          return { passed: true, durationMs: 50 };
        },
        gitCommit: async () => "sha",
      });

      const result = await agent.execute(plan, coordinator, writer, validPermit(plan));
      expect(result.success).toBe(false);
      expect(result.code).toBe("tests_failed");
      // Only the first subtask should have run
      expect(result.results.length).toBe(1);
      expect(result.results[0].subtaskId).toBe("step-1");
      expect(result.results[0].success).toBe(false);

      rmSync(dir, { recursive: true, force: true });
    });

    it("records execution_test_failed on test failure", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const plan = validPlan({
        subtasks: [{
          id: "step-1",
          description: "Test that fails",
          files: ["src/foo.ts"],
          testFiles: ["tests/foo.test.ts"],
          acceptanceCheck: "Check",
          dependsOn: [],
        }],
      });
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      const agent = new ExecutionAgent({
        writeFile: async () => {},
        runTests: async () => ({ passed: false, durationMs: 30, error: "Assertion failed" }),
        gitCommit: async () => "sha",
      });

      await agent.execute(plan, coordinator, writer, validPermit(plan));
      const failed = await store.query({ type: "execution_test_failed" });
      expect(failed.records.length).toBe(1);
      expect(failed.records[0].payload.error).toBe("Assertion failed");

      rmSync(dir, { recursive: true, force: true });
    });

    it("returns partial results on failure", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      // Both subtasks need testFiles so the mock gets called twice
      const plan = validPlan({
        subtasks: [
          {
            id: "step-1",
            description: "Step one",
            files: ["src/a.ts"],
            testFiles: ["tests/a.test.ts"],
            acceptanceCheck: "Check",
            dependsOn: [],
          },
          {
            id: "step-2",
            description: "Step two",
            files: ["src/b.ts"],
            testFiles: ["tests/b.test.ts"],
            acceptanceCheck: "Check",
            dependsOn: ["step-1"],
          },
        ],
      });
      await coordinator.transition(68, "NEW", { actor: "system" });
      await coordinator.transition(68, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(68, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(68, "APPROVED_FOR_EXECUTION", { actor: "human" });

      let testRun = 0;
      const agent = new ExecutionAgent({
        writeFile: async () => {},
        runTests: async () => {
          testRun++;
          if (testRun === 1) return { passed: true, durationMs: 50 };
          return { passed: false, durationMs: 30, error: "Failed" };
        },
        gitCommit: async () => "sha",
      });

      const result = await agent.execute(plan, coordinator, writer, validPermit(plan));
      expect(result.success).toBe(false);
      expect(result.results.length).toBe(2);
      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
