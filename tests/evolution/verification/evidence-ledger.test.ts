/**
 * Tests A2.4 — Evidence Ledger.
 *
 * @module evidence-ledger
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryVerificationEvidenceLedger,
  EvidenceNotFoundError,
  ExpiredEvidenceError,
  IntegrityMismatchError,
  createVerificationEvidence,
} from "../../../src/evolution/verification/index.js";
import type { ConfidenceProfile } from "../../../src/evolution/verification/index.js";

const PROFILE: ConfidenceProfile = {
  replayFidelity: 0.95,
  coverage: 0.90,
  determinism: 1.0,
  historicalSimilarity: 0.90,
  overallConfidence: 0.855,
};

function makeEvidence(overrides: Record<string, unknown> = {}) {
  return createVerificationEvidence({
    verificationId: "ver-run-001",
    proposalId: "prop-001",
    replayDatasetId: "ds-001",
    proposalSnapshotHash: "hash-prop",
    environmentHash: "hash-env",
    baselineMetrics: { m: 1 },
    candidateMetrics: { m: 2 },
    metricDeltas: { m: 1 },
    behavioralChanges: [],
    confidenceProfile: PROFILE,
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: "2026-07-12T10:00:00.000Z",
    expiresAt: "2099-12-31T00:00:00.000Z", // far future
    ...overrides,
  });
}

describe("InMemoryVerificationEvidenceLedger", () => {
  it("stores and retrieves evidence by ID", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const evidence = makeEvidence();
    await ledger.store(evidence);

    const retrieved = await ledger.get(evidence.evidenceId);
    assert.strictEqual(retrieved.evidenceId, evidence.evidenceId);
    assert.strictEqual(retrieved.proposalId, "prop-001");
  });

  it("throws EvidenceNotFoundError for unknown ID", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    await assert.rejects(() => ledger.get("nonexistent"), EvidenceNotFoundError);
  });

  it("rejects expired evidence on read (fail-closed)", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const expired = makeEvidence({ expiresAt: "2020-01-01T00:00:00.000Z" });
    await ledger.store(expired);

    await assert.rejects(() => ledger.get(expired.evidenceId), ExpiredEvidenceError);
  });

  it("rejects corrupted evidence on read (integrity mismatch)", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const evidence = makeEvidence();
    // Tamper with stored data
    const tampered = { ...evidence, baselineMetrics: { m: 999 } };
    await ledger.store(tampered);

    await assert.rejects(() => ledger.get(tampered.evidenceId), IntegrityMismatchError);
  });

  it("lists evidence by proposal, excluding expired", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    await ledger.store(makeEvidence());
    await ledger.store(makeEvidence({ expiresAt: "2020-01-01T00:00:00.000Z" }));
    await ledger.store(makeEvidence({ proposalId: "prop-002" }));

    const results = await ledger.listByProposal("prop-001");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].proposalId, "prop-001");
  });

  it("listByProposal includes expired when option set", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    await ledger.store(makeEvidence());
    await ledger.store(makeEvidence({ expiresAt: "2020-01-01T00:00:00.000Z" }));

    const results = await ledger.listByProposal("prop-001", { includeExpired: true });
    assert.strictEqual(results.length, 2);
  });

  it("counts expired evidence", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    await ledger.store(makeEvidence());
    await ledger.store(makeEvidence({ expiresAt: "2020-01-01T00:00:00.000Z" }));
    await ledger.store(makeEvidence({ expiresAt: "2020-01-01T00:00:00.000Z" }));

    const count = await ledger.countExpired();
    assert.strictEqual(count, 2);
  });

  it("lists expired evidence IDs", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const expired = makeEvidence({ expiresAt: "2020-01-01T00:00:00.000Z" });
    await ledger.store(expired);

    const ids = await ledger.listExpired();
    assert.strictEqual(ids.length, 1);
    assert.strictEqual(ids[0], expired.evidenceId);
  });
});
