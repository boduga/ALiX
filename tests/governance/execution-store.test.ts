import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionStore } from "../../src/governance/execution-store.js";
import type { GovernanceExecutionAttempt } from "../../src/governance/execution-recorder.js";

const NOW = "2026-07-07T14:00:00.000Z";

function makeAttempt(overrides: Partial<GovernanceExecutionAttempt> = {}): GovernanceExecutionAttempt {
  return {
    attemptId: "attempt-001",
    planId: "plan-001",
    remediationId: "remediation-001",
    approvalId: "approval-001",
    status: "started",
    startedAt: NOW,
    completedAt: null,
    executedBy: "alice",
    actionResults: [
      { actionId: "act-1", status: "succeeded", summary: "Completed", evidenceRefs: [] },
    ],
    failureReason: null,
    revertAttemptId: null,
    auditRefs: [],
    ...overrides,
  };
}

describe("ExecutionStore", () => {
  let tmpDir: string;
  let store: ExecutionStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "exec-store-test-"));
    store = new ExecutionStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("append and list: single attempt", async () => {
    const attempt = makeAttempt();
    await store.append(attempt);

    const all = await store.list();
    assert.ok(all.length >= 1);
    const found = all.find((a) => a.attemptId === "attempt-001");
    assert.ok(found);
    assert.equal(found!.planId, "plan-001");
    assert.equal(found!.status, "started");
  });

  it("append and list: multiple attempts, newest-first", async () => {
    const a1 = makeAttempt({ attemptId: "a-1", startedAt: "2026-07-07T10:00:00.000Z" });
    const a2 = makeAttempt({ attemptId: "a-2", startedAt: "2026-07-07T11:00:00.000Z" });
    await store.append(a1);
    await store.append(a2);

    const all = await store.list();
    const idx1 = all.findIndex((a) => a.attemptId === "a-1");
    const idx2 = all.findIndex((a) => a.attemptId === "a-2");
    assert.ok(idx1 >= 0);
    assert.ok(idx2 >= 0);
    assert.ok(idx2 < idx1, "newest attempt should appear first (lower index after reversal)");
  });

  it("list with limit", async () => {
    const limited = await store.list(1);
    assert.equal(limited.length, 1);
  });

  it("getById: found", async () => {
    const found = await store.getById("attempt-001");
    assert.ok(found);
    assert.equal(found!.attemptId, "attempt-001");
  });

  it("getById: not found", async () => {
    const found = await store.getById("nonexistent");
    assert.equal(found, null);
  });

  it("getByPlanId: matches", async () => {
    const byPlan = await store.getByPlanId("plan-001");
    assert.ok(byPlan.length >= 2);
    assert.ok(byPlan.every((a) => a.planId === "plan-001"));
  });

  it("getByPlanId: no matches", async () => {
    const byPlan = await store.getByPlanId("plan-nonexistent");
    assert.deepEqual(byPlan, []);
  });

  it("getByApprovalId: matches", async () => {
    const byApproval = await store.getByApprovalId("approval-001");
    assert.ok(byApproval.length >= 1);
    assert.ok(byApproval.every((a) => a.approvalId === "approval-001"));
  });

  it("getByApprovalId: no matches", async () => {
    const byApproval = await store.getByApprovalId("approval-nonexistent");
    assert.deepEqual(byApproval, []);
  });

  it("empty store returns empty list", async () => {
    const emptyStore = new ExecutionStore(join(tmpDir, "empty-dir"));
    const all = await emptyStore.list();
    assert.deepEqual(all, []);
  });
});
