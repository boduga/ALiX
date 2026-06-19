/**
 * P4.6d — Orchestrator bridge tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkflowOrchestrator } from "../../src/workflow/orchestrator-bridge.js";
import { WorkflowCoordinator } from "../../src/workflow/coordinator.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";

function tmpDir(): string {
  const dir = join("/tmp", "orb-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

describe("WorkflowOrchestrator", () => {
  let dir: string;
  let coordinator: WorkflowCoordinator;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    dir = tmpDir();
    coordinator = new WorkflowCoordinator({ workflowDir: join(dir, "workflow") });
    const store = new EvidenceStore({ storeDir: join(dir, "evidence") });
    writer = new EvidenceEventWriter((t, p) => store.append(t, p));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("selects and runs plan-only skill from a goal", async () => {
    const orchestrator = new WorkflowOrchestrator(coordinator, writer);
    const result = await orchestrator.runGoal({
      issueNumber: 61,
      issueTitle: "Test orchestrator goal routing",
      body: "## Acceptance Criteria\n- [ ] Task A",
      labels: [{ name: "ready-for-agent" }],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.workPackage).toBeDefined();
    expect(result.plan).toBeDefined();
    expect(result.review).toBeDefined();
  });

  it("lists available skills", async () => {
    const orchestrator = new WorkflowOrchestrator(coordinator, writer);
    const skills = await orchestrator.listSkills();
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.some(s => s.id === "issue-lifecycle")).toBe(true);
  });

  it("rejects goals without ready-for-agent label", async () => {
    const orchestrator = new WorkflowOrchestrator(coordinator, writer);
    const result = await orchestrator.runGoal({
      issueNumber: 61,
      issueTitle: "Bad issue",
      body: "",
      labels: [],
    });
    expect(result.success).toBe(false);
  });
});
