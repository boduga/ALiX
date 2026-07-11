/**
 * Tests X3a — Evidence to Governance Adapter.
 *
 * Verifies:
 * - toExecutionRef maps all fields correctly
 * - toComplianceExecutionSummary maps all fields correctly
 * - Both functions are pure (same input always produces same output)
 * - No mutable reference leak (returned object is a new copy)
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { type ExecutionEvidence } from "../../src/runtime/contracts/execution-intent-contract.js";
import {
  toExecutionRef,
  toComplianceExecutionSummary,
} from "../../src/governance/governance-execution-adapter.js";

// ---------------------------------------------------------------------------
// Test Fixture
// ---------------------------------------------------------------------------

/**
 * Build a sample ExecutionEvidence fixture for testing.
 *
 * Pure factory — same inputs always produce the same output.
 */
function buildSampleEvidence(
  overrides?: Partial<ExecutionEvidence>,
): ExecutionEvidence {
  return {
    evidenceId: "ev-001",
    intentId: "int-001",
    startedAt: "2026-07-10T11:00:00.000Z",
    completedAt: "2026-07-10T12:00:00.000Z",
    outcome: "SUCCESS" as const,
    summary: "Execution completed successfully with all checks passing.",
    artifacts: ["report.json", "log.txt"],
    verificationPassed: true,
    evidenceHash: "abc123def456",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: toExecutionRef
// ---------------------------------------------------------------------------

describe("toExecutionRef", () => {
  it("maps evidenceId correctly", () => {
    const evidence = buildSampleEvidence();
    const ref = toExecutionRef(evidence);
    assert.equal(ref.evidenceId, "ev-001");
  });

  it("maps intentId correctly", () => {
    const evidence = buildSampleEvidence();
    const ref = toExecutionRef(evidence);
    assert.equal(ref.intentId, "int-001");
  });

  it("maps outcome correctly", () => {
    const evidence = buildSampleEvidence();
    const ref = toExecutionRef(evidence);
    assert.equal(ref.outcome, "SUCCESS");
  });

  it("maps completedAt correctly", () => {
    const evidence = buildSampleEvidence();
    const ref = toExecutionRef(evidence);
    assert.equal(ref.completedAt, "2026-07-10T12:00:00.000Z");
  });

  it("maps evidenceHash correctly", () => {
    const evidence = buildSampleEvidence();
    const ref = toExecutionRef(evidence);
    assert.equal(ref.evidenceHash, "abc123def456");
  });

  it("maps all outcome variants (SUCCESS, FAILED, PARTIAL)", () => {
    const success = toExecutionRef(buildSampleEvidence({ outcome: "SUCCESS" }));
    assert.equal(success.outcome, "SUCCESS");

    const failed = toExecutionRef(buildSampleEvidence({ outcome: "FAILED" }));
    assert.equal(failed.outcome, "FAILED");

    const partial = toExecutionRef(
      buildSampleEvidence({ outcome: "PARTIAL" }),
    );
    assert.equal(partial.outcome, "PARTIAL");
  });

  it("is pure — same input always produces same output", () => {
    const evidence = buildSampleEvidence();
    const first = toExecutionRef(evidence);
    const second = toExecutionRef(evidence);
    assert.deepEqual(first, second);
  });

  it("returns a new copy — no mutable reference leak", () => {
    const evidence = buildSampleEvidence();
    const ref = toExecutionRef(evidence);

    // Verify the returned object is not the same reference as evidence
    assert.notEqual(ref as unknown as Record<string, unknown>, evidence);
    // Verify the returned object is not the same as any sub-field of evidence
    assert.notEqual(
      ref as unknown as Record<string, unknown>,
      evidence as unknown as Record<string, unknown>,
    );

    // Verify the expected fields are present and the object is structurally correct
    assert.equal(
      Object.keys(ref).sort().join(","),
      "completedAt,evidenceHash,evidenceId,intentId,outcome",
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: toComplianceExecutionSummary
// ---------------------------------------------------------------------------

describe("toComplianceExecutionSummary", () => {
  it("maps evidenceId correctly", () => {
    const evidence = buildSampleEvidence();
    const summary = toComplianceExecutionSummary(evidence);
    assert.equal(summary.evidenceId, "ev-001");
  });

  it("maps intentId correctly", () => {
    const evidence = buildSampleEvidence();
    const summary = toComplianceExecutionSummary(evidence);
    assert.equal(summary.intentId, "int-001");
  });

  it("maps outcome correctly", () => {
    const evidence = buildSampleEvidence();
    const summary = toComplianceExecutionSummary(evidence);
    assert.equal(summary.outcome, "SUCCESS");
  });

  it("maps completedAt correctly", () => {
    const evidence = buildSampleEvidence();
    const summary = toComplianceExecutionSummary(evidence);
    assert.equal(summary.completedAt, "2026-07-10T12:00:00.000Z");
  });

  it("maps verificationPassed correctly (true)", () => {
    const evidence = buildSampleEvidence();
    const summary = toComplianceExecutionSummary(evidence);
    assert.equal(summary.verificationPassed, true);
  });

  it("maps verificationPassed correctly (false)", () => {
    const evidence = buildSampleEvidence({ verificationPassed: false });
    const summary = toComplianceExecutionSummary(evidence);
    assert.equal(summary.verificationPassed, false);
  });

  it("maps summary correctly", () => {
    const evidence = buildSampleEvidence({
      summary: "Custom summary text for compliance.",
    });
    const summary = toComplianceExecutionSummary(evidence);
    assert.equal(summary.summary, "Custom summary text for compliance.");
  });

  it("maps all outcome variants (SUCCESS, FAILED, PARTIAL)", () => {
    const success = toComplianceExecutionSummary(
      buildSampleEvidence({ outcome: "SUCCESS" }),
    );
    assert.equal(success.outcome, "SUCCESS");

    const failed = toComplianceExecutionSummary(
      buildSampleEvidence({ outcome: "FAILED" }),
    );
    assert.equal(failed.outcome, "FAILED");

    const partial = toComplianceExecutionSummary(
      buildSampleEvidence({ outcome: "PARTIAL" }),
    );
    assert.equal(partial.outcome, "PARTIAL");
  });

  it("is pure — same input always produces same output", () => {
    const evidence = buildSampleEvidence();
    const first = toComplianceExecutionSummary(evidence);
    const second = toComplianceExecutionSummary(evidence);
    assert.deepEqual(first, second);
  });

  it("returns a new copy — no mutable reference leak", () => {
    const evidence = buildSampleEvidence();
    const summary = toComplianceExecutionSummary(evidence);

    // Verify the returned object is not the same reference as evidence
    assert.notEqual(
      summary as unknown as Record<string, unknown>,
      evidence as unknown as Record<string, unknown>,
    );

    // Verify the expected fields are present
    assert.equal(
      Object.keys(summary).sort().join(","),
      "completedAt,evidenceId,intentId,outcome,summary,verificationPassed",
    );
  });
});
