/**
 * Tests for X3a — Governance Execution Types.
 *
 * Verifies:
 * - Each interface can be instantiated with required fields
 * - Fields are readonly (compile-time check via @ts-expect-error)
 * - outcome is one of "SUCCESS" | "FAILED" | "PARTIAL"
 * - ExecutionRef does not contain artifacts, startedAt, summary, or
 *   verificationPassed (compile-time excess-property check)
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type ExecutionRef,
  type ExecutionLineageRef,
  type ComplianceExecutionSummary,
} from "../../src/governance/governance-execution-types.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceExecutionTypes", () => {
  // -------------------------------------------------------------------------
  // Test 1: ExecutionRef can be instantiated with required fields
  // -------------------------------------------------------------------------

  it("ExecutionRef can be instantiated with required fields", () => {
    const ref: ExecutionRef = {
      evidenceId: "ev-001",
      intentId: "int-001",
      outcome: "SUCCESS" as const,
      completedAt: "2026-07-10T12:00:00.000Z",
      evidenceHash: "abc123def456",
    };

    assert.equal(ref.evidenceId, "ev-001");
    assert.equal(ref.intentId, "int-001");
    assert.equal(ref.outcome, "SUCCESS");
    assert.equal(ref.completedAt, "2026-07-10T12:00:00.000Z");
    assert.equal(ref.evidenceHash, "abc123def456");
  });

  // -------------------------------------------------------------------------
  // Test 2: ExecutionLineageRef can be instantiated with required fields
  // -------------------------------------------------------------------------

  it("ExecutionLineageRef can be instantiated with required fields", () => {
    const lineageRef: ExecutionLineageRef = {
      candidateId: "cand-001",
      intentId: "int-001",
      evidenceId: "ev-001",
    };

    assert.equal(lineageRef.candidateId, "cand-001");
    assert.equal(lineageRef.intentId, "int-001");
    assert.equal(lineageRef.evidenceId, "ev-001");
  });

  // -------------------------------------------------------------------------
  // Test 3: ComplianceExecutionSummary can be instantiated with required fields
  // -------------------------------------------------------------------------

  it("ComplianceExecutionSummary can be instantiated with required fields", () => {
    const summary: ComplianceExecutionSummary = {
      evidenceId: "ev-001",
      intentId: "int-001",
      outcome: "FAILED" as const,
      completedAt: "2026-07-10T12:00:00.000Z",
      verificationPassed: false,
      summary: "Execution failed due to timeout",
    };

    assert.equal(summary.evidenceId, "ev-001");
    assert.equal(summary.intentId, "int-001");
    assert.equal(summary.outcome, "FAILED");
    assert.equal(summary.completedAt, "2026-07-10T12:00:00.000Z");
    assert.equal(summary.verificationPassed, false);
    assert.equal(summary.summary, "Execution failed due to timeout");
  });

  // -------------------------------------------------------------------------
  // Test 4: All outcome literals are valid ("SUCCESS", "FAILED", "PARTIAL")
  // -------------------------------------------------------------------------

  it("ExecutionRef accepts all 3 outcome literals (SUCCESS, FAILED, PARTIAL)", () => {
    // SUCCESS
    const success: ExecutionRef = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", evidenceHash: "h1",
    };
    assert.equal(success.outcome, "SUCCESS");

    // FAILED
    const failed: ExecutionRef = {
      evidenceId: "e2", intentId: "i2",
      outcome: "FAILED" as const,
      completedAt: "t2", evidenceHash: "h2",
    };
    assert.equal(failed.outcome, "FAILED");

    // PARTIAL
    const partial: ExecutionRef = {
      evidenceId: "e3", intentId: "i3",
      outcome: "PARTIAL" as const,
      completedAt: "t3", evidenceHash: "h3",
    };
    assert.equal(partial.outcome, "PARTIAL");
  });

  // -------------------------------------------------------------------------
  // Test 5: ComplianceExecutionSummary accepts all 3 outcome literals
  // -------------------------------------------------------------------------

  it("ComplianceExecutionSummary accepts all 3 outcome literals", () => {
    const success: ComplianceExecutionSummary = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", verificationPassed: true, summary: "ok",
    };
    assert.equal(success.outcome, "SUCCESS");

    const failed: ComplianceExecutionSummary = {
      evidenceId: "e2", intentId: "i2",
      outcome: "FAILED" as const,
      completedAt: "t2", verificationPassed: false, summary: "fail",
    };
    assert.equal(failed.outcome, "FAILED");

    const partial: ComplianceExecutionSummary = {
      evidenceId: "e3", intentId: "i3",
      outcome: "PARTIAL" as const,
      completedAt: "t3", verificationPassed: true, summary: "partial",
    };
    assert.equal(partial.outcome, "PARTIAL");
  });

  // -------------------------------------------------------------------------
  // Test 6: Runtime enforcement — outcome is one of the 3 valid values
  // -------------------------------------------------------------------------

  it("outcome property value is one of the 3 valid values at runtime", () => {
    const validOutcomes = new Set(["SUCCESS", "FAILED", "PARTIAL"]);

    const ref: ExecutionRef = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", evidenceHash: "h1",
    };
    assert.ok(validOutcomes.has(ref.outcome));

    const summary: ComplianceExecutionSummary = {
      evidenceId: "e2", intentId: "i2",
      outcome: "FAILED" as const,
      completedAt: "t2", verificationPassed: false, summary: "nope",
    };
    assert.ok(validOutcomes.has(summary.outcome));
  });

  // -------------------------------------------------------------------------
  // Test 7: Readonly compile-time check — ExecutionRef fields
  // -------------------------------------------------------------------------

  it("ExecutionRef fields are readonly (compile-time check)", () => {
    // This test verifies readonly at compile time via @ts-expect-error.
    // If readonly is removed from ExecutionRef, the @ts-expect-error directives
    // become "unused" and tsc --noEmit catches them (TS2578).
    // Runtime assertions run BEFORE the forbidden assignments.
    const ref: ExecutionRef = {
      evidenceId: "ev-001", intentId: "int-001",
      outcome: "PARTIAL" as const,
      completedAt: "t1", evidenceHash: "h1",
    };

    assert.equal(ref.evidenceId, "ev-001");

    // Each @ts-expect-error suppresses TS2540 on the following assignment.
    // @ts-expect-error: evidenceId is readonly
    ref.evidenceId = "new-id";
    // @ts-expect-error: intentId is readonly
    ref.intentId = "new-int";
    // @ts-expect-error: outcome is readonly
    ref.outcome = "FAILED";
    // @ts-expect-error: completedAt is readonly
    ref.completedAt = "new-time";
    // @ts-expect-error: evidenceHash is readonly
    ref.evidenceHash = "new-hash";
  });

  // -------------------------------------------------------------------------
  // Test 8: Readonly compile-time check — ExecutionLineageRef fields
  // -------------------------------------------------------------------------

  it("ExecutionLineageRef fields are readonly (compile-time check)", () => {
    const ref: ExecutionLineageRef = {
      candidateId: "cand-001",
      intentId: "int-001",
      evidenceId: "ev-001",
    };

    assert.equal(ref.candidateId, "cand-001");

    // @ts-expect-error: candidateId is readonly
    ref.candidateId = "new-cand";
    // @ts-expect-error: intentId is readonly
    ref.intentId = "new-int";
    // @ts-expect-error: evidenceId is readonly
    ref.evidenceId = "new-ev";
  });

  // -------------------------------------------------------------------------
  // Test 9: Readonly compile-time check — ComplianceExecutionSummary fields
  // -------------------------------------------------------------------------

  it("ComplianceExecutionSummary fields are readonly (compile-time check)", () => {
    const ref: ComplianceExecutionSummary = {
      evidenceId: "ev-001", intentId: "int-001",
      outcome: "SUCCESS" as const,
      completedAt: "t1", verificationPassed: true, summary: "ok",
    };

    assert.equal(ref.evidenceId, "ev-001");

    // @ts-expect-error: evidenceId is readonly
    ref.evidenceId = "new-id";
    // @ts-expect-error: intentId is readonly
    ref.intentId = "new-int";
    // @ts-expect-error: outcome is readonly
    ref.outcome = "FAILED";
    // @ts-expect-error: completedAt is readonly
    ref.completedAt = "new-time";
    // @ts-expect-error: verificationPassed is readonly
    ref.verificationPassed = false;
    // @ts-expect-error: summary is readonly
    ref.summary = "changed";
  });

  // -------------------------------------------------------------------------
  // Test 10: ExecutionRef does NOT contain artifacts, startedAt, summary, or
  //          verificationPassed (compile-time excess property check)
  // -------------------------------------------------------------------------

  it("ExecutionRef structurally excludes artifacts, startedAt, summary, verificationPassed", () => {
    // Excess property check: TS2353 fires on the forbidden property line.
    // A ts-expect-error comment must be placed on the line BEFORE the forbidden entry.

    const _withArtifacts: ExecutionRef = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", evidenceHash: "h1",
      // @ts-expect-error: artifacts is not in ExecutionRef
      artifacts: [],
    };

    const _withStartedAt: ExecutionRef = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", evidenceHash: "h1",
      // @ts-expect-error: startedAt is not in ExecutionRef
      startedAt: "t0",
    };

    const _withSummary: ExecutionRef = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", evidenceHash: "h1",
      // @ts-expect-error: summary is not in ExecutionRef
      summary: "should not be here",
    };

    const _withVerificationPassed: ExecutionRef = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", evidenceHash: "h1",
      // @ts-expect-error: verificationPassed is not in ExecutionRef
      verificationPassed: true,
    };

    // All 4 forbidden fields together — only the first triggers TS2353
    const _withAllForbidden: ExecutionRef = {
      evidenceId: "e1", intentId: "i1",
      outcome: "SUCCESS" as const,
      completedAt: "t1", evidenceHash: "h1",
      // @ts-expect-error: artifacts not in ExecutionRef
      artifacts: [],
      startedAt: "t0",
      summary: "nope",
      verificationPassed: true,
    };

    // Suppress unused variable warnings — these must compile clean at runtime
    assert.ok(true);
  });

  // -------------------------------------------------------------------------
  // Test 11: ExecutionLineageRef also excludes the same forbidden fields
  // -------------------------------------------------------------------------

  it("ExecutionLineageRef structurally excludes artifacts, startedAt, summary, verificationPassed", () => {
    const _withArtifacts: ExecutionLineageRef = {
      candidateId: "c1", intentId: "i1", evidenceId: "e1",
      // @ts-expect-error: artifacts is not in ExecutionLineageRef
      artifacts: [],
    };

    const _withStartedAt: ExecutionLineageRef = {
      candidateId: "c1", intentId: "i1", evidenceId: "e1",
      // @ts-expect-error: startedAt is not in ExecutionLineageRef
      startedAt: "t0",
    };

    const _withSummary: ExecutionLineageRef = {
      candidateId: "c1", intentId: "i1", evidenceId: "e1",
      // @ts-expect-error: summary is not in ExecutionLineageRef
      summary: "nope",
    };

    const _withVerificationPassed: ExecutionLineageRef = {
      candidateId: "c1", intentId: "i1", evidenceId: "e1",
      // @ts-expect-error: verificationPassed is not in ExecutionLineageRef
      verificationPassed: true,
    };

    assert.ok(true);
  });
});
