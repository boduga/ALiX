/**
 * Tests for P30.1 — Lineage Types (LineageRecord, phase refs, LineageIndex,
 * boundary flags).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type SignalRef,
  type CandidateRef,
  type OutcomeRef,
  type TraceRef,
  type ExplanationRef,
  type ComplianceRef,
  type LineageRecord,
  type LineageIndex,
} from "../../src/governance/governance-lineage-types.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceLineageTypes", () => {
  // -----------------------------------------------------------------------
  // Test 1: LineageRecord has all 6 phase refs with correct shapes
  // -----------------------------------------------------------------------

  it("LineageRecord has all 6 phase refs (SignalRef, CandidateRef, OutcomeRef, TraceRef, ExplanationRef, ComplianceRef)", () => {
    // Build a complete LineageRecord with all 6 refs populated
    const signalRef: SignalRef = {
      signalId: "sig-001",
      signalKind: "calibration_skew",
      windowEnd: "2026-07-01T00:00:00.000Z",
    };

    const candidateRef: CandidateRef = {
      candidateId: "cand-001",
      title: "Calibration drift detected",
      status: "under_review",
    };

    const outcomeRef: OutcomeRef = {
      outcomeId: "out-001",
      candidateId: "cand-001",
      outcomeType: "accepted_for_policy_work",
    };

    const traceRef: TraceRef = {
      outcomeId: "out-001",
      candidateId: "cand-001",
      signalKind: "calibration_skew",
    };

    const explanationRef: ExplanationRef = {
      explanationId: "expl-001",
      type: "correlation",
    };

    const complianceRef: ComplianceRef = {
      packageId: "pkg-001",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    };

    const record: LineageRecord = {
      lineageId: "lineage-001",
      assembledAt: "2026-07-10T00:00:00.000Z",
      phasePresence: {
        p24: true,
        p25: true,
        p26: true,
        p27: true,
        p28: true,
        p29: true,
      },
      signalRef,
      candidateRef,
      outcomeRef,
      traceRef,
      explanationRef,
      complianceRef,
      readOnly: true as const,
      noPolicyMutation: true as const,
      noThresholdChange: true as const,
      noAutoAdoption: true as const,
      noRanking: true as const,
    };

    // Verify the record compiles and has correct shape
    assert.equal(record.lineageId, "lineage-001");
    assert.equal(record.assembledAt, "2026-07-10T00:00:00.000Z");

    // SignalRef shape
    assert.equal(record.signalRef?.signalId, "sig-001");
    assert.equal(record.signalRef?.signalKind, "calibration_skew");
    assert.equal(record.signalRef?.windowEnd, "2026-07-01T00:00:00.000Z");

    // CandidateRef shape
    assert.equal(record.candidateRef?.candidateId, "cand-001");
    assert.equal(record.candidateRef?.title, "Calibration drift detected");
    assert.equal(record.candidateRef?.status, "under_review");

    // OutcomeRef shape
    assert.equal(record.outcomeRef?.outcomeId, "out-001");
    assert.equal(record.outcomeRef?.candidateId, "cand-001");
    assert.equal(record.outcomeRef?.outcomeType, "accepted_for_policy_work");

    // TraceRef shape
    assert.equal(record.traceRef?.outcomeId, "out-001");
    assert.equal(record.traceRef?.candidateId, "cand-001");
    assert.equal(record.traceRef?.signalKind, "calibration_skew");

    // ExplanationRef shape
    assert.equal(record.explanationRef?.explanationId, "expl-001");
    assert.equal(record.explanationRef?.type, "correlation");

    // ComplianceRef shape
    assert.equal(record.complianceRef?.packageId, "pkg-001");
    assert.equal(record.complianceRef?.windowStart, "2026-06-01T00:00:00.000Z");
    assert.equal(record.complianceRef?.windowEnd, "2026-07-01T00:00:00.000Z");
  });

  // -----------------------------------------------------------------------
  // Test 2: phasePresence has all 6 boolean fields (p24–p29)
  // -----------------------------------------------------------------------

  it("phasePresence has all 6 boolean fields (p24 through p29)", () => {
    // All true
    const allPresent: LineageRecord["phasePresence"] = {
      p24: true,
      p25: true,
      p26: true,
      p27: true,
      p28: true,
      p29: true,
    };
    // All false
    const nonePresent: LineageRecord["phasePresence"] = {
      p24: false,
      p25: false,
      p26: false,
      p27: false,
      p28: false,
      p29: false,
    };
    // Mixed
    const mixed: LineageRecord["phasePresence"] = {
      p24: true,
      p25: false,
      p26: true,
      p27: false,
      p28: true,
      p29: false,
    };

    assert.equal(allPresent.p24, true);
    assert.equal(allPresent.p25, true);
    assert.equal(allPresent.p26, true);
    assert.equal(allPresent.p27, true);
    assert.equal(allPresent.p28, true);
    assert.equal(allPresent.p29, true);

    assert.equal(nonePresent.p24, false);
    assert.equal(nonePresent.p25, false);
    assert.equal(nonePresent.p26, false);
    assert.equal(nonePresent.p27, false);
    assert.equal(nonePresent.p28, false);
    assert.equal(nonePresent.p29, false);

    assert.equal(mixed.p24, true);
    assert.equal(mixed.p25, false);
    assert.equal(mixed.p26, true);
    assert.equal(mixed.p27, false);
    assert.equal(mixed.p28, true);
    assert.equal(mixed.p29, false);
  });

  // -----------------------------------------------------------------------
  // Test 3: Boundary flags present
  // -----------------------------------------------------------------------

  it("has all 5 boundary flags (readOnly, noPolicyMutation, noThresholdChange, noAutoAdoption, noRanking)", () => {
    // Type-level check: if this compiles, the flag names and literal true
    // types are correct.
    const flags: {
      readonly readOnly: true;
      readonly noPolicyMutation: true;
      readonly noThresholdChange: true;
      readonly noAutoAdoption: true;
      readonly noRanking: true;
    } = {
      readOnly: true as const,
      noPolicyMutation: true as const,
      noThresholdChange: true as const,
      noAutoAdoption: true as const,
      noRanking: true as const,
    };

    assert.equal(flags.readOnly, true);
    assert.equal(flags.noPolicyMutation, true);
    assert.equal(flags.noThresholdChange, true);
    assert.equal(flags.noAutoAdoption, true);
    assert.equal(flags.noRanking, true);

    // Also verify that the LineageRecord interface carries the same flags
    const record: LineageRecord = {
      lineageId: "l2",
      assembledAt: "2026-07-10T00:00:00.000Z",
      phasePresence: {
        p24: false, p25: false, p26: false, p27: false, p28: false, p29: false,
      },
      readOnly: true as const,
      noPolicyMutation: true as const,
      noThresholdChange: true as const,
      noAutoAdoption: true as const,
      noRanking: true as const,
    };

    assert.equal(record.readOnly, true);
    assert.equal(record.noPolicyMutation, true);
    assert.equal(record.noThresholdChange, true);
    assert.equal(record.noAutoAdoption, true);
    assert.equal(record.noRanking, true);
  });
});
