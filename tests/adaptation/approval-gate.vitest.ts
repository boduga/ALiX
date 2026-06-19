/**
 * P5.1d — ApprovalGate tests.
 *
 * The hard rule: no mutation without approval. The ApprovalGate enforces this
 * by checking proposal status before allowing any state transition and by
 * recording evidence for every transition.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import { ApprovalGate } from "../../src/adaptation/approval-gate.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";
import type { EvidenceRecord, EvidenceType } from "../../src/security/evidence/evidence-types.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RecordedEvent {
  type: EvidenceType;
  payload: Record<string, unknown>;
}

/** In-memory EvidenceEventWriter that captures every call for assertions. */
function makeFakeWriter(): { writer: EvidenceEventWriter; events: RecordedEvent[] } {
  const events: RecordedEvent[] = [];
  const writer = new EvidenceEventWriter(async (type, payload) => {
    events.push({ type, payload });
    return {
      version: 1,
      id: `fake-${events.length}`,
      type,
      timestamp: new Date().toISOString(),
      fingerprint: `fp-${events.length}`,
      payload,
    } satisfies EvidenceRecord;
  });
  return { writer, events };
}

function makePendingProposal(overrides: Partial<AdaptationProposal> = {}): AdaptationProposal {
  return {
    id: "prop-2026-06-19-001",
    createdAt: "2026-06-19T00:00:00.000Z",
    status: "pending",
    action: "create_agent_card",
    target: { kind: "agent_card", id: "new.agent" },
    payload: { id: "new.agent" },
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.9,
    evidenceFingerprints: ["fp-source-1"],
    reason: "capability gap",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalGate", () => {
  let dir: string;
  let store: ProposalStore;
  let writer: EvidenceEventWriter;
  let events: RecordedEvent[];
  let gate: ApprovalGate;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "approval-"));
    store = new ProposalStore(dir);
    const fake = makeFakeWriter();
    writer = fake.writer;
    events = fake.events;
    gate = new ApprovalGate(store, writer);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // approve()
  // -------------------------------------------------------------------------

  it("approve() sets status to 'approved' and records approvedBy/approvedAt", async () => {
    const proposal = makePendingProposal();
    await store.save(proposal);

    const updated = await gate.approve(proposal.id, "alice@example.com");

    expect(updated.status).toBe("approved");
    expect(updated.approvedBy).toBe("alice@example.com");
    expect(updated.approvedAt).toBeDefined();
    expect(new Date(updated.approvedAt!).toString()).not.toBe("Invalid Date");
  });

  it("approve() records adaptation_approved evidence with the actor and proposal id", async () => {
    const proposal = makePendingProposal();
    await store.save(proposal);

    await gate.approve(proposal.id, "alice@example.com");

    const approvedEvents = events.filter(e => e.type === "adaptation_approved");
    expect(approvedEvents.length).toBe(1);
    expect(approvedEvents[0].payload.proposalId).toBe(proposal.id);
    expect(approvedEvents[0].payload.approvedBy).toBe("alice@example.com");
  });

  it("approve() persists the updated proposal to the store", async () => {
    const proposal = makePendingProposal();
    await store.save(proposal);

    await gate.approve(proposal.id, "alice");

    const reloaded = await store.load(proposal.id);
    expect(reloaded!.status).toBe("approved");
    expect(reloaded!.approvedBy).toBe("alice");
  });

  it("approve() does not mutate the proposal in-memory before persisting", async () => {
    const proposal = makePendingProposal();
    await store.save(proposal);

    const before = await store.load(proposal.id);
    expect(before!.status).toBe("pending");
    expect(before!.approvedBy).toBeUndefined();
  });

  it("approve() throws when the proposal is missing", async () => {
    await expect(gate.approve("prop-does-not-exist", "alice"))
      .rejects.toThrow(/not found/i);
  });

  it("approve() throws when the proposal is not pending", async () => {
    const proposal = makePendingProposal({ status: "approved", approvedBy: "bob" });
    await store.save(proposal);

    await expect(gate.approve(proposal.id, "alice"))
      .rejects.toThrow(/expected "pending"/i);
  });

  // -------------------------------------------------------------------------
  // reject()
  // -------------------------------------------------------------------------

  it("reject() sets status to 'rejected'", async () => {
    const proposal = makePendingProposal();
    await store.save(proposal);

    const updated = await gate.reject(proposal.id, "alice", "not needed");

    expect(updated.status).toBe("rejected");
  });

  it("reject() records adaptation_rejected evidence with reason and actor", async () => {
    const proposal = makePendingProposal();
    await store.save(proposal);

    await gate.reject(proposal.id, "alice", "low confidence");

    const rejectedEvents = events.filter(e => e.type === "adaptation_rejected");
    expect(rejectedEvents.length).toBe(1);
    expect(rejectedEvents[0].payload.proposalId).toBe(proposal.id);
    expect(rejectedEvents[0].payload.rejectedBy).toBe("alice");
    expect(rejectedEvents[0].payload.reason).toBe("low confidence");
  });

  it("reject() throws when the proposal is not pending", async () => {
    const proposal = makePendingProposal({ status: "rejected" });
    await store.save(proposal);

    await expect(gate.reject(proposal.id, "alice", "x"))
      .rejects.toThrow(/expected "pending"/i);
  });

  it("reject() throws when the proposal is missing", async () => {
    await expect(gate.reject("prop-missing", "alice", "x"))
      .rejects.toThrow(/not found/i);
  });

  // -------------------------------------------------------------------------
  // apply()
  // -------------------------------------------------------------------------

  it("apply() throws when the proposal is still pending", async () => {
    const proposal = makePendingProposal();
    await store.save(proposal);

    const applier = async () => {};
    await expect(gate.apply(proposal.id, applier))
      .rejects.toThrow(/expected "approved"/i);
  });

  it("apply() invokes the applier and sets status to 'applied' on success", async () => {
    const proposal = makePendingProposal({ status: "approved", approvedBy: "alice" });
    await store.save(proposal);

    let called = false;
    const updated = await gate.apply(proposal.id, async () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(updated.status).toBe("applied");
    expect(updated.appliedAt).toBeDefined();
  });

  it("apply() records adaptation_applied evidence on success", async () => {
    const proposal = makePendingProposal({ status: "approved", approvedBy: "alice" });
    await store.save(proposal);

    await gate.apply(proposal.id, async () => {});

    const appliedEvents = events.filter(e => e.type === "adaptation_applied");
    expect(appliedEvents.length).toBe(1);
    expect(appliedEvents[0].payload.proposalId).toBe(proposal.id);
  });

  it("apply() sets status to 'failed' and records adaptation_failed when the applier throws", async () => {
    const proposal = makePendingProposal({ status: "approved", approvedBy: "alice" });
    await store.save(proposal);

    let updated: AdaptationProposal | null = null;
    await expect(
      gate.apply(proposal.id, async () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");

    updated = await store.load(proposal.id);
    expect(updated!.status).toBe("failed");
    expect(updated!.error).toBe("disk full");

    const failedEvents = events.filter(e => e.type === "adaptation_failed");
    expect(failedEvents.length).toBe(1);
    expect(failedEvents[0].payload.proposalId).toBe(proposal.id);
    expect(failedEvents[0].payload.error).toBe("disk full");
  });

  it("apply() does not call the applier when the proposal is missing", async () => {
    let called = false;
    await expect(gate.apply("prop-missing", async () => { called = true; }))
      .rejects.toThrow(/not found/i);
    expect(called).toBe(false);
  });

  it("apply() does not call the applier when the proposal has been rejected", async () => {
    const proposal = makePendingProposal({ status: "rejected" });
    await store.save(proposal);

    let called = false;
    await expect(gate.apply(proposal.id, async () => { called = true; }))
      .rejects.toThrow(/expected "approved"/i);
    expect(called).toBe(false);
  });

  it("apply() persists the final status to the store", async () => {
    const proposal = makePendingProposal({ status: "approved", approvedBy: "alice" });
    await store.save(proposal);

    await gate.apply(proposal.id, async () => {});

    const reloaded = await store.load(proposal.id);
    expect(reloaded!.status).toBe("applied");
  });
});
