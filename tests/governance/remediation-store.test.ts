import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RemediationStore } from "../../src/governance/remediation-store.js";
import type { GovernanceRemediationProposal } from "../../src/governance/remediation-queue.js";

const NOW = "2026-07-07T14:00:00.000Z";

function makeProposal(overrides: Partial<GovernanceRemediationProposal> = {}): GovernanceRemediationProposal {
  return {
    proposalId: "proposal-001",
    sourceRecommendationIds: ["rec-1"],
    title: "Remediation: update_config (1 items)",
    severity: "critical",
    windowStart: "2026-07-07T00:00:00.000Z",
    windowEnd: "2026-07-08T00:00:00.000Z",
    evidenceRefs: [],
    status: "open",
    createdAt: NOW,
    responseKind: "investigate_anomaly",
    proposedAction: "call mutate()",
    reversible: true,
    ...overrides,
  };
}

describe("RemediationStore", () => {
  let tmpDir: string;
  let store: RemediationStore;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "remediation-store-test-"));
    store = new RemediationStore(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("save and get: round-trips a proposal", async () => {
    const proposal = makeProposal();
    await store.append(proposal);
    const found = await store.get("proposal-001");
    assert.ok(found);
    assert.equal(found!.status, "open");
  });

  it("list: newest-first by createdAt", async () => {
    const p1 = makeProposal({ proposalId: "p-1", createdAt: "2026-07-07T10:00:00.000Z" });
    const p2 = makeProposal({ proposalId: "p-2", createdAt: "2026-07-07T11:00:00.000Z" });
    await store.append(p1);
    await store.append(p2);
    const all = await store.list();
    const idx1 = all.findIndex((p) => p.proposalId === "p-1");
    const idx2 = all.findIndex((p) => p.proposalId === "p-2");
    assert.ok(idx2 < idx1, "newest proposal should appear first");
  });

  it("get: not found returns null", async () => {
    const found = await store.get("nonexistent");
    assert.equal(found, null);
  });

  it("updateStatus: appends a new version (last-wins) without rewriting", async () => {
    const proposal = makeProposal({ proposalId: "updatable" });
    await store.append(proposal);
    const updated = await store.updateStatus("updatable", "accepted");
    assert.ok(updated);
    assert.equal(updated!.status, "accepted");

    const reread = await store.get("updatable");
    assert.equal(reread!.status, "accepted");
    assert.equal((await store.list()).filter((p) => p.proposalId === "updatable").length, 1, "reads resolve latest version per id");
  });

  it("updateStatus: nonexistent proposal is a silent no-op", async () => {
    const updated = await store.updateStatus("missing", "accepted");
    assert.equal(updated, null);
  });

  it("empty store returns empty list", async () => {
    const emptyStore = new RemediationStore(join(tmpdir(), "empty-remediation-dir"));
    assert.deepEqual(await emptyStore.list(), []);
  });
});
