/**
 * Invariant test: Expiration — expired evidence is rejected by the bridge.
 *
 * @module invariant-expiration
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryVerificationEvidenceLedger,
  ExpiredEvidenceError,
  createVerificationEvidence,
  isEvidenceExpired,
} from "../../../../src/evolution/verification/index.js";

const PROFILE = { replayFidelity: 0.9, coverage: 0.9, determinism: 1.0, historicalSimilarity: 0.9, overallConfidence: 0.81 };

describe("Invariant: Expiration enforcement", () => {
  it("the bridge rejects expired evidence on read", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const expired = createVerificationEvidence({
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: {},
      candidateMetrics: {},
      metricDeltas: {},
      behavioralChanges: [],
      confidenceProfile: PROFILE,
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-06-01T00:00:00.000Z", // long expired
    });

    await ledger.store(expired);

    // Read MUST fail — expired evidence cannot participate in governance
    await assert.rejects(() => ledger.get(expired.evidenceId), ExpiredEvidenceError);
  });

  it("isEvidenceExpired returns true at and after expiry", () => {
    const atExpiry = isEvidenceExpired(
      { expiresAt: "2026-07-12T00:00:00.000Z" },
      new Date("2026-07-12T00:00:00.000Z").getTime(),
    );
    const afterExpiry = isEvidenceExpired(
      { expiresAt: "2026-07-12T00:00:00.000Z" },
      new Date("2026-07-13T00:00:00.000Z").getTime(),
    );
    assert.equal(atExpiry, true);
    assert.equal(afterExpiry, true);
  });

  it("expired evidence remains in ledger for audit (listExpired)", async () => {
    const ledger = new InMemoryVerificationEvidenceLedger();
    const expired = createVerificationEvidence({
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: {},
      candidateMetrics: {},
      metricDeltas: {},
      behavioralChanges: [],
      confidenceProfile: PROFILE,
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-06-01T00:00:00.000Z",
    });

    await ledger.store(expired);

    // Active governance read rejected...
    await assert.rejects(() => ledger.get(expired.evidenceId), ExpiredEvidenceError);

    // ...but audit read (listExpired) still finds it
    const expiredIds = await ledger.listExpired();
    assert.ok(expiredIds.includes(expired.evidenceId));
  });

  it("unparseable expiry is treated as expired (fail-closed)", () => {
    assert.equal(isEvidenceExpired({ expiresAt: "garbage" }), true);
  });
});
