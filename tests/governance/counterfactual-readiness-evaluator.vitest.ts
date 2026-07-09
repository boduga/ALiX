/**
 * P23.2 — Counterfactual Readiness Evaluator tests.
 *
 * Tests that the evaluator:
 * - produces deterministic outcomes for same dataset+scenario
 * - applies scenario assumptions only inside replay (no mutation)
 * - does not mutate readiness thresholds
 * - does not mutate source records
 * - handles missing evidence safely
 * - handles empty datasets
 * - produces readOnly: true output
 * - computes diff correctly
 * - generates appropriate candidate lessons
 */

import { describe, it, expect } from "vitest";

import { evaluateCounterfactual } from "../../src/governance/replay/counterfactual-readiness-evaluator.js";
import type {
  GovernanceReplayDataset,
  CounterfactualScenario,
} from "../../src/governance/replay/types.js";
import type { ExecutionReadinessLevel } from "../../src/governance/execution-readiness.js";

const VALID_ISO = "2026-07-08T18:00:00.000Z";

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function dataset(overrides: Partial<GovernanceReplayDataset> = {}): GovernanceReplayDataset {
  return {
    replayId: "test-replay-1",
    sourceLifecycleId: "lc-1",
    assembledAt: VALID_ISO,
    approvals: [],
    lifecycleTraces: [],
    readinessProjections: [],
    handoffs: [],
    closureReviews: [],
    closureIntelligence: [],
    sourceSummary: {
      approvalCount: 0,
      lifecycleTraceCount: 0,
      readinessProjectionCount: 0,
      handoffCount: 0,
      closureReviewCount: 0,
      closureIntelligenceCount: 0,
      sourceLifecycleIds: [],
    },
    ...overrides,
  };
}

function readinessProjection(level: ExecutionReadinessLevel, assessedAt: string = VALID_ISO) {
  return {
    assessmentId: "ra-1",
    planId: "plan-1",
    remediationId: "rem-1",
    approvalId: "appr-1",
    readinessLevel: level,
    facts: { mutationRequired: true, reversible: true, externalSideEffect: false, rollbackPlanPresent: true },
    reasonCodes: ["reversible_mutation"],
    assessedAt,
  };
}

function handoffRecord(captured: boolean) {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    remediationId: "rem-1",
    approvalId: "appr-1",
    title: "Update config",
    generatedAt: VALID_ISO,
    evidenceRequired: ["log_ref"],
    evidenceCaptured: captured,
    explicitlyManualOnly: true,
  };
}

function closureReview(decision: string, followUp: boolean = false) {
  return {
    closureReviewId: "cr-1",
    handoffId: "ho-1",
    decision,
    rationale: "Reviewed",
    reviewedBy: "rev-1",
    reviewedAt: VALID_ISO,
    evidenceIds: ["ev-1"],
    followUpRequired: followUp,
    followUpSummary: followUp ? "Needs follow-up" : null,
  };
}

function intelligenceRecord(severities: string[]) {
  return {
    handoffId: "ho-1",
    planId: "plan-1",
    qualitySignals: severities.map((s, i) => ({
      code: `signal-${i}`,
      severity: s,
      summary: `Quality signal ${i}`,
    })),
    calibrationSignal: null,
  };
}

function scenario(overrides: Partial<CounterfactualScenario> = {}): CounterfactualScenario {
  return {
    scenarioId: "scenario-1",
    name: "Strict evidence review",
    description: "Tests stricter evidence requirements",
    createdForReplayOnly: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("counterfactual-readiness-evaluator", () => {
  it("produces deterministic outcomes for same dataset and scenario", () => {
    const ds = dataset({
      readinessProjections: [readinessProjection("dry_run_capable")],
      handoffs: [handoffRecord(true)],
      closureReviews: [closureReview("accepted")],
    });
    const sc = scenario();

    const a = evaluateCounterfactual(ds, sc, { now: VALID_ISO });
    const b = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    expect(a.replayId).toBe(b.replayId);
    expect(a.scenarioId).toBe(b.scenarioId);
    expect(a.originalOutcome.readinessLevel).toBe(b.originalOutcome.readinessLevel);
    expect(a.counterfactualOutcome.readinessLevel).toBe(b.counterfactualOutcome.readinessLevel);
    expect(a.diff.category).toBe(b.diff.category);
    expect(a.riskDelta.direction).toBe(b.riskDelta.direction);
    expect(a.candidateLessons.length).toBe(b.candidateLessons.length);
  });

  it("does not mutate input dataset or scenario", () => {
    const ds = dataset({
      readinessProjections: [readinessProjection("dry_run_capable")],
      handoffs: [handoffRecord(true)],
    });
    const sc = scenario();
    const originalReadiness = ds.readinessProjections[0].readinessLevel;
    const originalScenarioId = sc.scenarioId;

    evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    // Dataset unchanged
    expect(ds.readinessProjections[0].readinessLevel).toBe(originalReadiness);
    expect(ds.sourceLifecycleId).toBe("lc-1");
    // Scenario unchanged
    expect(sc.scenarioId).toBe(originalScenarioId);
    expect(sc.createdForReplayOnly).toBe(true);
  });

  it("handles empty dataset gracefully", () => {
    const ds = dataset();
    const sc = scenario();

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    expect(result.originalOutcome.readinessLevel).toBeNull();
    expect(result.originalOutcome.evidenceCompleteness).toBe("none");
    expect(result.originalOutcome.handoffReadiness).toBe("not_ready");
    expect(result.originalOutcome.closureDecision).toBeNull();
    expect(result.originalOutcome.closureRiskLevel).toBe("low");
    expect(result.originalOutcome.qualitySignalCount).toBe(0);
    expect(result.originalOutcome.requiresAttention).toBe(false);
    expect(result.counterfactualOutcome.blocked).toBe(false);
    expect(result.candidateLessons).toHaveLength(0);
  });

  it("produces readOnly: true output", () => {
    const result = evaluateCounterfactual(dataset(), scenario(), { now: VALID_ISO });

    expect(result.readOnly).toBe(true);
  });

  it("computes original outcome correctly from dataset", () => {
    const ds = dataset({
      readinessProjections: [readinessProjection("dry_run_capable")],
      handoffs: [handoffRecord(true)],
      closureReviews: [closureReview("accepted")],
      closureIntelligence: [intelligenceRecord(["warning"])],
    });

    const result = evaluateCounterfactual(ds, scenario(), { now: VALID_ISO });

    expect(result.originalOutcome.readinessLevel).toBe("dry_run_capable");
    expect(result.originalOutcome.evidenceCompleteness).toBe("full");
    expect(result.originalOutcome.handoffReadiness).toBe("ready");
    expect(result.originalOutcome.closureDecision).toBe("accepted");
    expect(result.originalOutcome.closureRiskLevel).toBe("low");
    expect(result.originalOutcome.qualitySignalCount).toBe(1);
    expect(result.originalOutcome.requiresAttention).toBe(false);
  });

  it("flags requiresAttention for critical signals or rejected closure", () => {
    const ds = dataset({
      closureReviews: [closureReview("rejected")],
      closureIntelligence: [intelligenceRecord(["critical"])],
    });

    const result = evaluateCounterfactual(ds, scenario(), { now: VALID_ISO });

    expect(result.originalOutcome.closureDecision).toBe("rejected");
    expect(result.originalOutcome.closureRiskLevel).toBe("critical"); // critical signal elevates above high
    expect(result.originalOutcome.requiresAttention).toBe(true);
  });

  it("applies evidence assumptions inside counterfactual only", () => {
    const ds = dataset({
      handoffs: [handoffRecord(false)], // no evidence captured
    });
    const sc = scenario({
      evidenceAssumptions: {
        requireFullCompleteness: true,
      },
    });

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    // Original: partial (some evidence missing) — wait, no handoffs have evidence at all.
    // With 1 handoff and 0 captured: "none"
    expect(result.originalOutcome.evidenceCompleteness).toBe("none");
    // Counterfactual: requireFullCompleteness + not full → "incomplete"
    expect(result.counterfactualOutcome.evidenceCompleteness).toBe("incomplete");
  });

  it("applies closure assumptions inside counterfactual only", () => {
    const ds = dataset({
      closureReviews: [closureReview("needs_follow_up")],
    });
    const sc = scenario({
      closureAssumptions: {
        treatNeedsFollowUpAsUnresolved: true,
      },
    });

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    // Original: needs_follow_up
    expect(result.originalOutcome.closureDecision).toBe("needs_follow_up");
    // Counterfactual: treated as incomplete
    expect(result.counterfactualOutcome.closureDecision).toBe("incomplete");
  });

  it("recomputes risk from counterfactual closure decision when closure assumptions change outcome", () => {
    const ds = dataset({
      closureReviews: [closureReview("needs_follow_up")],
    });
    const sc = scenario({
      closureAssumptions: {
        treatNeedsFollowUpAsUnresolved: true,
      },
    });

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    // Original: needs_follow_up → medium risk
    expect(result.originalOutcome.closureDecision).toBe("needs_follow_up");
    expect(result.originalOutcome.closureRiskLevel).toBe("medium");
    // Counterfactual: incomplete → high risk (recomputed from new decision)
    expect(result.counterfactualOutcome.closureDecision).toBe("incomplete");
    expect(result.counterfactualOutcome.closureRiskLevel).toBe("high");
    // Risk delta should reflect the increase
    expect(result.riskDelta.direction).toBe("increased");
  });

  it("downgrades readiness when evidence is incomplete under strict assumption", () => {
    const ds = dataset({
      readinessProjections: [readinessProjection("dry_run_capable")],
      handoffs: [handoffRecord(false)], // no evidence captured
    });
    const sc = scenario({
      readinessAssumptions: {
        requireEvidenceCompleteness: true,
      },
    });

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    expect(result.originalOutcome.readinessLevel).toBe("dry_run_capable");
    // Downgraded one notch: dry_run_capable → manual_only
    expect(result.counterfactualOutcome.readinessLevel).toBe("manual_only");
  });

  it("computes risk delta when risk changes", () => {
    const ds = dataset({
      closureReviews: [closureReview("accepted")],
      handoffs: [handoffRecord(false)],
    });
    const sc = scenario({
      readinessAssumptions: {
        treatMissingClosureEvidenceAsUnresolved: true,
      },
    });

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    // Original: accepted + no quality signals → low risk
    expect(result.originalOutcome.closureRiskLevel).toBe("low");
    // Counterfactual: treatMissingClosureEvidenceAsUnresolved + none evidence → bumped
    expect(result.counterfactualOutcome.closureRiskLevel).toBe("medium");
    // Delta
    expect(result.riskDelta.direction).toBe("increased");
    expect(result.riskDelta.originalRisk).toBe("low");
    expect(result.riskDelta.counterfactualRisk).toBe("medium");
  });

  it("generates candidate lessons when outcomes differ", () => {
    const ds = dataset({
      readinessProjections: [readinessProjection("dry_run_capable")],
      handoffs: [handoffRecord(false)],
    });
    const sc = scenario({
      readinessAssumptions: {
        requireEvidenceCompleteness: true,
      },
    });

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    // Readiness changed → should generate a readiness lesson
    const readinessLessons = result.candidateLessons.filter(
      (l) => l.appliesTo === "readiness",
    );
    expect(readinessLessons.length).toBeGreaterThanOrEqual(1);
    expect(readinessLessons[0].requiresHumanReview).toBe(true);
    expect(readinessLessons[0].confidence).toBe("medium");
  });

  it("detects unchanged outcome when no assumptions change anything", () => {
    const ds = dataset({
      readinessProjections: [readinessProjection("manual_only")],
      handoffs: [handoffRecord(true)],
      closureReviews: [closureReview("accepted")],
    });
    const sc = scenario(); // no assumptions

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    expect(result.diff.category).toBe("unchanged");
    expect(result.diff.details.length).toBeGreaterThanOrEqual(1);
    expect(result.riskDelta.direction).toBe("unchanged");
  });

  it("blocks progression when blockedReasons exist", () => {
    const ds = dataset({
      readinessProjections: [readinessProjection("dry_run_capable")],
      handoffs: [],
      closureReviews: [],
    });
    const sc = scenario({
      readinessAssumptions: {
        requireHumanReviewBeforeStable: true,
      },
    });

    const result = evaluateCounterfactual(ds, sc, { now: VALID_ISO });

    // requireHumanReviewBeforeStable flags blocked
    expect(result.counterfactualOutcome.blocked).toBe(true);
    expect(result.counterfactualOutcome.blockedReasons.length).toBeGreaterThanOrEqual(1);
  });
});
