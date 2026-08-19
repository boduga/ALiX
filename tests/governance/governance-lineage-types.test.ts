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
import type { ExecutionRef } from "../../src/governance/governance-execution-types.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceLineageTypes", () => {
  // -----------------------------------------------------------------------
  // Test 1: LineageRecord has all 6 phase refs with correct shapes
  // -----------------------------------------------------------------------

  it("LineageRecord has all 6 phase refs (SignalRef, CandidateRef, OutcomeRef, TraceRef, ExplanationRef, ComplianceRef) plus executionRef", () => {
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
        signal: true,
        candidate: true,
        outcome: true,
        trace: true,
        explanation: true,
        compliance: true,
        execution: false,
      },
      signalRef,
      candidateRef,
      outcomeRef,
      traceRef,
      explanationRef,
      complianceRef,
      executionRef: null,
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

  it("phasePresence has all 7 boolean fields (p24 through p29 plus execution)", () => {
    // All true
    const allPresent: LineageRecord["phasePresence"] = {
      signal: true,
      candidate: true,
      outcome: true,
      trace: true,
      explanation: true,
      compliance: true,
      execution: true,
    };
    // All false
    const nonePresent: LineageRecord["phasePresence"] = {
      signal: false,
      candidate: false,
      outcome: false,
      trace: false,
      explanation: false,
      compliance: false,
      execution: false,
    };
    // Mixed
    const mixed: LineageRecord["phasePresence"] = {
      signal: true,
      candidate: false,
      outcome: true,
      trace: false,
      explanation: true,
      compliance: false,
      execution: true,
    };

    assert.equal(allPresent.signal, true);
    assert.equal(allPresent.candidate, true);
    assert.equal(allPresent.outcome, true);
    assert.equal(allPresent.trace, true);
    assert.equal(allPresent.explanation, true);
    assert.equal(allPresent.compliance, true);

    assert.equal(nonePresent.signal, false);
    assert.equal(nonePresent.candidate, false);
    assert.equal(nonePresent.outcome, false);
    assert.equal(nonePresent.trace, false);
    assert.equal(nonePresent.explanation, false);
    assert.equal(nonePresent.compliance, false);

    assert.equal(mixed.signal, true);
    assert.equal(mixed.candidate, false);
    assert.equal(mixed.outcome, true);
    assert.equal(mixed.trace, false);
    assert.equal(mixed.explanation, true);
    assert.equal(mixed.compliance, false);
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
        signal: false, candidate: false, outcome: false, trace: false, explanation: false, compliance: false, execution: false,
      },
      executionRef: null,
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
