/**
 * Tests A2.0 — Verification Contract Types.
 *
 * Covers EvidenceClass, VerificationStatus, VerificationFailureKind,
 * VerificationRun, VerificationReport, VerificationEvidence, and
 * their validators.
 *
 * @module verification-contract
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VERIFICATION_ALL_STATUSES,
  VERIFICATION_TERMINAL_STATUSES,
  VERIFICATION_FAILURE_KINDS,
  isValidVerificationStatus,
  isValidVerificationFailureKind,
  isValidReproducibilityLevel,
  validateVerificationRun,
  validateVerificationReport,
  validateVerificationEvidence,
} from "../../../src/evolution/verification/index.js";
import type {
  VerificationRun,
  VerificationReport,
  VerificationEvidence,
} from "../../../src/evolution/verification/index.js";

// ---------------------------------------------------------------------------
// VerificationStatus
// ---------------------------------------------------------------------------

describe("VerificationStatus", () => {
  it("has 5 valid statuses", () => {
    assert.strictEqual(VERIFICATION_ALL_STATUSES.length, 5);
    assert.ok(VERIFICATION_ALL_STATUSES.includes("pending"));
    assert.ok(VERIFICATION_ALL_STATUSES.includes("running"));
    assert.ok(VERIFICATION_ALL_STATUSES.includes("completed"));
    assert.ok(VERIFICATION_ALL_STATUSES.includes("failed"));
    assert.ok(VERIFICATION_ALL_STATUSES.includes("cancelled"));
  });

  it("has 3 terminal statuses", () => {
    assert.strictEqual(VERIFICATION_TERMINAL_STATUSES.length, 3);
    assert.ok(VERIFICATION_TERMINAL_STATUSES.includes("completed"));
    assert.ok(VERIFICATION_TERMINAL_STATUSES.includes("failed"));
    assert.ok(VERIFICATION_TERMINAL_STATUSES.includes("cancelled"));
  });

  it("isValidVerificationStatus validates correctly", () => {
    assert.ok(isValidVerificationStatus("pending"));
    assert.ok(isValidVerificationStatus("completed"));
    assert.ok(!isValidVerificationStatus("unknown_status"));
    assert.ok(!isValidVerificationStatus(""));
  });
});

// ---------------------------------------------------------------------------
// VerificationFailureKind
// ---------------------------------------------------------------------------

describe("VerificationFailureKind", () => {
  it("has 10 failure kinds", () => {
    assert.strictEqual(VERIFICATION_FAILURE_KINDS.length, 10);
  });

  it("isValidVerificationFailureKind validates correctly", () => {
    assert.ok(isValidVerificationFailureKind("DeterminismFailure"));
    assert.ok(isValidVerificationFailureKind("TimeoutFailure"));
    assert.ok(!isValidVerificationFailureKind("GenericFailure"));
    assert.ok(!isValidVerificationFailureKind(""));
  });
});

// ---------------------------------------------------------------------------
// ReproducibilityLevel
// ---------------------------------------------------------------------------

describe("ReproducibilityLevel", () => {
  it("isValidReproducibilityLevel validates 0-3", () => {
    assert.ok(isValidReproducibilityLevel(0));
    assert.ok(isValidReproducibilityLevel(1));
    assert.ok(isValidReproducibilityLevel(2));
    assert.ok(isValidReproducibilityLevel(3));
    assert.ok(!isValidReproducibilityLevel(4));
    assert.ok(!isValidReproducibilityLevel(-1));
    assert.ok(!isValidReproducibilityLevel(null));
  });
});

// ---------------------------------------------------------------------------
// Validate — VerificationRun
// ---------------------------------------------------------------------------

describe("validateVerificationRun", () => {
  it("accepts a valid run", () => {
    const run: VerificationRun = {
      verificationId: "ver-run-001",
      proposalId: "prop-001",
      replayDatasetId: "ds-001",
      environmentHash: "env-hash-001",
      startedAt: "2026-07-12T10:00:00.000Z",
      completedAt: "2026-07-12T10:05:00.000Z",
      status: "completed",
      failureReason: null,
    };
    const result = validateVerificationRun(run);
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects null input", () => {
    const result = validateVerificationRun(null);
    assert.equal(result.valid, false);
  });

  it("rejects missing verificationId", () => {
    const result = validateVerificationRun({ verificationId: "" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("verificationId")));
  });

  it("rejects invalid status", () => {
    const result = validateVerificationRun({
      verificationId: "v-1",
      proposalId: "p-1",
      replayDatasetId: "d-1",
      environmentHash: "h-1",
      startedAt: "2026-01-01T00:00:00.000Z",
      status: "invalid",
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("status")));
  });

  it("allows null failureReason", () => {
    const run: VerificationRun = {
      verificationId: "ver-run-002",
      proposalId: "prop-002",
      replayDatasetId: "ds-002",
      environmentHash: "env-hash-002",
      startedAt: "2026-07-12T10:00:00.000Z",
      completedAt: null,
      status: "running",
      failureReason: null,
    };
    const result = validateVerificationRun(run);
    assert.ok(result.valid);
  });
});

// ---------------------------------------------------------------------------
// Validate — VerificationReport
// ---------------------------------------------------------------------------

describe("validateVerificationReport", () => {
  it("accepts a valid report", () => {
    const report: VerificationReport = {
      reportId: "rep-001",
      verificationId: "ver-run-001",
      evidenceClass: "projected",
      replayMetadata: { seed: 42, scheduler: "fifo" },
      executionLogs: ["Execution started", "Replay completed"],
      metricResults: [{ name: "success_rate", baselineValue: 0.94, candidateValue: 0.96, delta: 0.02 }],
      diagnostics: [{ phase: "replay", duration_ms: 1200 }],
    };
    const result = validateVerificationReport(report);
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects non-projected evidenceClass", () => {
    const report = {
      reportId: "rep-001",
      verificationId: "ver-run-001",
      evidenceClass: "observed",
      executionLogs: [],
    };
    const result = validateVerificationReport(report);
    assert.equal(result.valid, false);
  });
});

// ---------------------------------------------------------------------------
// Validate — VerificationEvidence
// ---------------------------------------------------------------------------

describe("validateVerificationEvidence", () => {
  const validEvidence: VerificationEvidence = {
    evidenceId: "ev-ev-001",
    verificationId: "ver-run-001",
    proposalId: "prop-001",
    replayDatasetId: "ds-001",
    evidenceClass: "projected",
    proposalSnapshotHash: "hash-001",
    environmentHash: "hash-env-001",
    baselineMetrics: { success_rate: 0.94 },
    candidateMetrics: { success_rate: 0.96 },
    metricDeltas: { success_rate: 0.02 },
    behavioralChanges: [],
    confidenceProfile: {
      replayFidelity: 0.95,
      coverage: 0.85,
      determinism: 1.0,
      historicalSimilarity: 0.90,
      overallConfidence: 0.765,
    },
    reproducibilityLevel: 2,
    lineage: [],
    verifiedAt: "2026-07-12T10:05:00.000Z",
    expiresAt: "2026-10-12T10:05:00.000Z",
    reverificationRequired: false,
    integrityHash: "sha256:abc123",
  };

  it("accepts valid evidence", () => {
    const result = validateVerificationEvidence(validEvidence);
    assert.ok(result.valid, `expected valid, got: ${result.errors.join(", ")}`);
  });

  it("rejects non-projected evidenceClass", () => {
    const result = validateVerificationEvidence({ ...validEvidence, evidenceClass: "observed" });
    assert.equal(result.valid, false);
  });

  it("rejects missing integrityHash", () => {
    const result = validateVerificationEvidence({ ...validEvidence, integrityHash: "" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("integrityHash")));
  });

  it("rejects invalid reproducibilityLevel", () => {
    const result = validateVerificationEvidence({ ...validEvidence, reproducibilityLevel: 5 });
    assert.equal(result.valid, false);
  });

  it("rejects null input", () => {
    const result = validateVerificationEvidence(null);
    assert.equal(result.valid, false);
  });
});
