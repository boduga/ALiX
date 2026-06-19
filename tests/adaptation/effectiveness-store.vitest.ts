import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EffectivenessStore } from "../../src/adaptation/effectiveness-store.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";

function sampleReport(id: string): ProposalEffectivenessReport {
  return {
    proposalId: id,
    assessedAt: "2026-06-19T00:00:00.000Z",
    appliedAt: "2026-06-12T00:00:00.000Z",
    windowDays: 7,
    metricsBefore: { workflowsCompleted: 0, workflowsBlocked: 0, workflowsAborted: 0, capabilitiesRequested: 0, unresolvedCapabilities: 5, reviewApprovalRate: 1 },
    metricsAfter: { workflowsCompleted: 0, workflowsBlocked: 0, workflowsAborted: 0, capabilitiesRequested: 0, unresolvedCapabilities: 2, reviewApprovalRate: 1 },
    primary: { metric: "unresolvedCapabilities", direction: "lower_is_better", before: 5, after: 2, absoluteDelta: -3, relativeDelta: -0.6 },
    dataSufficient: true,
    recommendation: "keep",
    reason: "improved",
  };
}

describe("EffectivenessStore", () => {
  let dir: string;
  let store: EffectivenessStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "eff-"));
    store = new EffectivenessStore(dir);
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("saves and loads a report by proposalId", async () => {
    const r = sampleReport("prop-1");
    await store.save(r);
    expect(await store.load("prop-1")).toEqual(r);
  });

  it("returns null when loading a missing report", async () => {
    expect(await store.load("nope")).toBeNull();
  });

  it("lists all saved reports", async () => {
    await store.save(sampleReport("a"));
    await store.save(sampleReport("b"));
    const list = await store.list();
    expect(list.length).toBe(2);
    expect(list.map((r) => r.proposalId).sort()).toEqual(["a", "b"]);
  });
});