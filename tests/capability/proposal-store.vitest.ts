// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * CAP-9 Task 4 — ProposalStore (append-only governance ledger wrapper).
 *
 * Asserts that ProposalStore:
 *   - computes deterministic proposal ids (delegated to proposal-identity)
 *   - rejects duplicates (ruling #21) by scanning the ledger
 *   - persists the five canonical governance events under the locked
 *     `capability.governance.proposal.*` prefix (ruling #1, ruling #2)
 *   - reconstructs ledger-shape `CapabilityGovernanceEvent` objects from
 *     `eventLog.readAll()` with long-form discriminants (Task 1 ruling)
 *   - `findById()` returns events ordered by `seq` and filtered by
 *     `proposalId` (lives in payload, not top-level)
 *   - `existsSubmitted()` returns true iff a matching `proposal.submitted`
 *     event exists for the proposal id (duplicate-detection helper)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../../src/events/event-log.js";
import { ProposalStore } from "../../src/capability/governance/proposal-store.js";
import { CapabilityProposalDuplicateError } from "../../src/capability/errors/proposal-duplicate.js";
import type { CapabilityEvolutionCandidate } from "../../src/adaptation/capability-evolution-types.js";
import type { CapabilityMutationResult } from "../../src/capability/governance/governance-types.js";

function mkCandidate(): CapabilityEvolutionCandidate {
  return {
    candidateId: "c-1",
    sourcePatternId: "p-1",
    confidence: 0.8,
    target: { kind: "capability", id: "tool.x" },
    description: "d",
    expectedEffect: "e",
    riskClass: "low",
    evidenceIds: [],
  };
}

describe("ProposalStore — append-only governance ledger (CAP-9)", () => {
  let dir: string;
  let eventLog: EventLog;
  let store: ProposalStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cap9-store-"));
    eventLog = new EventLog(dir);
    await eventLog.init();
    store = new ProposalStore({ eventLog });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("submit() persists proposal.submitted and returns stable id", async () => {
    const { proposalId, event } = await store.submit(mkCandidate(), ["sig-1"]);
    expect(proposalId).toMatch(/^[0-9a-f]{64}$/);
    expect(event.type).toBe("capability.governance.proposal.submitted");
    expect(event.proposalId).toBe(proposalId);
  });

  it("submit() rejects duplicate proposal id (ruling #21)", async () => {
    await store.submit(mkCandidate(), []);
    await expect(store.submit(mkCandidate(), [])).rejects.toBeInstanceOf(
      CapabilityProposalDuplicateError,
    );
  });

  it("recordApproved() persists proposal.approved with approvedBy", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const evt = await store.recordApproved(proposalId, "human:alice");
    expect(evt.type).toBe("capability.governance.proposal.approved");
    expect(evt.proposalId).toBe(proposalId);
    if (evt.type === "capability.governance.proposal.approved") {
      expect(evt.payload.approvedBy).toBe("human:alice");
      expect(typeof evt.payload.approvedAt).toBe("string");
    }
  });

  it("recordRejected() persists proposal.rejected with reason", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const evt = await store.recordRejected(proposalId, "human:bob", "too risky");
    expect(evt.type).toBe("capability.governance.proposal.rejected");
    expect(evt.proposalId).toBe(proposalId);
    if (evt.type === "capability.governance.proposal.rejected") {
      expect(evt.payload.rejectedBy).toBe("human:bob");
      expect(evt.payload.reason).toBe("too risky");
    }
  });

  it("recordExecuted() persists proposal.executed with mutation result", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const fakeMutation: CapabilityMutationResult = {
      success: true,
      mutation: { operation: "capability.create" },
      artifactId: "artifact-abc",
    };
    const evt = await store.recordExecuted(proposalId, fakeMutation, fakeMutation.artifactId);
    expect(evt.type).toBe("capability.governance.proposal.executed");
    expect(evt.proposalId).toBe(proposalId);
    if (evt.type === "capability.governance.proposal.executed") {
      expect(evt.payload.mutation.artifactId).toBe("artifact-abc");
      expect(evt.payload.artifactId).toBe("artifact-abc");
    }
  });

  it("recordExecutionFailed() persists proposal.execution_failed with error", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    const evt = await store.recordExecutionFailed(proposalId, "boom", "rolled_back");
    expect(evt.type).toBe("capability.governance.proposal.execution_failed");
    expect(evt.proposalId).toBe(proposalId);
    if (evt.type === "capability.governance.proposal.execution_failed") {
      expect(evt.payload.error).toBe("boom");
      expect(evt.payload.partialState).toBe("rolled_back");
    }
  });

  it("persisted events share the locked capability.governance.proposal. prefix (ruling #1)", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    await store.recordApproved(proposalId, "human:alice");
    await store.recordExecuted(
      proposalId,
      {
        success: true,
        mutation: { operation: "capability.create" },
        artifactId: "artifact-abc",
      },
      "artifact-abc",
    );

    const all = await eventLog.readAll();
    const types = all.map((e) => e.type);
    expect(types).toEqual([
      "capability.governance.proposal.submitted",
      "capability.governance.proposal.approved",
      "capability.governance.proposal.executed",
    ]);
  });

  it("findById() returns all events for a proposal, ordered by seq", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    await store.recordApproved(proposalId, "human:alice");
    await store.recordExecuted(
      proposalId,
      {
        success: true,
        mutation: { operation: "capability.create" },
        artifactId: "artifact-abc",
      },
      "artifact-abc",
    );

    // Insert unrelated governance event for another proposal id — must be filtered out.
    await store.submit(
      { ...mkCandidate(), candidateId: "c-2" },
      [],
    );

    const events = await store.findById(proposalId);
    expect(events.map((e) => e.type)).toEqual([
      "capability.governance.proposal.submitted",
      "capability.governance.proposal.approved",
      "capability.governance.proposal.executed",
    ]);
    for (const e of events) {
      expect(e.proposalId).toBe(proposalId);
    }
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.seq).toBeGreaterThan(events[i - 1]!.seq);
    }
  });

  it("existsSubmitted() returns true after submit, false before", async () => {
    const { proposalId } = await store.submit(mkCandidate(), []);
    expect(await store.existsSubmitted(proposalId)).toBe(true);
  });

  it("existsSubmitted() returns false for an id that was never submitted", async () => {
    expect(await store.existsSubmitted("a".repeat(64))).toBe(false);
  });
});
