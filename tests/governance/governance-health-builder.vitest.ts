/**
 * P9.0b — GovernanceHealthBuilder + GovernanceAssessment tests.
 *
 * 4 tests:
 *   1. Empty stores → empty health report (all counts zero).
 *   2. Seeded stores → correct measurements (totalReviews, totalProposals,
 *      lensEffectiveness match seeded data).
 *   3. buildGovernanceAssessment returns low confidence from a weak HealthReport.
 *   4. buildGovernanceAssessment returns high confidence from a perfect HealthReport.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildGovernanceHealth } from "../../src/governance/governance-health-builder.js";
import { buildGovernanceAssessment } from "../../src/governance/governance-assessment.js";
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import { GovernanceReviewStore } from "../../src/adaptation/governance-review-store.js";
import { LearningStore } from "../../src/learning/learning-store.js";
import type { GovernanceHealthReport } from "../../src/governance/governance-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
const GOV_REVIEWS_DIR = join(".alix", "governance-reviews");
const LEARNING_DIR = join(".alix", "learning");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-health-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recentISO(offsetMinutes = 0): string {
  return new Date(Date.now() - offsetMinutes * 60_000).toISOString();
}

/** Create a minimal valid outcome record for seeding. */
function seedOutcome(id: string, subjectId: string) {
  return {
    id,
    subject: "Test proposal",
    outcome: "success",
    reasons: [],
    generatedAt: recentISO(),
    subjectId,
    subjectType: "proposal",
    actionTaken: "test action",
    observationWindowDays: 7,
  };
}

/** Create a minimal valid governance review for seeding. */
function seedReview(id: string, proposalId: string) {
  return {
    id,
    subject: "Test review",
    outcome: "reviewed",
    confidence: 0.8,
    reasons: ["test"],
    generatedAt: recentISO(),
    recommendationId: "rec-1",
    proposalId,
    verdict: "needs_discussion",
    concerns: ["test concern"],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores: [
      { lens: "policy_auditor", score: 0.7, reason: "ok" },
    ],
    councilVote: { approve: 1, reject: 0, abstain: 3 },
    sourceArtifacts: [{ id: "sa-1", kind: "outcome", layer: "outcome" }],
  };
}

/** Create a minimal calibration profile for a governance lens. */
function seedLensProfile(id: string, targetName: string, confidence: number) {
  return {
    id,
    subject: "Lens calibration",
    outcome: "profile_generated",
    confidence,
    reasons: ["signal-based"],
    generatedAt: recentISO(),
    target: "governance_lens_weight",
    targetName,
    previousValue: 0.5,
    suggestedValue: confidence,
    reason: "Calibrated from signals",
    evidenceRefs: [],
    sourceSignalIds: [],
  };
}

// ---------------------------------------------------------------------------
// Test 1: Empty stores
// ---------------------------------------------------------------------------

describe("buildGovernanceHealth", () => {
  it("returns empty health report when no P8 data exists (all stores empty)", async () => {
    const report = await buildGovernanceHealth({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(report.reportType).toBe("governance_health");
    expect(report.totalReviews).toBe(0);
    expect(report.totalProposals).toBe(0);
    expect(report.sourceMetrics.dashboardIntegrityScore).toBe(0);
    expect(report.sourceMetrics.incompleteChainLayers).toBe(0);
    expect(Object.keys(report.lensEffectiveness).length).toBe(0);
    expect(report.policyCoverage).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Seeded stores
  // ---------------------------------------------------------------------------

  it("returns correct measurements when P8 data is seeded", async () => {
    // Seed OutcomeStore: 3 unique subjectIds (prop-a, prop-b, prop-c)
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append(seedOutcome("out-1", "prop-a") as any);
    await outcomeStore.append(seedOutcome("out-2", "prop-b") as any);
    await outcomeStore.append(seedOutcome("out-3", "prop-a") as any); // duplicate subjectId — should still count as 1
    await outcomeStore.append(seedOutcome("out-4", "prop-c") as any);

    // Seed GovernanceReviewStore: 5 reviews
    const reviewStore = new GovernanceReviewStore(join(tempRoot, GOV_REVIEWS_DIR));
    await reviewStore.append(seedReview("gr-1", "prop-a") as any);
    await reviewStore.append(seedReview("gr-2", "prop-b") as any);
    await reviewStore.append(seedReview("gr-3", "prop-a") as any);
    await reviewStore.append(seedReview("gr-4", "prop-c") as any);
    await reviewStore.append(seedReview("gr-5", "prop-d") as any);

    // Seed LearningStore: 3 calibration profiles for governance lenses
    const learningStore = new LearningStore(join(tempRoot, LEARNING_DIR));
    await learningStore.appendProfile(seedLensProfile("cp-1", "red_team", 0.72) as any);
    await learningStore.appendProfile(seedLensProfile("cp-2", "policy_auditor", 0.85) as any);
    await learningStore.appendProfile(seedLensProfile("cp-3", "historian", 0.48) as any);

    const report = await buildGovernanceHealth({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    // totalReviews: 5 reviews seeded
    expect(report.totalReviews).toBe(5);

    // totalProposals: 3 unique subjectIds (prop-a, prop-b, prop-c)
    expect(report.totalProposals).toBe(3);

    // lensEffectiveness: 3 lenses with predictive values
    expect(Object.keys(report.lensEffectiveness).length).toBe(3);
    expect(report.lensEffectiveness["red_team"]).toBe(72);
    expect(report.lensEffectiveness["policy_auditor"]).toBe(85);
    expect(report.lensEffectiveness["historian"]).toBe(48);

    // sourceMetrics should exist (even if dashboard scans produce low values)
    expect(report.sourceMetrics).toBeDefined();
    expect(typeof report.sourceMetrics.dashboardIntegrityScore).toBe("number");
    expect(typeof report.sourceMetrics.incompleteChainLayers).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Test 3: buildGovernanceAssessment — low confidence
// ---------------------------------------------------------------------------

describe("buildGovernanceAssessment", () => {
  it("returns low confidence from a weak GovernanceHealthReport", () => {
    const weakReport: GovernanceHealthReport = {
      id: "gh-weak",
      subject: "Governance Health",
      outcome: "computed",
      confidence: 1,
      reasons: ["test"],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_health",
      totalReviews: 20,
      totalProposals: 5,
      lensEffectiveness: { red_team: 30, policy_auditor: 25 },
      policyCoverage: 35,
      sourceMetrics: {
        dashboardIntegrityScore: 30,
        explanationCompleteness: 20,
        evidenceChainUsage: 15,
        incompleteChainLayers: 12,
      },
    };

    const assessment = buildGovernanceAssessment(weakReport);

    expect(assessment.reportType).toBe("governance_assessment");
    // governanceConfidence = 30/100*0.4 + 20/100*0.3 + 15/100*0.3
    // = 0.12 + 0.06 + 0.045 = 0.225
    expect(assessment.governanceConfidence).toBeCloseTo(0.225, 3);

    // unresolvedGovernanceIssues = 12 + max(0, 20-5) = 12 + 15 = 27
    expect(assessment.unresolvedGovernanceIssues).toBe(27);

    // Should have assessment notes
    expect(assessment.assessmentNotes.length).toBeGreaterThan(0);
    // Confidence should be low
    expect(assessment.governanceConfidence).toBeLessThan(0.5);

    // Should mention low confidence
    const hasLowNote = assessment.assessmentNotes.some((n) =>
      n.toLowerCase().includes("low"),
    );
    expect(hasLowNote).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Test 4: buildGovernanceAssessment — high confidence
  // ---------------------------------------------------------------------------

  it("returns high confidence from a perfect GovernanceHealthReport", () => {
    const perfectReport: GovernanceHealthReport = {
      id: "gh-perfect",
      subject: "Governance Health",
      outcome: "computed",
      confidence: 1,
      reasons: ["test"],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_health",
      totalReviews: 8,
      totalProposals: 8,
      lensEffectiveness: {
        red_team: 95,
        historian: 92,
        policy_auditor: 88,
        confidence_critic: 91,
      },
      policyCoverage: 98,
      sourceMetrics: {
        dashboardIntegrityScore: 98,
        explanationCompleteness: 96,
        evidenceChainUsage: 94,
        incompleteChainLayers: 0,
      },
    };

    const assessment = buildGovernanceAssessment(perfectReport);

    expect(assessment.reportType).toBe("governance_assessment");
    // governanceConfidence = 98/100*0.4 + 96/100*0.3 + 94/100*0.3
    // = 0.392 + 0.288 + 0.282 = 0.962
    expect(assessment.governanceConfidence).toBeCloseTo(0.962, 3);

    // unresolvedGovernanceIssues = 0 + max(0, 8-8) = 0
    expect(assessment.unresolvedGovernanceIssues).toBe(0);

    // Should have assessment notes
    expect(assessment.assessmentNotes.length).toBeGreaterThan(0);

    // Confidence should be high
    expect(assessment.governanceConfidence).toBeGreaterThanOrEqual(0.75);

    // Should mention high confidence
    const hasHighNote = assessment.assessmentNotes.some((n) =>
      n.toLowerCase().includes("high"),
    );
    expect(hasHighNote).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Invariant: buildGovernanceAssessment is synchronous
  // ---------------------------------------------------------------------------

  it("is a synchronous function (does not return a Promise)", () => {
    const report: GovernanceHealthReport = {
      id: "gh-sync",
      subject: "Governance Health",
      outcome: "computed",
      confidence: 1,
      reasons: [],
      generatedAt: "2026-06-23T00:00:00.000Z",
      reportType: "governance_health",
      totalReviews: 0,
      totalProposals: 0,
      lensEffectiveness: {},
      policyCoverage: 0,
      sourceMetrics: {
        dashboardIntegrityScore: 0,
        explanationCompleteness: null,
        evidenceChainUsage: null,
        incompleteChainLayers: 0,
      },
    };

    const result = buildGovernanceAssessment(report);
    // Must not be a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result.governanceConfidence).toBe("number");
  });
});
