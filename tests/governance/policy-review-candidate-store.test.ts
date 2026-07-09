/**
 * P25.3 — Policy Review Candidate Store tests.
 *
 * Tests file-based persistence, transition validation (state machine),
 * append-only event log, and idempotent openCandidate.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPolicyReviewCandidateStore } from "../../src/governance/policy-review-candidate-store.js";
import type { PolicyReviewCandidate } from "../../src/governance/policy-review-candidate-types.js";

const ISO = "2026-07-08T18:00:00.000Z";

function sampleCandidate(overrides: Partial<PolicyReviewCandidate> = {}): PolicyReviewCandidate {
  return {
    candidateId: "p25-test-id",
    source: {
      phase: "P24",
      signalId: "p24-cs:abc123",
      signalKind: "calibration_skew",
      signalSeverity: "medium",
      signalDirection: "too_loose",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    },
    title: "Policy Review: calibration skew",
    summary: "Calibration skew detected.",
    status: "proposed",
    createdAt: ISO,
    updatedAt: ISO,
    evidenceRefs: [],
    review: { notes: [], decisionBasis: [] },
    boundaries: {
      readOnlyEvidence: true,
      noPolicyMutation: true,
      noThresholdChange: true,
      noAutoAdoption: true,
      noRanking: true,
      requiresHumanReview: true,
    },
    ...overrides,
  };
}

describe("PolicyReviewCandidateStore", () => {
  let rootDir: string;
  let store: ReturnType<typeof createPolicyReviewCandidateStore>;

  before(() => {
    rootDir = mkdtempSync(join(tmpdir(), "p25-store-"));
    store = createPolicyReviewCandidateStore({ rootDir });
  });

  after(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  it("openCandidate persists candidate and writes candidate_opened event", async () => {
    const c = sampleCandidate();
    const saved = await store.openCandidate({ candidate: c });
    assert.equal(saved.candidateId, c.candidateId);
    assert.equal(saved.status, "proposed");

    const { candidate, events } = await store.showCandidate(c.candidateId);
    assert.ok(candidate);
    assert.ok(events.some(e => e.type === "candidate_opened"));
  });

  it("openCandidate is idempotent (no duplicate events)", async () => {
    const c = sampleCandidate({ candidateId: "p25-idempotent" });
    await store.openCandidate({ candidate: c });
    await store.openCandidate({ candidate: c }); // second open

    const { events } = await store.showCandidate(c.candidateId);
    const openEvents = events.filter(e => e.type === "candidate_opened");
    assert.equal(openEvents.length, 1); // not 2
  });

  it("transitionCandidate validates legal transition", async () => {
    const c = sampleCandidate({ candidateId: "p25-legal-trans" });
    await store.openCandidate({ candidate: c });
    const updated = await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "under_review",
      rationale: "Starting review",
    });
    assert.equal(updated.status, "under_review");
  });

  it("transitionCandidate rejects illegal transition (proposed→closed)", async () => {
    const c = sampleCandidate({ candidateId: "p25-illegal" });
    await store.openCandidate({ candidate: c });
    await assert.rejects(
      () => store.transitionCandidate({
        candidateId: c.candidateId,
        nextStatus: "closed",
        rationale: "Trying shortcut",
      }),
      /Invalid transition/,
    );
  });

  it("transitionCandidate rejects dismissed→under_review", async () => {
    const c = sampleCandidate({ candidateId: "p25-dismissed-reopen" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "dismissed",
      rationale: "Dismissing",
    });
    await assert.rejects(
      () => store.transitionCandidate({
        candidateId: c.candidateId,
        nextStatus: "under_review",
        rationale: "Try to reopen",
      }),
      /Invalid transition/,
    );
  });

  it("transitionCandidate rejects closed→anything", async () => {
    const c = sampleCandidate({ candidateId: "p25-closed-terminal" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "dismissed",
      rationale: "Dismiss",
    });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "closed",
      rationale: "Close",
    });
    await assert.rejects(
      () => store.transitionCandidate({
        candidateId: c.candidateId,
        nextStatus: "under_review",
        rationale: "Try to reopen",
      }),
      /Invalid transition/,
    );
  });

  it("transitionCandidate appends status_changed event (append-only)", async () => {
    const c = sampleCandidate({ candidateId: "p25-append-only" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "under_review",
      rationale: "Start",
    });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "needs_info",
      rationale: "Need more info",
    });

    const { events } = await store.showCandidate(c.candidateId);
    const statusEvents = events.filter(e => e.type === "status_changed");
    assert.equal(statusEvents.length, 2); // both transitions preserved
  });

  it("addNote appends note_added event", async () => {
    const c = sampleCandidate({ candidateId: "p25-note-test" });
    await store.openCandidate({ candidate: c });
    await store.addNote({ candidateId: c.candidateId, note: "This looks concerning" });
    await store.addNote({ candidateId: c.candidateId, note: "Needs more evidence" });

    const { candidate, events } = await store.showCandidate(c.candidateId);
    assert.ok(candidate);
    assert.ok(candidate.review.notes.includes("This looks concerning"));
    assert.equal(events.filter(e => e.type === "note_added").length, 2);
  });

  it("listCandidates filters by status", async () => {
    const c1 = sampleCandidate({ candidateId: "p25-list-proposed", status: "proposed" });
    const c2 = sampleCandidate({ candidateId: "p25-list-dismissed", title: "Dismissed: calibration skew" });
    await store.openCandidate({ candidate: c1 });
    await store.openCandidate({ candidate: c2 });
    await store.transitionCandidate({ candidateId: "p25-list-dismissed", nextStatus: "dismissed", rationale: "Test" });

    const proposed = await store.listCandidates({ status: "proposed" });
    assert.ok(proposed.some(c => c.candidateId === "p25-list-proposed"));
    assert.equal(proposed.some(c => c.candidateId === "p25-list-dismissed"), false);
  });

  it("showCandidate returns candidate with full event log", async () => {
    const c = sampleCandidate({ candidateId: "p25-show-test" });
    await store.openCandidate({ candidate: c });
    await store.transitionCandidate({
      candidateId: c.candidateId,
      nextStatus: "under_review",
      rationale: "Starting review",
    });

    const { candidate, events } = await store.showCandidate(c.candidateId);
    assert.ok(candidate);
    assert.ok(candidate.candidateId);
    assert.ok(events.length >= 2); // opened + status_changed
  });
});
