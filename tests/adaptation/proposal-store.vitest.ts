import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

describe("ProposalStore", () => {
  let dir: string;
  let store: ProposalStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prop-"));
    store = new ProposalStore(dir);
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("saves and loads a proposal", async () => {
    const proposal: AdaptationProposal = {
      id: "prop-1", createdAt: "2026-06-19T00:00:00Z", status: "pending",
      action: "create_agent_card", target: { kind: "agent_card", id: "x" },
      payload: {}, sourceRecommendationType: "capability_gap",
      sourceConfidence: 0.9, evidenceFingerprints: [], reason: "test",
    };
    await store.save(proposal);
    const loaded = await store.load("prop-1");
    expect(loaded).toEqual(proposal);
  });

  it("lists proposals by status", async () => {
    for (const id of ["a", "b", "c"]) {
      await store.save({
        id, createdAt: "2026-06-19T00:00:00Z", status: id === "a" ? "approved" : "pending",
        action: "create_agent_card", target: { kind: "agent_card", id },
        payload: {}, sourceRecommendationType: "capability_gap",
        sourceConfidence: 0.9, evidenceFingerprints: [], reason: "x",
      });
    }
    const pending = await store.list("pending");
    expect(pending.length).toBe(2);
  });

  // Effect Schema catches invalid ProposalStatus (manual check also catches this)
  it("rejects proposal with invalid status", async () => {
    await expect(
      store.save({
        id: "bad-status", createdAt: "2026-06-19T00:00:00Z", status: "invalid",
        action: "create_agent_card",
        target: { kind: "agent_card", id: "x" },
        payload: {}, sourceRecommendationType: "test",
        sourceConfidence: 0.5, evidenceFingerprints: [], reason: "test",
      } as any),
    ).rejects.toThrow(/Proposal (validation|schema) failed/);
  });

  // Effect Schema catches invalid ProposalAction (manual check misses this —
  // it only verifies non-empty string)
  it("rejects proposal with invalid action literal", async () => {
    await expect(
      store.save({
        id: "bad-action", createdAt: "2026-06-19T00:00:00Z", status: "pending",
        action: "nonexistent_action", // not one of the valid ProposalAction values
        target: { kind: "agent_card", id: "x" },
        payload: {}, sourceRecommendationType: "test",
        sourceConfidence: 0.5, evidenceFingerprints: [], reason: "test",
      } as any),
    ).rejects.toThrow(/Proposal schema validation failed/);
  });

  // Effect Schema catches invalid ProposalTarget.kind
  it("rejects proposal with invalid target kind", async () => {
    await expect(
      store.save({
        id: "bad-target-kind", createdAt: "2026-06-19T00:00:00Z", status: "pending",
        action: "create_agent_card",
        target: { kind: "unknown_target_type", id: "x" },
        payload: {}, sourceRecommendationType: "test",
        sourceConfidence: 0.5, evidenceFingerprints: [], reason: "test",
      } as any),
    ).rejects.toThrow(/Proposal schema validation failed/);
  });

  // Effect Schema catches malformed nested target shape
  it("rejects proposal with malformed executive_remediation target", async () => {
    await expect(
      store.save({
        id: "bad-target-shape", createdAt: "2026-06-19T00:00:00Z", status: "pending",
        action: "executive_remediation_request",
        target: { kind: "executive_remediation", planId: "p" }, // missing stepId, objectiveId, subsystem
        payload: {}, sourceRecommendationType: "test",
        sourceConfidence: 0.5, evidenceFingerprints: [], reason: "test",
      } as any),
    ).rejects.toThrow(/Proposal schema validation failed/);
  });

  // Invalid stored proposal is skipped during list
  it("skips corrupt proposal file during list", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    // Write a valid proposal
    await store.save({
      id: "valid", createdAt: "2026-06-19T00:00:00Z", status: "pending",
      action: "create_agent_card", target: { kind: "agent_card", id: "x" },
      payload: {}, sourceRecommendationType: "test",
      sourceConfidence: 0.5, evidenceFingerprints: [], reason: "valid",
    });
    // Write an invalid proposal directly
    writeFileSync(join(dir, "invalid-proposal.json"), JSON.stringify({
      id: "invalid", status: "invalid_status",
    }), "utf-8");

    const all = await store.list();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe("valid");
  });

  it("markOrphaned excludes the proposal from list()", async () => {
    const proposal = {
      id: "prop-orphan-test",
      createdAt: "2026-06-23T00:00:00Z",
      status: "pending" as const,
      action: "create_agent_card" as const,
      target: { kind: "agent_card" as const, id: "test-agent" },
      payload: {},
      sourceRecommendationType: "capability_gap",
      sourceConfidence: 0.9,
      evidenceFingerprints: [],
      reason: "test orphan",
    };
    await store.save(proposal);
    await store.markOrphaned(proposal.id, "test reason");
    const all = await store.list();
    expect(all.find((p) => p.id === proposal.id)).toBeUndefined();
  });
});
