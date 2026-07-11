/**
 * P30.3 — Lineage CLI + Dispatch tests.
 *
 * 6 tests covering:
 *   1. show outputs lineage for existing candidate
 *   2. show handles unknown candidate gracefully (null-format output, not crash)
 *   3. list outputs index filtered by kind or outcome
 *   4. --json returns parseable JSON
 *   5. Cross-run determinism — buildLineageIndex twice with same dataset produces deepEqual results
 *   6. Object.freeze immutability — freeze all inputs before calling buildLineageIndex
 *
 * @module
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { handleGovernanceLineageCommand } from "../../src/cli/commands/governance-lineage.js";
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
// Test-data factories (each creates new object per call)
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

function makeCandidate(overrides: Partial<PolicyReviewCandidate> = {}): PolicyReviewCandidate {
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
    summary: "A test candidate for lineage CLI testing.",
    status: "under_review",
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    evidenceRefs: [],
    review: {
      reviewerId: "test-user",
      rationale: "Initial review.",
      notes: [],
      decisionBasis: [],
    },
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

function makeOutcome(overrides: Partial<PolicyReviewOutcome> = {}): PolicyReviewOutcome {
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

function makeTrace(overrides: Partial<DriftOutcomeTrace> = {}): DriftOutcomeTrace {
  return {
    outcomeId: "out-1",
    candidateId: "cand-1",
    signalKind: "calibration_skew",
    outcomeType: "accepted_for_policy_work",
    timeToOutcomeDays: 2,
    ...overrides,
  };
}

function makeExplanation(overrides: Partial<GovernanceExplanation> = {}): GovernanceExplanation {
  return {
    explanationId: "expl-1",
    type: "correlation",
    description: "Correlation between calibration skew and outcome.",
    relatedIds: ["cand-1"],
    confidence: 0.85,
    ...overrides,
  };
}

function makeCompliancePackage(overrides: Partial<CompliancePackage> = {}): CompliancePackage {
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
    executionEvidenceCount: 0,
    executionOutcomes: { success: 0, failed: 0, partial: 0 },
    executionSummary: [],
    phasesIncluded: ["P24", "P25", "P26", "P27"],
    readOnly: true as const,
    noPolicyMutation: true as const,
    noThresholdChange: true as const,
    noAutoAdoption: true as const,
    noRanking: true as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Temp directory helper
// ---------------------------------------------------------------------------

async function setupStoreDir(): Promise<string> {
  const dir = join(tmpdir(), `p30-lineage-test-${randomUUID()}`);
  const candidatesDir = join(dir, ".alix", "governance", "policy-review-candidates");
  const outcomesDir = join(dir, ".alix", "governance", "policy-review-outcomes");
  await mkdir(candidatesDir, { recursive: true });
  await mkdir(outcomesDir, { recursive: true });
  return dir;
}

async function writeCandidate(dir: string, candidate: PolicyReviewCandidate): Promise<void> {
  const path = join(dir, ".alix", "governance", "policy-review-candidates", `${candidate.candidateId}.json`);
  await writeFile(path, JSON.stringify(candidate));
}

async function writeOutcome(dir: string, outcome: PolicyReviewOutcome): Promise<void> {
  const path = join(dir, ".alix", "governance", "policy-review-outcomes", `${outcome.outcomeId}.json`);
  await writeFile(path, JSON.stringify(outcome));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("P30.3 — governance-lineage CLI", () => {
  // -----------------------------------------------------------------------
  // Test 1: show outputs lineage for existing candidate
  // -----------------------------------------------------------------------

  it("should show lineage for existing candidate", async () => {
    const dir = await setupStoreDir();
    try {
      const cand = makeCandidate();
      const outc = makeOutcome();
      await writeCandidate(dir, cand);
      await writeOutcome(dir, outc);

      const output = await handleGovernanceLineageCommand(
        ["show", "cand-1"],
        { cwd: dir },
      );

      assert.ok(output.includes("cand-1"), "output should contain candidateId");
      assert.ok(output.includes("Test Candidate"), "output should contain candidate title");
      assert.ok(output.includes("accepted_for_policy_work"), "output should contain outcomeType");
      assert.ok(output.includes("P24"), "output should mention P24 phase");
      assert.ok(output.includes("P25"), "output should mention P25 phase");
      assert.ok(output.includes("P26"), "output should mention P26 phase");
      assert.ok(output.includes("readOnly"), "output should mention readOnly boundary flag");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Test 2: show handles unknown candidate gracefully (null-format, not crash)
  // -----------------------------------------------------------------------

  it("should handle unknown candidate gracefully (null-format, not crash)", async () => {
    const dir = await setupStoreDir();
    try {
      const output = await handleGovernanceLineageCommand(
        ["show", "cand-unknown"],
        { cwd: dir },
      );

      assert.ok(output.includes("not found"), "output should indicate candidate not found");
      assert.ok(output.includes("cand-unknown"), "output should mention the unknown candidateId");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Test 3: list outputs index filtered by kind or outcome
  // -----------------------------------------------------------------------

  it("should list lineage records filtered by kind or outcome", async () => {
    const dir = await setupStoreDir();
    try {
      // Two candidates with matching signals
      const sig1 = makeSignal({ signalId: "sig-a", kind: "calibration_skew" });
      const sig2 = makeSignal({ signalId: "sig-b", kind: "replay_divergence" });

      const cand1 = makeCandidate({ candidateId: "cand-a", source: { phase: "P24", signalId: "sig-a", signalKind: "calibration_skew", signalSeverity: "medium", signalDirection: "too_loose", windowStart: ISO_A, windowEnd: ISO_B }, title: "Candidate A", status: "under_review", createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-03T00:00:00.000Z", evidenceRefs: [], review: { reviewerId: undefined, rationale: undefined, notes: [], decisionBasis: [] }, boundaries: { readOnlyEvidence: true as const, noPolicyMutation: true as const, noThresholdChange: true as const, noAutoAdoption: true as const, noRanking: true as const, requiresHumanReview: true as const } });
      const cand2 = makeCandidate({ candidateId: "cand-b", source: { phase: "P24", signalId: "sig-b", signalKind: "replay_divergence", signalSeverity: "high", signalDirection: "too_strict", windowStart: ISO_A, windowEnd: ISO_B }, title: "Candidate B", status: "proposed", createdAt: "2026-07-02T00:00:00.000Z", updatedAt: "2026-07-02T00:00:00.000Z", evidenceRefs: [], review: { reviewerId: undefined, rationale: undefined, notes: [], decisionBasis: [] }, boundaries: { readOnlyEvidence: true as const, noPolicyMutation: true as const, noThresholdChange: true as const, noAutoAdoption: true as const, noRanking: true as const, requiresHumanReview: true as const } });
      const out1 = makeOutcome({ outcomeId: "out-a", candidateId: "cand-a", outcomeType: "accepted_for_policy_work" });
      const out2 = makeOutcome({ outcomeId: "out-b", candidateId: "cand-b", outcomeType: "dismissed_no_change" });

      await writeCandidate(dir, cand1);
      await writeCandidate(dir, cand2);
      await writeOutcome(dir, out1);
      await writeOutcome(dir, out2);

      // Write P24 bundle with two signals
      const bundlePath = join(dir, "p24-bundle.json");
      await writeFile(bundlePath, JSON.stringify({ signals: [sig1, sig2] }));

      // Filter by kind=calibration_skew
      const kindOutput = await handleGovernanceLineageCommand(
        ["list", "--kind", "calibration_skew", "--p24-bundle", bundlePath],
        { cwd: dir },
      );
      assert.ok(kindOutput.includes("cand-a"), "should include cand-a for calibration_skew");
      assert.ok(!kindOutput.includes("cand-b"), "should NOT include cand-b for calibration_skew filter");

      // Filter by outcome=dismissed_no_change
      const outcomeOutput = await handleGovernanceLineageCommand(
        ["list", "--outcome", "dismissed_no_change", "--p24-bundle", bundlePath],
        { cwd: dir },
      );
      assert.ok(outcomeOutput.includes("cand-b"), "should include cand-b for dismissed_no_change");
      assert.ok(!outcomeOutput.includes("cand-a"), "should NOT include cand-a for dismissed_no_change filter");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Test 4: --json returns parseable JSON
  // -----------------------------------------------------------------------

  it("should return parseable JSON when --json is set", async () => {
    const dir = await setupStoreDir();
    try {
      const cand = makeCandidate();
      await writeCandidate(dir, cand);

      // Test show --json
      const jsonShow = await handleGovernanceLineageCommand(
        ["show", "cand-1", "--json"],
        { cwd: dir },
      );
      const parsed = JSON.parse(jsonShow);
      assert.ok(parsed !== null && typeof parsed === "object", "show --json should produce valid JSON object");
      assert.equal(parsed.candidateRef?.candidateId, "cand-1");
      assert.equal(parsed.phasePresence.p25, true);

      // Test unknown candidate --json
      const jsonUnknown = await handleGovernanceLineageCommand(
        ["show", "cand-unknown", "--json"],
        { cwd: dir },
      );
      const parsedUnknown = JSON.parse(jsonUnknown);
      assert.equal(parsedUnknown.found, false);
      assert.equal(parsedUnknown.candidateId, "cand-unknown");

      // Test list --json
      const jsonList = await handleGovernanceLineageCommand(
        ["list", "--json"],
        { cwd: dir },
      );
      const parsedList = JSON.parse(jsonList);
      assert.ok(Array.isArray(parsedList.lineageIds), "list --json should include lineageIds array");
      assert.ok(typeof parsedList.count === "number", "list --json should include count");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // -----------------------------------------------------------------------
  // Test 5: Cross-run determinism — buildLineageIndex twice with same
  //         dataset produces deepEqual results
  // -----------------------------------------------------------------------

  it("should produce deepEqual LineageIndex across separate builds", () => {
    const cand = makeCandidate({ candidateId: "cand-det" });

    const index1 = buildLineageIndex({
      signals: [],
      candidates: [cand],
      outcomes: [],
      traces: [],
      explanations: [],
      compliancePackages: [],
      executionEvidence: [],
      executionLineageRefs: [],
    });
    const index2 = buildLineageIndex({
      signals: [],
      candidates: [cand],
      outcomes: [],
      traces: [],
      explanations: [],
      compliancePackages: [],
      executionEvidence: [],
      executionLineageRefs: [],
    });

    const rec1 = buildLineageRecord("cand-det", index1);
    const rec2 = buildLineageRecord("cand-det", index2);
    assert(rec1 !== null);
    assert(rec2 !== null);

    assert.deepEqual(rec1, rec2);
    assert.equal(rec1.lineageId, rec2.lineageId);
  });

  // -----------------------------------------------------------------------
  // Test 6: Object.freeze immutability — freeze all inputs before calling
  //         buildLineageIndex, verify no mutation
  // -----------------------------------------------------------------------

  it("must not throw when inputs are frozen", () => {
    const sig = Object.freeze(makeSignal());
    const cand = Object.freeze(makeCandidate({ candidateId: "cand-immut" }));
    const outc = Object.freeze(makeOutcome({ candidateId: "cand-immut" }));
    const tr = Object.freeze(makeTrace({ candidateId: "cand-immut" }));
    const expl = Object.freeze(makeExplanation({ relatedIds: ["cand-immut"] }));
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

    // Should not throw when frozen inputs are passed
    const index = buildLineageIndex({
      signals: [sig],
      candidates: [cand],
      outcomes: [outc],
      traces: [tr],
      explanations: [expl],
      compliancePackages: [pkg],
      executionEvidence: [],
      executionLineageRefs: [],
    });

    const record = buildLineageRecord("cand-immut", index);
    assert(record !== null);
    assert.equal(record.phasePresence.p24, true);
    assert.equal(record.phasePresence.p25, true);
  });
});
