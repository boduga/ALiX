/**
 * Tests A2.4 — Verification Evidence Construction.
 *
 * @module verification-evidence
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createVerificationEvidence,
  computeEvidenceIntegrityHash,
  isEvidenceExpired,
  markReverificationRequired,
} from "../../../src/evolution/verification/index.js";
import type { VerificationEvidence, ConfidenceProfile } from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROFILE: ConfidenceProfile = {
  replayFidelity: 0.95,
  coverage: 0.90,
  determinism: 1.0,
  historicalSimilarity: 0.90,
  overallConfidence: 0.855,
};

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    verificationId: "ver-run-001",
    proposalId: "prop-001",
    replayDatasetId: "ds-001",
    proposalSnapshotHash: "hash-prop-001",
    environmentHash: "hash-env-001",
    baselineMetrics: { success_rate: 0.94 },
    candidateMetrics: { success_rate: 0.96 },
    metricDeltas: { success_rate: 0.02 },
    behavioralChanges: ["success_rate improved"],
    confidenceProfile: PROFILE,
    reproducibilityLevel: 2 as const,
    lineage: [],
    verifiedAt: "2026-07-12T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeEvidenceIntegrityHash
// ---------------------------------------------------------------------------

describe("computeEvidenceIntegrityHash", () => {
  it("produces deterministic hash for identical content", () => {
    const ev1 = createVerificationEvidence(makeInput());
    const ev2 = createVerificationEvidence(makeInput());
    // Strip IDs that differ (randomUUID) before comparing — hash is over content
    const content1 = { ...ev1, evidenceId: "x" };
    const content2 = { ...ev2, evidenceId: "x" };
    assert.strictEqual(
      computeEvidenceIntegrityHash(content1),
      computeEvidenceIntegrityHash(content2),
    );
  });

  it("produces different hash when content differs", () => {
    const ev1 = createVerificationEvidence(makeInput({ baselineMetrics: { a: 1 } }));
    const ev2 = createVerificationEvidence(makeInput({ baselineMetrics: { a: 2 } }));
    const content1 = { ...ev1, evidenceId: "x" };
    const content2 = { ...ev2, evidenceId: "x" };
    assert.notStrictEqual(
      computeEvidenceIntegrityHash(content1),
      computeEvidenceIntegrityHash(content2),
    );
  });

  it("ignores integrityHash field in computation", () => {
    const ev = createVerificationEvidence(makeInput());
    const withHashA = { ...ev, integrityHash: "aaa" };
    const withHashB = { ...ev, integrityHash: "bbb" };
    assert.strictEqual(
      computeEvidenceIntegrityHash(withHashA),
      computeEvidenceIntegrityHash(withHashB),
    );
  });

  it("produces a 64-character hex digest", () => {
    const ev = createVerificationEvidence(makeInput());
    const hash = computeEvidenceIntegrityHash(ev);
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// createVerificationEvidence
// ---------------------------------------------------------------------------

describe("createVerificationEvidence", () => {
  it("constructs evidence with all fields populated", () => {
    const evidence = createVerificationEvidence(makeInput());

    assert.ok(evidence.evidenceId.startsWith("ev-ver-"));
    assert.strictEqual(evidence.verificationId, "ver-run-001");
    assert.strictEqual(evidence.proposalId, "prop-001");
    assert.strictEqual(evidence.evidenceClass, "projected");
    assert.strictEqual(evidence.reproducibilityLevel, 2);
    assert.strictEqual(evidence.reverificationRequired, false);
    assert.ok(evidence.integrityHash);
  });

  it("computes expiry from verifiedAt + 90 days when not provided", () => {
    const evidence = createVerificationEvidence(makeInput({ expiresAt: undefined }));
    const verified = new Date("2026-07-12T10:00:00.000Z").getTime();
    const expiry = new Date(evidence.expiresAt).getTime();
    const expectedDays = (expiry - verified) / (24 * 60 * 60 * 1000);
    assert.strictEqual(expectedDays, 90);
  });

  it("uses provided expiresAt when given", () => {
    const evidence = createVerificationEvidence(makeInput({ expiresAt: "2026-08-12T10:00:00.000Z" }));
    assert.strictEqual(evidence.expiresAt, "2026-08-12T10:00:00.000Z");
  });

  it("computes integrity hash that matches recomputation", () => {
    const evidence = createVerificationEvidence(makeInput());
    const recomputed = computeEvidenceIntegrityHash(evidence);
    assert.strictEqual(evidence.integrityHash, recomputed);
  });
});

// ---------------------------------------------------------------------------
// isEvidenceExpired
// ---------------------------------------------------------------------------

describe("isEvidenceExpired", () => {
  it("returns false when current time is before expiry", () => {
    const evidence = { expiresAt: "2026-12-31T00:00:00.000Z" };
    const now = new Date("2026-07-12T00:00:00.000Z").getTime();
    assert.equal(isEvidenceExpired(evidence, now), false);
  });

  it("returns true when current time is at expiry", () => {
    const evidence = { expiresAt: "2026-07-12T00:00:00.000Z" };
    const now = new Date("2026-07-12T00:00:00.000Z").getTime();
    assert.equal(isEvidenceExpired(evidence, now), true);
  });

  it("returns true when current time is after expiry", () => {
    const evidence = { expiresAt: "2026-01-01T00:00:00.000Z" };
    const now = new Date("2026-07-12T00:00:00.000Z").getTime();
    assert.equal(isEvidenceExpired(evidence, now), true);
  });

  it("fail-closed: returns true for unparseable expiry", () => {
    const evidence = { expiresAt: "not-a-date" };
    assert.equal(isEvidenceExpired(evidence), true);
  });
});

// ---------------------------------------------------------------------------
// markReverificationRequired
// ---------------------------------------------------------------------------

describe("markReverificationRequired", () => {
  it("sets reverificationRequired to true", () => {
    const evidence = createVerificationEvidence(makeInput());
    assert.equal(evidence.reverificationRequired, false);
    const marked = markReverificationRequired(evidence);
    assert.equal(marked.reverificationRequired, true);
  });

  it("does not mutate the original evidence", () => {
    const evidence = createVerificationEvidence(makeInput());
    markReverificationRequired(evidence);
    assert.equal(evidence.reverificationRequired, false);
  });
});
