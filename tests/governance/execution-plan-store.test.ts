import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ExecutionPlanStore } from "../../src/governance/execution-plan-store.js";
import { createExecutionPlanFromRemediation } from "../../src/governance/execution-plans.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";

const NOW = "2026-07-07T14:00:00.000Z";

function makeProposal(overrides: Partial<GovernanceRemediationProposal> = {}): GovernanceRemediationProposal {
  return {
    proposalId: "prop-test",
    sourceRecommendationIds: ["rec-1"],
    title: "Test proposal",
    severity: "warning",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-08T00:00:00.000Z",
    evidenceRefs: [],
    status: "accepted",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "review",
    reversible: true,
    ...overrides,
  };
}

describe("ExecutionPlanStore", () => {
  let tmpDir: string;
  let store: ExecutionPlanStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "plan-store-test-"));
    store = new ExecutionPlanStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save and get: round-trips a plan", async () => {
    const plan = createExecutionPlanFromRemediation(makeProposal(), { now: NOW });
    await store.append(plan);
    const found = await store.get(plan.planId);
    assert.ok(found);
    assert.equal(found!.status, "draft");
  });

  it("getByRemediationId: returns latest plan for a remediation", async () => {
    const p1 = createExecutionPlanFromRemediation(makeProposal({ proposalId: "r-1", createdAt: NOW }), { now: "2026-07-07T10:00:00.000Z" });
    const p2 = createExecutionPlanFromRemediation(makeProposal({ proposalId: "r-1", createdAt: NOW }), { now: "2026-07-07T11:00:00.000Z" });
    await store.append(p1);
    await store.append(p2);
    const latest = await store.getByRemediationId("r-1");
    assert.ok(latest);
    assert.equal(latest!.planId, p2.planId, "latest plan by createdAt wins");
  });

  it("getByRemediationId: no plan returns null", async () => {
    const found = await store.getByRemediationId("nonexistent");
    assert.equal(found, null);
  });

  it("get: not found returns null", async () => {
    assert.equal(await store.get("missing"), null);
  });

  it("list: newest-first by createdAt", async () => {
    const all = await store.list();
    const times = all.map((p) => new Date(p.createdAt).getTime());
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i - 1]! >= times[i]!, "list sorted newest-first");
    }
  });

  it("empty store returns empty list", async () => {
    const emptyStore = new ExecutionPlanStore(join(tmpdir(), "empty-plan-dir"));
    assert.deepEqual(await emptyStore.list(), []);
  });
});
