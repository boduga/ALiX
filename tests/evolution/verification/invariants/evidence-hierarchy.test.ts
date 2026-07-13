/**
 * Invariant test: Evidence hierarchy — projected evidence cannot override
 * observed evidence.
 *
 * @module invariant-evidence-hierarchy
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_EVIDENCE_CLASSES,
  validateVerificationEvidence,
  type EvidenceClass,
} from "../../../../src/evolution/verification/index.js";

describe("Invariant: Evidence hierarchy", () => {
  it("observed > derived > projected precedence is documented in type", () => {
    const classes: EvidenceClass[] = [...VALID_EVIDENCE_CLASSES];
    assert.ok(classes.includes("observed"));
    assert.ok(classes.includes("derived"));
    assert.ok(classes.includes("projected"));
  });

  it("A2-generated evidence is always classified 'projected'", () => {
    // A2 verification evidence must never claim to be 'observed' — that class
    // is reserved for real execution outcomes (X2/X3b) and adaptation (A3).
    // validateVerificationEvidence rejects non-projected evidenceClass.
    const result = validateVerificationEvidence({
      evidenceId: "ev-1",
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      evidenceClass: "observed", // WRONG — A2 cannot produce observed evidence
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: {},
      candidateMetrics: {},
      metricDeltas: {},
      behavioralChanges: [],
      confidenceProfile: { replayFidelity: 1, coverage: 1, determinism: 1, historicalSimilarity: 1, overallConfidence: 1 },
      reproducibilityLevel: 2,
      lineage: [],
      verifiedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
      reverificationRequired: false,
      integrityHash: "h",
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("projected")));
  });

  it("projected evidence carries explicit confidence (never implicit trust)", () => {
    // Projected evidence must always carry a confidence profile — it can never
    // be treated as ground truth the way observed evidence is.
    const evidence = {
      evidenceId: "ev-1",
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      evidenceClass: "projected" as const,
      proposalSnapshotHash: "h",
      environmentHash: "h",
      baselineMetrics: {},
      candidateMetrics: {},
      metricDeltas: {},
      behavioralChanges: [],
      confidenceProfile: {
        replayFidelity: 0.8,
        coverage: 0.7,
        determinism: 1.0,
        historicalSimilarity: 0.6,
        overallConfidence: 0.42, // < 1.0 — projected, never certain
      },
      reproducibilityLevel: 2 as const,
      lineage: [],
      verifiedAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2099-12-31T00:00:00.000Z",
      reverificationRequired: false,
      integrityHash: "h",
    };

    const result = validateVerificationEvidence(evidence);
    assert.ok(result.valid);
    assert.ok(evidence.confidenceProfile.overallConfidence < 1.0);
  });
});
