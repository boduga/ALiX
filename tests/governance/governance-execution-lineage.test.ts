/**
 * Tests X3a.3 — Explicit Execution Lineage Binding.
 *
 * Verifies:
 * - Links with matching evidence produce bindings
 * - Links with no matching evidence are silently ignored
 * - Multiple links produce multiple bindings
 * - Empty links produces empty array
 * - Empty evidence produces empty array
 * - Deterministic — same inputs produce same output
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type ExecutionRef,
  type ExecutionLineageRef,
} from "../../src/governance/governance-execution-types.js";
import {
  type ExecutionBinding,
  bindExecutionEvidence,
} from "../../src/governance/governance-execution-lineage.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a sample ExecutionRef fixture for testing.
 *
 * Pure factory — same inputs always produce the same output.
 */
function buildRef(
  overrides?: Partial<ExecutionRef>,
): ExecutionRef {
  return {
    evidenceId: "ev-001",
    intentId: "int-001",
    outcome: "SUCCESS" as const,
    completedAt: "2026-07-10T12:00:00.000Z",
    evidenceHash: "abc123def456",
    ...overrides,
  };
}

/**
 * Build a sample ExecutionLineageRef fixture for testing.
 */
function buildLink(
  overrides?: Partial<ExecutionLineageRef>,
): ExecutionLineageRef {
  return {
    candidateId: "cand-001",
    intentId: "int-001",
    evidenceId: "ev-001",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bindExecutionEvidence", () => {
  // -------------------------------------------------------------------------
  // Test 1: Links with matching evidence produce bindings
  // -------------------------------------------------------------------------

  it("produces a binding when link evidenceId matches evidence", () => {
    const links: readonly ExecutionLineageRef[] = [buildLink()];
    const evidence: readonly ExecutionRef[] = [buildRef()];

    const result = bindExecutionEvidence(links, evidence);

    assert.equal(result.length, 1);
    assert.equal(result[0].candidateId, "cand-001");
    assert.equal(result[0].executionRef.evidenceId, "ev-001");
    assert.equal(result[0].executionRef.intentId, "int-001");
    assert.equal(result[0].executionRef.outcome, "SUCCESS");
    assert.equal(
      result[0].executionRef.completedAt,
      "2026-07-10T12:00:00.000Z",
    );
    assert.equal(result[0].executionRef.evidenceHash, "abc123def456");
  });

  // -------------------------------------------------------------------------
  // Test 2: Links with no matching evidence produce empty bindings (silently
  //          ignored)
  // -------------------------------------------------------------------------

  it("silently ignores links with no matching evidence", () => {
    const links: readonly ExecutionLineageRef[] = [
      buildLink({ evidenceId: "ev-missing" }),
    ];
    const evidence: readonly ExecutionRef[] = [buildRef()];

    const result = bindExecutionEvidence(links, evidence);

    assert.equal(result.length, 0);
  });

  // -------------------------------------------------------------------------
  // Test 3: Multiple links produce multiple bindings
  // -------------------------------------------------------------------------

  it("produces multiple bindings for multiple matching links", () => {
    const links: readonly ExecutionLineageRef[] = [
      buildLink({ candidateId: "cand-001", evidenceId: "ev-001" }),
      buildLink({ candidateId: "cand-002", evidenceId: "ev-002" }),
      buildLink({ candidateId: "cand-003", evidenceId: "ev-003" }),
    ];
    const evidence: readonly ExecutionRef[] = [
      buildRef({ evidenceId: "ev-001", intentId: "int-001" }),
      buildRef({ evidenceId: "ev-002", intentId: "int-002" }),
      buildRef({ evidenceId: "ev-003", intentId: "int-003" }),
    ];

    const result = bindExecutionEvidence(links, evidence);

    assert.equal(result.length, 3);
    assert.equal(result[0].candidateId, "cand-001");
    assert.equal(result[0].executionRef.evidenceId, "ev-001");
    assert.equal(result[1].candidateId, "cand-002");
    assert.equal(result[1].executionRef.evidenceId, "ev-002");
    assert.equal(result[2].candidateId, "cand-003");
    assert.equal(result[2].executionRef.evidenceId, "ev-003");
  });

  // -------------------------------------------------------------------------
  // Test 4: Empty links produces empty array
  // -------------------------------------------------------------------------

  it("returns empty array when links are empty", () => {
    const links: readonly ExecutionLineageRef[] = [];
    const evidence: readonly ExecutionRef[] = [buildRef()];

    const result = bindExecutionEvidence(links, evidence);

    assert.equal(result.length, 0);
    assert.deepEqual(result, []);
  });

  // -------------------------------------------------------------------------
  // Test 5: Empty evidence produces empty array (all missing, silently
  //          ignored)
  // -------------------------------------------------------------------------

  it("returns empty array when evidence is empty", () => {
    const links: readonly ExecutionLineageRef[] = [buildLink()];
    const evidence: readonly ExecutionRef[] = [];

    const result = bindExecutionEvidence(links, evidence);

    assert.equal(result.length, 0);
    assert.deepEqual(result, []);
  });

  // -------------------------------------------------------------------------
  // Test 6: Deterministic — same inputs produce same output
  // -------------------------------------------------------------------------

  it("is deterministic — same inputs always produce same output", () => {
    const links: readonly ExecutionLineageRef[] = [
      buildLink({ candidateId: "cand-001", evidenceId: "ev-001" }),
      buildLink({ candidateId: "cand-002", evidenceId: "ev-002" }),
    ];
    const evidence: readonly ExecutionRef[] = [
      buildRef({ evidenceId: "ev-001" }),
      buildRef({ evidenceId: "ev-002" }),
    ];

    const first = bindExecutionEvidence(links, evidence);
    const second = bindExecutionEvidence(links, evidence);

    assert.deepEqual(first, second);
  });

  // -------------------------------------------------------------------------
  // Test 7: Mixed — some matching, some missing
  // -------------------------------------------------------------------------

  it("produces bindings for matching links and silently skips missing ones", () => {
    const links: readonly ExecutionLineageRef[] = [
      buildLink({ candidateId: "cand-001", evidenceId: "ev-001" }),
      buildLink({ candidateId: "cand-002", evidenceId: "ev-missing" }),
      buildLink({ candidateId: "cand-003", evidenceId: "ev-003" }),
    ];
    const evidence: readonly ExecutionRef[] = [
      buildRef({ evidenceId: "ev-001" }),
      buildRef({ evidenceId: "ev-003" }),
    ];

    const result = bindExecutionEvidence(links, evidence);

    assert.equal(result.length, 2);
    assert.equal(result[0].candidateId, "cand-001");
    assert.equal(result[0].executionRef.evidenceId, "ev-001");
    assert.equal(result[1].candidateId, "cand-003");
    assert.equal(result[1].executionRef.evidenceId, "ev-003");
  });

  // -------------------------------------------------------------------------
  // Test 8: ExecutionBinding fields are readonly (compile-time check)
  // -------------------------------------------------------------------------

  it("ExecutionBinding fields are readonly (compile-time check)", () => {
    const links: readonly ExecutionLineageRef[] = [buildLink()];
    const evidence: readonly ExecutionRef[] = [buildRef()];

    const result = bindExecutionEvidence(links, evidence);
    const binding: ExecutionBinding = result[0];

    assert.equal(binding.candidateId, "cand-001");

    // @ts-expect-error: candidateId is readonly
    binding.candidateId = "new-cand";
    // @ts-expect-error: executionRef is readonly
    binding.executionRef = buildRef({ evidenceId: "ev-999" });
  });
});
