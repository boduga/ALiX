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
});
