/**
 * P4.5f — PRAgent tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PRAgent } from "../../../src/workflow/agents/pr-agent.js";
import { WorkflowCoordinator } from "../../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { ExecutionPlan, WorkPackage, ReviewReport } from "../../../src/workflow/types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validPlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  const wp: WorkPackage = {
    issueNumber: 63,
    issueTitle: "P4.5b — PlanningAgent: subtask decomposition",
    labels: ["type:feature", "phase:p4.5", "ready-for-agent"],
    priority: "medium",
    complexity: "medium",
    estimatedFiles: ["src/agents/planning-agent.ts", "tests/agents/planning-agent.test.ts"],
    dependencies: [61, 62],
    acceptanceCriteria: ["Creates plan", "Validates input"],
    riskFlags: [],
  };

  return {
    workPackage: wp,
    subtasks: [
      {
        id: "step-1",
        description: "Implement plan generation",
        files: ["src/agents/planning-agent.ts"],
        testFiles: ["tests/agents/planning-agent.test.ts"],
        acceptanceCheck: "Verify: plan() returns ExecutionPlan",
        dependsOn: [],
      },
      {
        id: "step-2",
        description: "Add validation logic",
        files: ["src/agents/planning-agent.ts"],
        testFiles: ["tests/agents/planning-agent.test.ts"],
        acceptanceCheck: "Verify: validation rejects invalid input",
        dependsOn: ["step-1"],
      },
    ],
    branchName: "feature/issue-63-planning-agent",
    estimatedCommits: 3,
    approvalRequired: true,
    ...overrides,
  };
}

function reviewReport(overrides?: Partial<ReviewReport>): ReviewReport {
  return {
    issueNumber: 63,
    commitSha: "plan",
    verdict: "approve",
    findings: [
      {
        severity: "nit",
        file: "plan",
        summary: "Consider adding more test files",
        recommendation: "Add tests for edge cases",
      },
    ],
    summary: "Plan approved with 1 nit finding(s).",
    ...overrides,
  };
}

function tmpDir(): string {
  const dir = join("/tmp", "pr-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PRAgent", () => {
  describe("prepare", () => {
    it("generates a PR artifact from an ExecutionPlan", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(validPlan());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.title).toBeTruthy();
      expect(result.artifact.body).toContain("Closes #63");
      expect(result.artifact.draft).toBe(true);
      expect(result.artifact.branchName).toBe("feature/issue-63-planning-agent");
    });

    it("includes issue link in body", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(validPlan());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.body).toContain("Closes #63");
    });

    it("includes subtask breakdown in body", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(validPlan());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.body).toContain("Implement plan generation");
      expect(result.artifact.body).toContain("Add validation logic");
    });

    it("includes review findings when provided", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(validPlan(), reviewReport());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.body).toContain("## Review");
      expect(result.artifact.body).toContain("[nit]");
      expect(result.artifact.body).toContain("test files");
    });

    it("includes evidence fingerprints when provided", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const fps = ["abc123", "def456"];
      const result = await agent.prepare(validPlan(), undefined, fps);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.body).toContain("abc123");
      expect(result.artifact.body).toContain("def456");
      expect(result.artifact.evidenceFingerprints).toEqual(fps);
    });

    it("sets draft to true", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(validPlan());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.draft).toBe(true);
    });

    it("does not include branch name in title", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(validPlan());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.title).not.toContain("feature/");
    });
  });

  describe("prepare — rejection", () => {
    it("rejects null plan", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(null as unknown as ExecutionPlan);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("missing_plan");
    });

    it("rejects plan without branch name", async () => {
      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.prepare(validPlan({ branchName: "" }));
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("missing_branch");
    });
  });

  describe("create", () => {
    it("creates draft PR, transitions, and records evidence", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      // Set up issue in PR_READY state
      await coordinator.transition(63, "NEW", { actor: "system" });
      await coordinator.transition(63, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(63, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(63, "PR_READY", { actor: "ReviewAgent" });

      const agent = new PRAgent({
        execCommand: () => "https://github.com/boduga/ALiX/pull/99",
      });

      const result = await agent.create(
        validPlan(),
        coordinator,
        writer,
        reviewReport(),
        ["ev-fp-123"],
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.prUrl).toBe("https://github.com/boduga/ALiX/pull/99");
      expect(result.artifact.draft).toBe(true);

      // Verify state transition
      const state = await coordinator.currentState(63);
      expect(state?.state).toBe("AWAITING_HUMAN");

      // Verify evidence
      const prEvidence = await store.query({ type: "pr_created" });
      expect(prEvidence.records.length).toBe(1);
      expect(prEvidence.records[0].payload.prUrl).toBe(
        "https://github.com/boduga/ALiX/pull/99",
      );

      rmSync(dir, { recursive: true, force: true });
    });

    it("rejects plan with no branch name in create flow", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      const agent = new PRAgent({ execCommand: () => "" });
      const result = await agent.create(
        validPlan({ branchName: "" }),
        coordinator,
        writer,
      );
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("missing_branch");

      rmSync(dir, { recursive: true, force: true });
    });

    it("includes review findings in PR body when provided", async () => {
      const dir = tmpDir();
      const coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
      const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
      const writer = new EvidenceEventWriter((t, p) => store.append(t, p));

      await coordinator.transition(63, "NEW", { actor: "system" });
      await coordinator.transition(63, "SELECTED", { actor: "IssueIntakeAgent" });
      await coordinator.transition(63, "PLANNED", { actor: "PlanningAgent" });
      await coordinator.transition(63, "PR_READY", { actor: "ReviewAgent" });

      const agent = new PRAgent({
        execCommand: () => "https://github.com/boduga/ALiX/pull/99",
      });

      const report = reviewReport({
        verdict: "changes_requested",
        findings: [
          { severity: "major", file: "src/planning.ts", summary: "Missing validation", recommendation: "Add it" },
        ],
      });

      const result = await agent.create(
        validPlan(),
        coordinator,
        writer,
        report,
      );
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.artifact.body).toContain("changes_requested");
      expect(result.artifact.body).toContain("Missing validation");

      rmSync(dir, { recursive: true, force: true });
    });
  });
});
