/**
 * P29.2 — Compliance Package Builder tests.
 *
 * 10 tests covering complete packages, partial evidence, deterministic
 * IDs, inventory accuracy, input immutability, phase derivation, replay
 * stability, and governance-directive language prohibition.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompliancePackage,
} from "../../src/governance/governance-reporting-builder.js";
import type { BuildCompliancePackageInput } from "../../src/governance/governance-reporting-builder.js";

import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";
import type { PolicyReviewCandidate } from "../../src/governance/policy-review-candidate-types.js";
import type { PolicyReviewOutcome } from "../../src/governance/policy-review-outcome-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISO_A = "2026-06-01T00:00:00.000Z";
const ISO_B = "2026-07-01T00:00:00.000Z";
const GENERATED_AT = "2026-07-09T12:00:00.000Z";

// ---------------------------------------------------------------------------
// Test-data factories
// ---------------------------------------------------------------------------

function signal(
  overrides: Partial<PolicyDriftSignal> = {},
): PolicyDriftSignal {
  return {
    signalId: "sig-1",
    kind: "calibration_skew",
    windowStart: ISO_A,
    windowEnd: ISO_B,
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: ["calibration"],
    evidenceRefs: [{ source: "p22_calibration", lifecycleId: "life-1" }],
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

function candidate(
  overrides: Partial<PolicyReviewCandidate> = {},
): PolicyReviewCandidate {
  return {
    candidateId: "cand-1",
    source: {
      phase: "P24",
      signalId: "sig-1",
      signalKind: "calibration_skew",
      signalSeverity: "medium",
      signalDirection: "too_loose",
      windowStart: ISO_A,
      windowEnd: ISO_B,
    },
    title: "Tighten calibration threshold",
    summary: "Candidate proposes tightening the calibration threshold.",
    status: "accepted_for_policy_review",
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z",
    evidenceRefs: [{ source: "p22_calibration", lifecycleId: "life-1" }],
    review: {
      reviewerId: "reviewer-1",
      rationale: "Evidence supports threshold adjustment.",
      notes: [],
      decisionBasis: [],
    },
    boundaries: {
      readOnlyEvidence: true,
      noPolicyMutation: true,
      noThresholdChange: true,
      noAutoAdoption: true,
      noRanking: true,
      requiresHumanReview: true,
    },
    ...overrides,
  };
}

function outcome(
  overrides: Partial<PolicyReviewOutcome> = {},
): PolicyReviewOutcome {
  return {
    outcomeId: "out-1",
    candidateId: "cand-1",
    candidateTitle: "Tighten calibration threshold",
    outcomeType: "accepted_for_policy_work",
    recordedAt: "2026-06-25T10:00:00.000Z",
    recordedBy: "governance-review",
    rationale: "Threshold adjusted per signal evidence.",
    evidenceRefs: ["ev-1"],
    candidateStateAtRecording: "closed",
    linkedEventIds: ["evt-1"],
    notes: "Approved for policy work.",
    createdAt: "2026-06-25T10:00:00.000Z",
    ...overrides,
  };
}

function trace(
  overrides: Partial<{
    outcomeId: string;
    candidateId: string;
    signalKind: string;
    outcomeType: string;
    timeToOutcomeDays: number;
  }> = {},
) {
  return {
    outcomeId: "out-1",
    candidateId: "cand-1",
    signalKind: "calibration_skew",
    outcomeType: "accepted_for_policy_work",
    timeToOutcomeDays: 10.5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Full input builder
// ---------------------------------------------------------------------------

function fullInput(
  overrides: Partial<BuildCompliancePackageInput> = {},
): BuildCompliancePackageInput {
  return {
    windowStart: ISO_A,
    windowEnd: ISO_B,
    generatedAt: GENERATED_AT,
    signals: [signal()],
    candidates: [candidate()],
    outcomes: [outcome()],
    traces: [trace()],
    correlationAnalytics: {
      signalToOutcomeCorrelations: [
        {
          signalKind: "calibration_skew",
          outcomeType: "accepted_for_policy_work",
          correlationStrength: 0.85,
          sampleSize: 12,
        },
      ],
      evidenceCoverage: { totalSignals: 10, withOutcome: 7, coverageRate: 0.7 },
      commonPatterns: ["calibration_skew → accepted_for_policy_work"],
    },
    keyExplanations: [
      {
        explanationId: "expl-1",
        type: "correlation",
        description: "Strong correlation between calibration_skew and accepted outcomes.",
        relatedIds: ["sig-1", "cand-1", "out-1"],
        confidence: 0.85,
      },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Governance-directive scanner (used by test 10)
// ---------------------------------------------------------------------------

const DIRECTIVE_WORDS = [
  "should",
  "must",
  "recommend",
  "suggest",
  "prioritize",
  "best",
  "likely",
  "expected",
  "improve",
  "optimize",
];

function assertNoGovernanceDirective(
  label: string,
  ...texts: string[]
): void {
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const word of DIRECTIVE_WORDS) {
      if (lower.includes(word)) {
        assert.fail(
          `${label} contains prohibited governance directive word "${word}": "${text.slice(0, 80)}"`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCompliancePackage (P29.2)", () => {
  it("complete package — all sections populated", () => {
    const input = fullInput();
    const pkg = buildCompliancePackage(input);

    // Package metadata
    assert.equal(typeof pkg.packageId, "string");
    assert.ok(pkg.packageId.length > 0);
    assert.equal(pkg.generatedAt, GENERATED_AT);
    assert.equal(pkg.windowStart, ISO_A);
    assert.equal(pkg.windowEnd, ISO_B);

    // Inventory
    assert.equal(pkg.totalSignals, 1);
    assert.equal(pkg.totalCandidates, 1);
    assert.equal(pkg.totalOutcomes, 1);
    assert.equal(pkg.totalTraces, 1);

    // Summaries
    assert.equal(pkg.signalSummary.length, 1);
    assert.equal(pkg.candidateSummary.length, 1);
    assert.equal(pkg.outcomeSummary.length, 1);
    assert.equal(pkg.traceSummary.length, 1);

    // Summary fields
    assert.equal(pkg.signalSummary[0].signalId, "sig-1");
    assert.equal(pkg.candidateSummary[0].candidateId, "cand-1");
    assert.equal(pkg.outcomeSummary[0].outcomeId, "out-1");
    assert.equal(pkg.traceSummary[0].outcomeId, "out-1");

    // Analytics & explanations
    assert.ok(pkg.correlationAnalytics);
    assert.equal(pkg.keyExplanations.length, 1);

    // Phases
    assert.deepEqual(pkg.phasesIncluded, ["P24", "P25", "P26", "P27", "P28"]);

    // Boundary flags
    assert.equal(pkg.readOnly, true);
    assert.equal(pkg.noPolicyMutation, true);
    assert.equal(pkg.noThresholdChange, true);
    assert.equal(pkg.noAutoAdoption, true);
    assert.equal(pkg.noRanking, true);
  });

  it("missing signals — partial evidence handling", () => {
    const input = fullInput({ signals: [] });
    const pkg = buildCompliancePackage(input);

    assert.equal(pkg.totalSignals, 0);
    assert.equal(pkg.signalSummary.length, 0);
    assert.equal(pkg.totalCandidates, 1);
    assert.equal(pkg.totalOutcomes, 1);
    assert.equal(pkg.totalTraces, 1);
    assert.equal(pkg.phasesIncluded.includes("P24"), false);
    assert.equal(pkg.phasesIncluded.includes("P25"), true);
    assert.equal(pkg.phasesIncluded.includes("P26"), true);
    assert.equal(pkg.phasesIncluded.includes("P27"), true);
    assert.equal(pkg.phasesIncluded.includes("P28"), true);
  });

  it("missing outcomes — partial lifecycle", () => {
    const input = fullInput({ outcomes: [], traces: [] });
    const pkg = buildCompliancePackage(input);

    assert.equal(pkg.totalSignals, 1);
    assert.equal(pkg.totalCandidates, 1);
    assert.equal(pkg.totalOutcomes, 0);
    assert.equal(pkg.totalTraces, 0);
    assert.equal(pkg.outcomeSummary.length, 0);
    assert.equal(pkg.traceSummary.length, 0);
    assert.equal(pkg.phasesIncluded.includes("P24"), true);
    assert.equal(pkg.phasesIncluded.includes("P25"), true);
    assert.equal(pkg.phasesIncluded.includes("P26"), false);
    assert.equal(pkg.phasesIncluded.includes("P27"), false);
    assert.equal(pkg.phasesIncluded.includes("P28"), true);
  });

  it("missing explanations — no failure", () => {
    const input = fullInput({ keyExplanations: [] });
    const pkg = buildCompliancePackage(input);

    assert.equal(pkg.keyExplanations.length, 0);
    assert.equal(pkg.phasesIncluded.includes("P28"), false);
    // Other phases still present
    assert.equal(pkg.phasesIncluded.includes("P24"), true);
    assert.equal(pkg.totalSignals, 1);
  });

  it("deterministic ID — replay stability", () => {
    const input = fullInput();
    const pkg1 = buildCompliancePackage(input);
    const pkg2 = buildCompliancePackage(input);

    assert.equal(pkg1.packageId, pkg2.packageId);
    // ID should be a 64-char hex SHA-256
    assert.match(pkg1.packageId, /^[0-9a-f]{64}$/);
  });

  it("counts match — inventory accuracy", () => {
    const input = fullInput({
      signals: [signal({ signalId: "sig-1" }), signal({ signalId: "sig-2" })],
      candidates: [candidate({ candidateId: "cand-1" }), candidate({ candidateId: "cand-2" }), candidate({ candidateId: "cand-3" })],
      outcomes: [outcome({ outcomeId: "out-1" }), outcome({ outcomeId: "out-2" })],
      traces: [trace({ outcomeId: "out-1" }), trace({ outcomeId: "out-2" }), trace({ outcomeId: "out-3" }), trace({ outcomeId: "out-4" })],
    });
    const pkg = buildCompliancePackage(input);

    assert.equal(pkg.totalSignals, 2);
    assert.equal(pkg.signalSummary.length, 2);
    assert.equal(pkg.totalCandidates, 3);
    assert.equal(pkg.candidateSummary.length, 3);
    assert.equal(pkg.totalOutcomes, 2);
    assert.equal(pkg.outcomeSummary.length, 2);
    assert.equal(pkg.totalTraces, 4);
    assert.equal(pkg.traceSummary.length, 4);
  });

  it("input immutability — no mutation", () => {
    const input = fullInput();
    const originalSignals = [...input.signals];
    const originalCandidates = [...input.candidates];
    const originalOutcomes = [...input.outcomes];
    const originalTraces = [...(input.traces as Array<unknown>)];

    buildCompliancePackage(input);

    assert.deepEqual(input.signals, originalSignals);
    assert.deepEqual(input.candidates, originalCandidates);
    assert.deepEqual(input.outcomes, originalOutcomes);
    assert.deepEqual(input.traces, originalTraces);
    assert.equal(input.windowStart, ISO_A);
    assert.equal(input.windowEnd, ISO_B);
    assert.equal(input.generatedAt, GENERATED_AT);
  });

  it("phase derivation — correct evidence discovery", () => {
    // Only signals
    const input1 = fullInput({
      candidates: [],
      outcomes: [],
      traces: [],
      keyExplanations: [],
    });
    assert.deepEqual(buildCompliancePackage(input1).phasesIncluded, ["P24"]);

    // Only outcomes
    const input2 = fullInput({
      signals: [],
      candidates: [],
      traces: [],
      keyExplanations: [],
    });
    assert.deepEqual(buildCompliancePackage(input2).phasesIncluded, ["P26"]);

    // Only explanations
    const input3 = fullInput({
      signals: [],
      candidates: [],
      outcomes: [],
      traces: [],
    });
    assert.deepEqual(buildCompliancePackage(input3).phasesIncluded, ["P28"]);

    // Empty — no phases
    const input4 = fullInput({
      signals: [],
      candidates: [],
      outcomes: [],
      traces: [],
      keyExplanations: [],
    });
    assert.deepEqual(buildCompliancePackage(input4).phasesIncluded, []);
  });

  it("package replay stability — same inputs produce deepEqual packages", () => {
    const input = fullInput();
    const pkg1 = buildCompliancePackage(input);
    const pkg2 = buildCompliancePackage(input);

    assert.deepEqual(pkg1, pkg2);
  });

  it("no governance directive language", () => {
    const input = fullInput();
    const pkg = buildCompliancePackage(input);

    // Check all summary text fields and descriptions
    for (const sig of pkg.signalSummary) {
      assertNoGovernanceDirective(
        `signalSummary[${sig.signalId}]`,
        sig.kind,
        sig.severity,
        sig.direction,
      );
    }
    for (const cand of pkg.candidateSummary) {
      assertNoGovernanceDirective(
        `candidateSummary[${cand.candidateId}]`,
        cand.title,
        cand.status,
        cand.signalKind,
        cand.signalSeverity,
      );
    }
    for (const out of pkg.outcomeSummary) {
      assertNoGovernanceDirective(
        `outcomeSummary[${out.outcomeId}]`,
        out.outcomeType,
        out.recordedBy,
        out.rationale,
      );
    }
    for (const trace of pkg.traceSummary) {
      assertNoGovernanceDirective(
        `traceSummary[${trace.outcomeId}]`,
        trace.signalKind,
        trace.outcomeType,
        String(trace.timeToOutcomeDays),
      );
    }
    for (const expl of pkg.keyExplanations) {
      assertNoGovernanceDirective(
        `keyExplanation[${expl.explanationId}]`,
        expl.type,
        expl.description,
      );
    }

    // Check correlation analytics
    for (const corr of pkg.correlationAnalytics.signalToOutcomeCorrelations) {
      assertNoGovernanceDirective(
        `correlation[${corr.signalKind}]`,
        corr.signalKind,
        corr.outcomeType,
      );
    }
    for (const pattern of pkg.correlationAnalytics.commonPatterns) {
      assertNoGovernanceDirective("commonPattern", pattern);
    }
  });
});
