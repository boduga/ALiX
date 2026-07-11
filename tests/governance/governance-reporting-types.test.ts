/**
 * P29.1 — Compliance Package Types tests.
 *
 * Verifies the shape of CompliancePackage and its 4 summary types,
 * plus the boundary flags that enforce read-only governance constraints.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type {
  CompliancePackage,
  ComplianceSignalSummary,
  ComplianceCandidateSummary,
  ComplianceOutcomeSummary,
  ComplianceTraceSummary,
} from "../../src/governance/governance-reporting-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ISO = "2026-07-09T12:00:00.000Z";

function makeSignalSummary(
  overrides: Partial<ComplianceSignalSummary> = {},
): ComplianceSignalSummary {
  return {
    signalId: "sig-1",
    kind: "calibration_skew",
    severity: "medium",
    direction: "too_loose",
    windowStart: ISO,
    windowEnd: ISO,
    ...overrides,
  };
}

function makeCandidateSummary(
  overrides: Partial<ComplianceCandidateSummary> = {},
): ComplianceCandidateSummary {
  return {
    candidateId: "cand-1",
    title: "Tighten calibration threshold",
    status: "open",
    signalKind: "calibration_skew",
    signalSeverity: "medium",
    createdAt: ISO,
    hasOutcome: false,
    ...overrides,
  };
}

function makeOutcomeSummary(
  overrides: Partial<ComplianceOutcomeSummary> = {},
): ComplianceOutcomeSummary {
  return {
    outcomeId: "out-1",
    candidateId: "cand-1",
    outcomeType: "adopted",
    recordedBy: "governance-review",
    rationale: "Threshold adjusted per signal evidence",
    ...overrides,
  };
}

function makeTraceSummary(
  overrides: Partial<ComplianceTraceSummary> = {},
): ComplianceTraceSummary {
  return {
    outcomeId: "out-1",
    candidateId: "cand-1",
    signalKind: "calibration_skew",
    outcomeType: "adopted",
    timeToOutcomeDays: 3.5,
    ...overrides,
  };
}

function makeCompliancePackage(
  overrides: Partial<CompliancePackage> = {},
): CompliancePackage {
  return {
    packageId: "pkg-001",
    generatedAt: ISO,
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    totalSignals: 1,
    totalCandidates: 1,
    totalOutcomes: 1,
    totalTraces: 1,
    signalSummary: [makeSignalSummary()],
    candidateSummary: [makeCandidateSummary()],
    outcomeSummary: [makeOutcomeSummary()],
    traceSummary: [makeTraceSummary()],
    correlationAnalytics: {
      signalToOutcomeCorrelations: [
        { signalKind: "calibration_skew", outcomeType: "adopted", correlationStrength: 0.85, sampleSize: 12 },
      ],
      evidenceCoverage: { totalSignals: 10, withOutcome: 7, coverageRate: 0.7 },
      commonPatterns: ["calibration_skew → adopted"],
    },
    keyExplanations: [
      {
        explanationId: "expl-1",
        type: "correlation",
        description: "Strong correlation between calibration_skew and adopted outcomes",
        relatedIds: ["sig-1", "cand-1", "out-1"],
        confidence: 0.85,
      },
    ],
    executionEvidenceCount: 0,
    executionOutcomes: { success: 0, failed: 0, partial: 0 },
    executionSummary: [],
    phasesIncluded: ["P22", "P23", "P24"],
    readOnly: true,
    noPolicyMutation: true,
    noThresholdChange: true,
    noAutoAdoption: true,
    noRanking: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CompliancePackage (P29.1)", () => {
  it("shape — inventory fields, summaries, analytics, explanations, metadata", () => {
    const pkg = makeCompliancePackage();

    // Inventory fields
    assert.equal(typeof pkg.packageId, "string");
    assert.equal(typeof pkg.generatedAt, "string");
    assert.equal(typeof pkg.windowStart, "string");
    assert.equal(typeof pkg.windowEnd, "string");
    assert.equal(typeof pkg.totalSignals, "number");
    assert.equal(typeof pkg.totalCandidates, "number");
    assert.equal(typeof pkg.totalOutcomes, "number");
    assert.equal(typeof pkg.totalTraces, "number");

    // Summaries
    assert.ok(Array.isArray(pkg.signalSummary));
    assert.ok(Array.isArray(pkg.candidateSummary));
    assert.ok(Array.isArray(pkg.outcomeSummary));
    assert.ok(Array.isArray(pkg.traceSummary));
    assert.equal(pkg.signalSummary.length, 1);
    assert.equal(pkg.candidateSummary.length, 1);
    assert.equal(pkg.outcomeSummary.length, 1);
    assert.equal(pkg.traceSummary.length, 1);

    // Analytics
    assert.ok(pkg.correlationAnalytics);
    assert.ok(Array.isArray(pkg.correlationAnalytics.signalToOutcomeCorrelations));
    assert.ok(pkg.correlationAnalytics.evidenceCoverage);
    assert.ok(Array.isArray(pkg.correlationAnalytics.commonPatterns));

    // Explanations
    assert.ok(Array.isArray(pkg.keyExplanations));
    assert.equal(pkg.keyExplanations.length, 1);
    assert.equal(pkg.keyExplanations[0].explanationId, "expl-1");
    assert.equal(typeof pkg.keyExplanations[0].confidence, "number");

    // Metadata
    assert.ok(Array.isArray(pkg.phasesIncluded));
    assert.ok(pkg.phasesIncluded.includes("P22"));
  });

  it("summary types — all 4 summary types have required fields", () => {
    const sig = makeSignalSummary();
    assert.equal(typeof sig.signalId, "string");
    assert.equal(typeof sig.kind, "string");
    assert.equal(typeof sig.severity, "string");
    assert.equal(typeof sig.direction, "string");
    assert.equal(typeof sig.windowStart, "string");
    assert.equal(typeof sig.windowEnd, "string");

    const cand = makeCandidateSummary();
    assert.equal(typeof cand.candidateId, "string");
    assert.equal(typeof cand.title, "string");
    assert.equal(typeof cand.status, "string");
    assert.equal(typeof cand.signalKind, "string");
    assert.equal(typeof cand.signalSeverity, "string");
    assert.equal(typeof cand.createdAt, "string");
    assert.equal(typeof cand.hasOutcome, "boolean");

    const out = makeOutcomeSummary();
    assert.equal(typeof out.outcomeId, "string");
    assert.equal(typeof out.candidateId, "string");
    assert.equal(typeof out.outcomeType, "string");
    assert.equal(typeof out.recordedBy, "string");
    assert.equal(typeof out.rationale, "string");

    const trace = makeTraceSummary();
    assert.equal(typeof trace.outcomeId, "string");
    assert.equal(typeof trace.candidateId, "string");
    assert.equal(typeof trace.signalKind, "string");
    assert.equal(typeof trace.outcomeType, "string");
    assert.equal(typeof trace.timeToOutcomeDays, "number");
  });

  it("boundary flags — readOnly, noPolicyMutation, noThresholdChange, noAutoAdoption, noRanking are all true", () => {
    const pkg = makeCompliancePackage();

    assert.equal(pkg.readOnly, true);
    assert.equal(pkg.noPolicyMutation, true);
    assert.equal(pkg.noThresholdChange, true);
    assert.equal(pkg.noAutoAdoption, true);
    assert.equal(pkg.noRanking, true);

    // Verify they are explicitly typed as `true` (literal types)
    const flags: true[] = [
      pkg.readOnly,
      pkg.noPolicyMutation,
      pkg.noThresholdChange,
      pkg.noAutoAdoption,
      pkg.noRanking,
    ];
    for (const flag of flags) {
      assert.equal(flag, true);
    }
  });
});
