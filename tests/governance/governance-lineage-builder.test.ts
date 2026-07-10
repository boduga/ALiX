/**
 * P30.2 — Lineage Builder tests.
 *
 * 7 tests covering full lineage, partial lineage, index correctness,
 * unknown candidate, signalKind peers, deterministic lineageId, and
 * input immutability.
 *
 * @module
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  buildLineageIndex,
  buildLineageRecord,
} from "../../src/governance/governance-lineage-builder.js";

import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";
import type { PolicyReviewCandidate } from "../../src/governance/policy-review-candidate-types.js";
import type { PolicyReviewOutcome } from "../../src/governance/policy-review-outcome-types.js";
import type { DriftOutcomeTrace } from "../../src/governance/governance-reporting-builder.js";
import type { GovernanceExplanation } from "../../src/governance/governance-reporting-types.js";
import type { CompliancePackage } from "../../src/governance/governance-reporting-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISO_A = "2026-06-01T00:00:00.000Z";
const ISO_B = "2026-07-01T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Test-data factories (each creates a new object per call)
// ---------------------------------------------------------------------------

function makeSignal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "sig-1",
    kind: "calibration_skew",
    windowStart: ISO_A,
    windowEnd: ISO_B,
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: {
      p22CalibrationCount: 20,
      p23ReplayCount: 15,
      pairedLifecycleCount: 10,
    },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: ["calibration"],
    evidenceRefs: [{ source: "p22_calibration", lifecycleId: "life-1" }],
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

function makeCandidate(
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
    title: "Test Candidate",
    summary: "A test candidate for lineage builder tests.",
    status: "under_review",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    evidenceRefs: [],
    review: { notes: [], decisionBasis: [] },
    boundaries: {
      readOnlyEvidence: true as const,
      noPolicyMutation: true as const,
      noThresholdChange: true as const,
      noAutoAdoption: true as const,
      noRanking: true as const,
      requiresHumanReview: true as const,
    },
    ...overrides,
  };
}

function makeOutcome(
  overrides: Partial<PolicyReviewOutcome> = {},
): PolicyReviewOutcome {
  return {
    outcomeId: "out-1",
    candidateId: "cand-1",
    candidateTitle: "Test Candidate",
    outcomeType: "accepted_for_policy_work",
    recordedAt: "2026-07-04T00:00:00.000Z",
    recordedBy: "test-user",
    rationale: "Approved after review.",
    evidenceRefs: [],
    candidateStateAtRecording: "under_review",
    linkedEventIds: [],
    notes: "",
    createdAt: "2026-07-04T00:00:00.000Z",
    ...overrides,
  };
}

function makeTrace(
  overrides: Partial<DriftOutcomeTrace> = {},
): DriftOutcomeTrace {
  return {
    outcomeId: "out-1",
    candidateId: "cand-1",
    signalKind: "calibration_skew",
    outcomeType: "accepted_for_policy_work",
    timeToOutcomeDays: 2,
    ...overrides,
  };
}

function makeExplanation(
  overrides: Partial<GovernanceExplanation> = {},
): GovernanceExplanation {
  return {
    explanationId: "expl-1",
    type: "correlation",
    description: "Correlation between calibration skew and outcome.",
    relatedIds: ["cand-1"],
    confidence: 0.85,
    ...overrides,
  };
}

function makeCompliancePackage(
  overrides: Partial<CompliancePackage> = {},
): CompliancePackage {
  return {
    packageId: "pkg-1",
    generatedAt: ISO_B,
    windowStart: ISO_A,
    windowEnd: ISO_B,
    totalSignals: 1,
    totalCandidates: 1,
    totalOutcomes: 1,
    totalTraces: 1,
    signalSummary: [],
    candidateSummary: [],
    outcomeSummary: [],
    traceSummary: [
      {
        outcomeId: "out-1",
        candidateId: "cand-1",
        signalKind: "calibration_skew",
        outcomeType: "accepted_for_policy_work",
        timeToOutcomeDays: 2,
      },
    ],
    correlationAnalytics: {
      signalToOutcomeCorrelations: [],
      evidenceCoverage: { totalSignals: 1, withOutcome: 1, coverageRate: 1 },
      commonPatterns: [],
    },
    keyExplanations: [],
    phasesIncluded: ["P24", "P25", "P26", "P27"],
    readOnly: true as const,
    noPolicyMutation: true as const,
    noThresholdChange: true as const,
    noAutoAdoption: true as const,
    noRanking: true as const,
    ...overrides,
  };
}

/** Helper to compute expected lineageId for a candidate. */
function expectedLineageId(candidateId: string): string {
  return createHash("sha256")
    .update("alix:p30:lineage:" + candidateId)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceLineageBuilder", () => {
  // -----------------------------------------------------------------------
  // Test 1: Full lineage for candidate with all phases populated
  // -----------------------------------------------------------------------

  it("should build a complete lineage record when all 6 phases have data", () => {
    const sig = makeSignal();
    const cand = makeCandidate();
    const outc = makeOutcome();
    const tr = makeTrace();
    const expl = makeExplanation();
    const pkg = makeCompliancePackage();

    const index = buildLineageIndex({
      signals: [sig],
      candidates: [cand],
      outcomes: [outc],
      traces: [tr],
      explanations: [expl],
      compliancePackages: [pkg],
    });

    const record = buildLineageRecord(cand.candidateId, index);
    assert.notEqual(record, null);
    assert(record !== null);

    // lineageId
    const lid = expectedLineageId(cand.candidateId);
    assert.equal(record.lineageId, lid);

    // phasePresence — all true
    assert.equal(record.phasePresence.p24, true);
    assert.equal(record.phasePresence.p25, true);
    assert.equal(record.phasePresence.p26, true);
    assert.equal(record.phasePresence.p27, true);
    assert.equal(record.phasePresence.p28, true);
    assert.equal(record.phasePresence.p29, true);

    // Shallow refs — all present
    assert.notEqual(record.signalRef, undefined);
    assert.equal(record.signalRef!.signalId, "sig-1");
    assert.equal(record.signalRef!.signalKind, "calibration_skew");
    assert.equal(record.signalRef!.windowEnd, ISO_B);

    assert.notEqual(record.candidateRef, undefined);
    assert.equal(record.candidateRef!.candidateId, "cand-1");
    assert.equal(record.candidateRef!.title, "Test Candidate");
    assert.equal(record.candidateRef!.status, "under_review");

    assert.notEqual(record.outcomeRef, undefined);
    assert.equal(record.outcomeRef!.outcomeId, "out-1");
    assert.equal(record.outcomeRef!.candidateId, "cand-1");
    assert.equal(record.outcomeRef!.outcomeType, "accepted_for_policy_work");

    assert.notEqual(record.traceRef, undefined);
    assert.equal(record.traceRef!.outcomeId, "out-1");
    assert.equal(record.traceRef!.candidateId, "cand-1");
    assert.equal(record.traceRef!.signalKind, "calibration_skew");

    assert.notEqual(record.explanationRef, undefined);
    assert.equal(record.explanationRef!.explanationId, "expl-1");
    assert.equal(record.explanationRef!.type, "correlation");

    assert.notEqual(record.complianceRef, undefined);
    assert.equal(record.complianceRef!.packageId, "pkg-1");
    assert.equal(record.complianceRef!.windowStart, ISO_A);
    assert.equal(record.complianceRef!.windowEnd, ISO_B);

    // Boundary flags
    assert.equal(record.readOnly, true);
    assert.equal(record.noPolicyMutation, true);
    assert.equal(record.noThresholdChange, true);
    assert.equal(record.noAutoAdoption, true);
    assert.equal(record.noRanking, true);
  });

  // -----------------------------------------------------------------------
  // Test 2: Partial lineage — candidate only, no phase data
  // -----------------------------------------------------------------------

  it("should build a partial lineage with only p25 populated", () => {
    const cand = makeCandidate({ candidateId: "cand-partial" });

    const index = buildLineageIndex({
      signals: [],
      candidates: [cand],
      outcomes: [],
      traces: [],
      explanations: [],
    });

    const record = buildLineageRecord(cand.candidateId, index);
    assert.notEqual(record, null);
    assert(record !== null);

    // lineageId
    const lid = expectedLineageId(cand.candidateId);
    assert.equal(record.lineageId, lid);

    // phasePresence — only p25 true
    assert.equal(record.phasePresence.p24, false);
    assert.equal(record.phasePresence.p25, true);
    assert.equal(record.phasePresence.p26, false);
    assert.equal(record.phasePresence.p27, false);
    assert.equal(record.phasePresence.p28, false);
    assert.equal(record.phasePresence.p29, false);

    // candidateRef present
    assert.notEqual(record.candidateRef, undefined);
    assert.equal(record.candidateRef!.candidateId, "cand-partial");

    // Other refs are undefined
    assert.equal(record.signalRef, undefined);
    assert.equal(record.outcomeRef, undefined);
    assert.equal(record.traceRef, undefined);
    assert.equal(record.explanationRef, undefined);
    assert.equal(record.complianceRef, undefined);
  });

  // -----------------------------------------------------------------------
  // Test 3: LineageIndex maps built correctly from input data
  // -----------------------------------------------------------------------

  it("should populate all 4 index maps correctly", () => {
    const sigA = makeSignal({ signalId: "sig-a", kind: "calibration_skew" });
    const sigB = makeSignal({
      signalId: "sig-b",
      kind: "replay_divergence",
    });

    const candA = makeCandidate({
      candidateId: "cand-a",
      source: {
        phase: "P24",
        signalId: "sig-a",
        signalKind: "calibration_skew",
        signalSeverity: "medium",
        signalDirection: "too_loose",
        windowStart: ISO_A,
        windowEnd: ISO_B,
      },
      title: "Candidate A",
      status: "under_review",
    });
    const candB = makeCandidate({
      candidateId: "cand-b",
      source: {
        phase: "P24",
        signalId: "sig-b",
        signalKind: "replay_divergence",
        signalSeverity: "high",
        signalDirection: "too_strict",
        windowStart: ISO_A,
        windowEnd: ISO_B,
      },
      title: "Candidate B",
      status: "proposed",
    });

    const outcA = makeOutcome({
      outcomeId: "out-a",
      candidateId: "cand-a",
      outcomeType: "accepted_for_policy_work",
    });
    const outcB = makeOutcome({
      outcomeId: "out-b",
      candidateId: "cand-b",
      outcomeType: "dismissed_no_change",
    });

    const pkg = makeCompliancePackage({
      packageId: "pkg-a",
      traceSummary: [
        {
          outcomeId: "out-a",
          candidateId: "cand-a",
          signalKind: "calibration_skew",
          outcomeType: "accepted_for_policy_work",
          timeToOutcomeDays: 2,
        },
      ],
    });

    const index = buildLineageIndex({
      signals: [sigA, sigB],
      candidates: [candA, candB],
      outcomes: [outcA, outcB],
      traces: [],
      explanations: [],
      compliancePackages: [pkg],
    });

    const lidA = expectedLineageId("cand-a");
    const lidB = expectedLineageId("cand-b");

    // byCandidateId
    assert.deepEqual(index.byCandidateId.get("cand-a"), [lidA]);
    assert.deepEqual(index.byCandidateId.get("cand-b"), [lidB]);

    // bySignalKind
    assert.deepEqual(index.bySignalKind.get("calibration_skew"), [lidA]);
    assert.deepEqual(index.bySignalKind.get("replay_divergence"), [lidB]);

    // byOutcomeType
    assert.deepEqual(index.byOutcomeType.get("accepted_for_policy_work"), [
      lidA,
    ]);
    assert.deepEqual(index.byOutcomeType.get("dismissed_no_change"), [lidB]);

    // byCompliancePackageId
    assert.deepEqual(index.byCompliancePackageId.get("pkg-a"), [lidA]);
  });

  // -----------------------------------------------------------------------
  // Test 4: buildLineageRecord returns null for unknown candidateId
  // -----------------------------------------------------------------------

  it("should return null for a candidateId not in the index", () => {
    const cand = makeCandidate({ candidateId: "cand-exists" });
    const index = buildLineageIndex({
      signals: [],
      candidates: [cand],
      outcomes: [],
      traces: [],
      explanations: [],
    });

    const result = buildLineageRecord("cand-unknown", index);
    assert.equal(result, null);
  });

  // -----------------------------------------------------------------------
  // Test 5: relatedCandidates derived from signalKind peers
  // -----------------------------------------------------------------------

  it("should group lineageIds by signalKind for peer detection", () => {
    const sig1 = makeSignal({
      signalId: "sig-1",
      kind: "calibration_skew",
    });
    const sig2 = makeSignal({
      signalId: "sig-2",
      kind: "calibration_skew",
    });
    const sig3 = makeSignal({
      signalId: "sig-3",
      kind: "replay_divergence",
    });

    const cand1 = makeCandidate({
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
      title: "Candidate 1",
      status: "under_review",
    });
    const cand2 = makeCandidate({
      candidateId: "cand-2",
      source: {
        phase: "P24",
        signalId: "sig-2",
        signalKind: "calibration_skew",
        signalSeverity: "low",
        signalDirection: "too_loose",
        windowStart: ISO_A,
        windowEnd: ISO_B,
      },
      title: "Candidate 2",
      status: "proposed",
    });
    const cand3 = makeCandidate({
      candidateId: "cand-3",
      source: {
        phase: "P24",
        signalId: "sig-3",
        signalKind: "replay_divergence",
        signalSeverity: "high",
        signalDirection: "too_strict",
        windowStart: ISO_A,
        windowEnd: ISO_B,
      },
      title: "Candidate 3",
      status: "dismissed",
    });

    const index = buildLineageIndex({
      signals: [sig1, sig2, sig3],
      candidates: [cand1, cand2, cand3],
      outcomes: [],
      traces: [],
      explanations: [],
    });

    const lid1 = expectedLineageId("cand-1");
    const lid2 = expectedLineageId("cand-2");
    const lid3 = expectedLineageId("cand-3");

    // calibration_skew groups cand-1 and cand-2
    const calPeers = index.bySignalKind.get("calibration_skew");
    assert.notEqual(calPeers, undefined);
    assert.equal(calPeers!.includes(lid1), true);
    assert.equal(calPeers!.includes(lid2), true);
    assert.equal(calPeers!.includes(lid3), false);

    // replay_divergence groups only cand-3
    const repPeers = index.bySignalKind.get("replay_divergence");
    assert.notEqual(repPeers, undefined);
    assert.deepEqual(repPeers, [lid3]);
  });

  // -----------------------------------------------------------------------
  // Test 6: Deterministic lineageId (SHA-256 of namespace + candidateId)
  // -----------------------------------------------------------------------

  it("should produce deterministic lineageIds across separate builds", () => {
    const cand = makeCandidate({ candidateId: "cand-det" });

    const index1 = buildLineageIndex({
      signals: [],
      candidates: [cand],
      outcomes: [],
      traces: [],
      explanations: [],
    });
    const index2 = buildLineageIndex({
      signals: [],
      candidates: [cand],
      outcomes: [],
      traces: [],
      explanations: [],
    });

    const rec1 = buildLineageRecord("cand-det", index1);
    const rec2 = buildLineageRecord("cand-det", index2);
    assert(rec1 !== null);
    assert(rec2 !== null);

    assert.equal(rec1.lineageId, rec2.lineageId);

    // Also verify against expected hash
    const expected = expectedLineageId("cand-det");
    assert.equal(rec1.lineageId, expected);
    assert.equal(rec2.lineageId, expected);
  });

  // -----------------------------------------------------------------------
  // Test 7: Immutability guard — frozen inputs do not throw
  // -----------------------------------------------------------------------

  it("must not throw or mutate when inputs are frozen", () => {
    const sig = Object.freeze(makeSignal());
    const cand = Object.freeze(makeCandidate({ candidateId: "cand-immut" }));
    const outc = Object.freeze(
      makeOutcome({ candidateId: "cand-immut" }),
    );
    const tr = Object.freeze(
      makeTrace({ candidateId: "cand-immut" }),
    );
    const expl = Object.freeze(
      makeExplanation({ relatedIds: ["cand-immut"] }),
    );
    const pkg = Object.freeze(
      makeCompliancePackage({
        traceSummary: [
          {
            outcomeId: "out-immut",
            candidateId: "cand-immut",
            signalKind: "calibration_skew",
            outcomeType: "accepted_for_policy_work",
            timeToOutcomeDays: 1,
          },
        ],
      }),
    );

    // Must not throw
    assert.doesNotThrow(() => {
      buildLineageIndex({
        signals: [sig],
        candidates: [cand],
        outcomes: [outc],
        traces: [tr],
        explanations: [expl],
        compliancePackages: [pkg],
      });
    });

    // Verify originals are unchanged (freeze ensures structural immutability)
    assert.equal(sig.signalId, "sig-1");
    assert.equal(cand.candidateId, "cand-immut");
    assert.equal(outc.outcomeId, "out-1");
    assert.equal(tr.outcomeId, "out-1");
    assert.equal(expl.explanationId, "expl-1");
    assert.equal(pkg.packageId, "pkg-1");
  });
});
