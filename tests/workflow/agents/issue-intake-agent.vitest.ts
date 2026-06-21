/**
 * P4.5a — IssueIntakeAgent tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { IssueIntakeAgent } from "../../../src/workflow/agents/issue-intake-agent.js";
import { WorkflowCoordinator } from "../../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import type { GhIssueData } from "../../../src/workflow/agents/issue-intake-agent.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validIssue(overrides?: Partial<GhIssueData>): GhIssueData {
  return {
    number: 62,
    title: "P4.5a — IssueIntakeAgent: read issues, estimate, package",
    body: `## Goal

Build the IssueIntakeAgent that reads issues and produces a WorkPackage.

## Acceptance Criteria

- [ ] Reads issue from GitHub
- [ ] Validates the ready-for-agent label
- [ ] Estimates complexity
- [ ] Detects dependencies

Depends on #61

## Files

- \`src/workflow/agents/issue-intake-agent.ts\`
- \`tests/workflow/agents/issue-intake-agent.vitest.ts\`
`,
    state: "OPEN",
    labels: [
      { name: "type:feature" },
      { name: "phase:p4.5" },
      { name: "ready-for-agent" },
    ],
    closed: false,
    ...overrides,
  };
}

function blockedIssue(): GhIssueData {
  return {
    ...validIssue({ title: "Blocked issue" }),
    labels: [
      { name: "type:feature" },
      { name: "phase:p4.5" },
      { name: "ready-for-agent" },
      { name: "blocked" },
    ],
  };
}

function needsHumanIssue(): GhIssueData {
  return {
    ...validIssue({ title: "Needs human" }),
    labels: [
      { name: "type:feature" },
      { name: "phase:p4.5" },
      { name: "ready-for-agent" },
      { name: "needs-human" },
    ],
  };
}

function noReadyLabelIssue(): GhIssueData {
  return {
    ...validIssue({ title: "No ready label" }),
    labels: [{ name: "type:feature" }, { name: "phase:p4.5" }],
  };
}

function closedIssue(): GhIssueData {
  return { ...validIssue(), state: "CLOSED", closed: true };
}

function tmpDir(): string {
  const dir = join("/tmp", "intake-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IssueIntakeAgent", () => {
  let agent: IssueIntakeAgent;

  beforeEach(() => {
    agent = new IssueIntakeAgent();
  });

  describe("intake — valid issues", () => {
    it("produces a WorkPackage for a valid issue", async () => {
      const result = await agent.intake(62, validIssue());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.issueNumber).toBe(62);
      expect(result.workPackage.issueTitle).toContain("IssueIntakeAgent");
      expect(result.workPackage.labels).toContain("ready-for-agent");
    });

    it("extracts acceptance criteria from the body", async () => {
      const result = await agent.intake(62, validIssue());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.acceptanceCriteria.length).toBe(4);
      expect(result.workPackage.acceptanceCriteria[0]).toContain("Reads issue");
    });

    it("detects dependency references", async () => {
      const result = await agent.intake(62, validIssue());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.dependencies).toContain(61);
    });

    it("estimates priority from labels", async () => {
      // No explicit priority label → type:feature → medium
      const result = await agent.intake(62, validIssue());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.priority).toBe("medium");
    });

    it("estimates priority:critical from label", async () => {
      const data = validIssue({
        labels: [
          { name: "priority:critical" },
          { name: "ready-for-agent" },
        ],
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.priority).toBe("critical");
    });

    it("estimates priority:high for bugs", async () => {
      const data = validIssue({
        labels: [
          { name: "type:bug" },
          { name: "ready-for-agent" },
        ],
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.priority).toBe("high");
    });

    it("estimates complexity from AC count", async () => {
      const data = validIssue();
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      // 4 AC items → medium
      expect(result.workPackage.complexity).toBe("medium");
    });

    it("estimates complexity:small for 1-2 ACs", async () => {
      const data = validIssue({
        body: "## Acceptance Criteria\n\n- [ ] One thing\n- [ ] Another thing\n",
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.complexity).toBe("small");
    });

    it("estimates files from ## Files sections", async () => {
      const result = await agent.intake(62, validIssue());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.estimatedFiles).toContain(
        "src/workflow/agents/issue-intake-agent.ts",
      );
    });

    it("detects risk flags", async () => {
      const data = validIssue({
        body: "## Goal\n\nAPI change required. Migration needed.\n",
        labels: [
          { name: "type:feature" },
          { name: "ready-for-agent" },
          { name: "security" },
        ],
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.riskFlags).toContain("security relevant");
      expect(result.workPackage.riskFlags).toContain("API change");
      expect(result.workPackage.riskFlags).toContain("migration required");
    });

    it("handles issue with no body", async () => {
      const data = validIssue({
        body: "Simple one-line issue.",
        labels: [{ name: "ready-for-agent" }],
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.acceptanceCriteria).toEqual([]);
      expect(result.workPackage.dependencies).toEqual([]);
      expect(result.workPackage.complexity).toBe("unknown");
    });
  });

  describe("intake — rejection", () => {
    it("rejects issues without ready-for-agent label", async () => {
      const result = await agent.intake(62, noReadyLabelIssue());
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("missing_ready_label");
    });

    it("rejects blocked issues", async () => {
      const result = await agent.intake(62, blockedIssue());
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("blocked");
      expect(result.error).toContain("blocked");
    });

    it("rejects needs-human issues", async () => {
      const result = await agent.intake(62, needsHumanIssue());
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("needs_human");
    });

    it("rejects closed issues", async () => {
      const result = await agent.intake(62, closedIssue());
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("invalid_issue");
    });

    it("rejects wontfix issues", async () => {
      const data = validIssue({
        labels: [{ name: "ready-for-agent" }, { name: "wontfix" }],
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(false);
    });

    it("rejects issues with invalid state", async () => {
      const data = validIssue({ state: "MERGED" });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(false);
    });
  });

  describe("intake — edge cases", () => {
    it("handles empty labels array", async () => {
      const data = validIssue({ labels: [] });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("missing_ready_label");
    });

    it("handles body with markdown tables", async () => {
      const data = validIssue({
        body: `| # | Title |\n|---|-------|\n| 62 | Something |\n\nDepends on #99\n`,
        labels: [{ name: "ready-for-agent" }],
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.dependencies).toContain(99);
    });

    it("detects blocked by dependency pattern", async () => {
      const data = validIssue({
        body: "Blocked by #42 and requires #17",
        labels: [{ name: "ready-for-agent" }],
      });
      const result = await agent.intake(62, data);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.dependencies).toContain(42);
      expect(result.workPackage.dependencies).toContain(17);
    });
  });

  describe("select — full flow", () => {
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

    it("transitions NEW → SELECTED and records evidence", async () => {
      const result = await agent.select(62, coordinator, writer, validIssue());
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.workPackage.issueNumber).toBe(62);

      // Verify state transition
      const state = await coordinator.currentState(62);
      expect(state).not.toBeNull();
      expect(state!.state).toBe("SELECTED");

      // Verify evidence was recorded
      const evidence = await store.query({ type: "issue_selected" });
      expect(evidence.records.length).toBe(1);
      expect(result.evidenceFingerprint).toBeTruthy();
    });

    it("rejects blocked issues in select flow", async () => {
      const result = await agent.select(62, coordinator, writer, blockedIssue());
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.code).toBe("blocked");

      // No state should have been created
      const state = await coordinator.currentState(62);
      expect(state).toBeNull();
    });

    it("select is idempotent for different issues", async () => {
      const r1 = await agent.select(62, coordinator, writer, validIssue());
      expect(r1.success).toBe(true);

      const r2 = await agent.select(63, coordinator, writer, {
        ...validIssue({ title: "Different issue" }),
        number: 63,
        body: "- [ ] Task A\n- [ ] Task B\n",
        labels: [{ name: "ready-for-agent" }],
      });
      expect(r2.success).toBe(true);
      if (!r2.success) return; // type guard
      expect(r2.workPackage.issueNumber).toBe(63);

      // Both should have evidence
      const evidence = await store.query({ type: "issue_selected" });
      expect(evidence.records.length).toBe(2);
    });
  });
});
