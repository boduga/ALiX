/**
 * P9.0b.4 — CLI integration tests for `alix governance` full pipelines.
 *
 * Each test seeds the P8 stores that the governance builders consume,
 * runs the CLI subcommand with --json, parses the JSON output, and
 * asserts the pipeline (builder -> store -> render) worked end-to-end.
 *
 * Three pipelines:
 *   1. health       — GovernanceReviewStore + OutcomeStore + LearningStore
 *                      → buildGovernanceHealth + buildGovernanceAssessment
 *                      → GovernanceStore.append → JSON render
 *   2. drift        — LearningStore (overconfidence signals) + OutcomeStore
 *                      → detectGovernanceDrift → GovernanceStore.append
 *                      → JSON render
 *   3. lens-review  — LearningStore (calibration profiles for 4 lenses)
 *                      → reviewLenses → GovernanceStore.append → JSON render
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGovernanceCommand } from "../../../src/cli/commands/governance.js";
import { GovernanceReviewStore } from "../../../src/adaptation/governance-review-store.js";
import type { GovernanceReview } from "../../../src/adaptation/governance-review-types.js";
import { OutcomeStore } from "../../../src/adaptation/outcome-store.js";
import type { OutcomeRecord } from "../../../src/adaptation/outcome-types.js";
import { LearningStore } from "../../../src/learning/learning-store.js";
import type { LearningSignal, CalibrationProfile } from "../../../src/learning/learning-types.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-int-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Shared seed helpers
// ---------------------------------------------------------------------------

const NOW = new Date().toISOString();

function makeOutcome(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "out-1",
    subject: "Test Outcome",
    outcome: "success",
    reasons: [],
    generatedAt: NOW,
    subjectId: "prop-1",
    subjectType: "proposal",
    actionTaken: "apply",
    observationWindowDays: 7,
    ...overrides,
  } as OutcomeRecord;
}

function makeGovernanceReview(overrides: Partial<GovernanceReview> = {}): GovernanceReview {
  return {
    id: "gr-1",
    subject: "Test Review",
    outcome: "reviewed",
    confidence: 1,
    reasons: ["test"],
    generatedAt: NOW,
    recommendationId: "rec-1",
    proposalId: "prop-1",
    verdict: "agree",
    concerns: [],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores: [],
    councilVote: { agree: 4, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 },
    sourceArtifacts: [],
    ...overrides,
  } as GovernanceReview;
}

function makeCalibrationProfile(
  overrides: Partial<CalibrationProfile> = {},
): CalibrationProfile {
  return {
    id: "cp-1",
    subject: "Test Calibration",
    outcome: "computed",
    confidence: 0.85,
    reasons: ["test"],
    generatedAt: NOW,
    target: "governance_lens_weight",
    targetName: "red_team",
    previousValue: 0.7,
    suggestedValue: 0.85,
    reason: "Strong predictive value observed",
    evidenceRefs: [],
    sourceSignalIds: ["ls-1"],
    ...overrides,
  } as CalibrationProfile;
}

function makeSignal(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return {
    id: "ls-oc-1",
    subject: "Test Signal",
    outcome: "computed",
    confidence: 0.9,
    reasons: ["test"],
    generatedAt: NOW,
    sourceReportId: "recommendation-1",
    signalType: "overconfidence",
    strength: 0.8,
    summary: "Test overconfidence signal",
    evidenceRefs: [],
    ...overrides,
  } as LearningSignal;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("governance CLI integration", () => {
  // -- Health pipeline -------------------------------------------------------

  it("health pipeline: builder -> store -> render (totalReviews + lensEffectiveness)", async () => {
    // Seed GovernanceReviewStore → totalReviews >= 1
    const grStore = new GovernanceReviewStore(
      join(tempRoot, ".alix", "governance-reviews"),
    );
    await grStore.append(makeGovernanceReview());

    // Seed OutcomeStore → totalProposals >= 1 (unique subjectIds), and
    //   buildDashboardReport can scan at least one proposal.
    const os = new OutcomeStore(join(tempRoot, ".alix", "adaptation", "outcomes"));
    await os.append(makeOutcome());

    // Seed LearningStore with calibration profiles → lensEffectiveness populated
    const ls = new LearningStore(join(tempRoot, ".alix", "learning"));
    await ls.appendProfile(
      makeCalibrationProfile({ targetName: "red_team", confidence: 0.85 }),
    );
    await ls.appendProfile(
      makeCalibrationProfile({
        id: "cp-2",
        targetName: "historian",
        confidence: 0.72,
      }),
    );

    // Run the CLI
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["health", "--json"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    log.mockRestore();

    // Parse the combined { health, assessment } JSON output
    const parsed = JSON.parse(output);

    // Verify health report
    expect(parsed.health).toBeDefined();
    expect(parsed.health.reportType).toBe("governance_health");
    expect(parsed.health.totalReviews).toBeGreaterThanOrEqual(1);
    expect(parsed.health.totalProposals).toBeGreaterThanOrEqual(1);
    expect(parsed.health.lensEffectiveness).toBeDefined();
    const lensKeys = Object.keys(parsed.health.lensEffectiveness);
    expect(lensKeys.length).toBeGreaterThanOrEqual(1);
    // Each value should be a number (percentage)
    for (const key of lensKeys) {
      expect(typeof parsed.health.lensEffectiveness[key]).toBe("number");
    }

    // Verify assessment was computed from the health report
    expect(parsed.assessment).toBeDefined();
    expect(parsed.assessment.reportType).toBe("governance_assessment");
    expect(typeof parsed.assessment.governanceConfidence).toBe("number");
    expect(typeof parsed.assessment.unresolvedGovernanceIssues).toBe("number");
    expect(Array.isArray(parsed.assessment.assessmentNotes)).toBe(true);
    expect(parsed.assessment.assessmentNotes.length).toBeGreaterThan(0);
  });

  // -- Drift pipeline -------------------------------------------------------

  it("drift pipeline: builder -> store -> render (findings array populated)", async () => {
    // Seed OutcomeStore → buildDashboardReport can scan proposals
    const os = new OutcomeStore(join(tempRoot, ".alix", "adaptation", "outcomes"));
    await os.append(makeOutcome());

    // Seed LearningStore with overconfidence signals
    // Need: totalConfidence > 10 AND ratio = max(over, under) / total > 0.6
    // With 12 over + 3 under = 15 total, ratio = 12/15 = 0.8 → high severity
    const ls = new LearningStore(join(tempRoot, ".alix", "learning"));
    for (let i = 1; i <= 12; i++) {
      await ls.appendSignal(
        makeSignal({
          id: `ls-oc-${i}`,
          signalType: "overconfidence",
          sourceReportId: "recommendation-1",
        }),
      );
    }
    for (let i = 1; i <= 3; i++) {
      await ls.appendSignal(
        makeSignal({
          id: `ls-uc-${i}`,
          signalType: "underconfidence",
          sourceReportId: "recommendation-2",
        }),
      );
    }

    // Run the CLI
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["drift", "--json"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    log.mockRestore();

    // Parse the drift report
    const parsed = JSON.parse(output);
    expect(parsed.reportType).toBe("governance_drift");
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect(parsed.findings.length).toBeGreaterThan(0);

    // Verify at least one confidence_drift finding
    const confidenceDrift = parsed.findings.find(
      (f: { driftType: string }) => f.driftType === "confidence_drift",
    );
    expect(confidenceDrift).toBeDefined();
    expect(confidenceDrift.severity).toBe("high");
    expect(confidenceDrift.confidence).toBeGreaterThan(0);
    expect(confidenceDrift.description).toContain("Overconfidence");
  });

  // -- Lens review pipeline -------------------------------------------------

  it("lens-review pipeline: builder -> store -> render (lensReviews array populated)", async () => {
    // Seed LearningStore with calibration profiles for all 4 lenses.
    // Vary confidence + sourceSignalIds count to trigger different recommendations:
    //   red_team:        high PV (0.85),   many reviews (25 ids) → promote
    //   historian:       very low PV (0.15), many reviews (35 ids) → retire
    //   policy_auditor:  low PV (0.30),     many reviews (25 ids) → demote
    //   confidence_critic: moderate PV (0.55), few reviews (5 ids) → keep
    const ls = new LearningStore(join(tempRoot, ".alix", "learning"));

    // Generate arrays of fake signal IDs for reviewsAnalyzed
    const makeIds = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);

    await ls.appendProfile(
      makeCalibrationProfile({
        id: "cp-red",
        targetName: "red_team",
        confidence: 0.85,
        sourceSignalIds: makeIds("rs", 25),
        reason: "High predictive value with sufficient sample",
      }),
    );

    await ls.appendProfile(
      makeCalibrationProfile({
        id: "cp-hist",
        targetName: "historian",
        confidence: 0.15,
        sourceSignalIds: makeIds("hs", 35),
        reason: "Very low predictive value after many reviews",
      }),
    );

    await ls.appendProfile(
      makeCalibrationProfile({
        id: "cp-policy",
        targetName: "policy_auditor",
        confidence: 0.3,
        sourceSignalIds: makeIds("ps", 25),
        reason: "Low predictive value with sufficient sample",
      }),
    );

    await ls.appendProfile(
      makeCalibrationProfile({
        id: "cp-conf",
        targetName: "confidence_critic",
        confidence: 0.55,
        sourceSignalIds: makeIds("cs", 5),
        reason: "Stable performance",
      }),
    );

    // Run the CLI
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await handleGovernanceCommand(["lens-review", "--json"]);
    const output = log.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    log.mockRestore();

    // Parse the lens review
    const parsed = JSON.parse(output);
    expect(parsed.reportType).toBe("lens_lifecycle");
    expect(Array.isArray(parsed.lensReviews)).toBe(true);
    expect(parsed.lensReviews.length).toBe(4);

    // Verify each lens is present with expected recommendation
    const byLens: Record<string, Record<string, unknown>> = {};
    for (const lr of parsed.lensReviews) {
      byLens[lr.lens] = lr;
    }

    expect(byLens["red_team"]).toBeDefined();
    expect(byLens["red_team"].recommendation).toBe("promote");
    expect(byLens["red_team"].predictiveValue).toBeGreaterThan(0.7);

    expect(byLens["historian"]).toBeDefined();
    expect(byLens["historian"].recommendation).toBe("retire");
    expect(byLens["historian"].predictiveValue).toBeLessThan(0.2);

    expect(byLens["policy_auditor"]).toBeDefined();
    expect(byLens["policy_auditor"].recommendation).toBe("demote");
    expect(byLens["policy_auditor"].predictiveValue).toBeLessThan(0.4);

    expect(byLens["confidence_critic"]).toBeDefined();
    expect(byLens["confidence_critic"].recommendation).toBe("keep");

    // Verify each review has all required fields
    for (const lr of parsed.lensReviews) {
      expect(typeof lr.lens).toBe("string");
      expect(typeof lr.predictiveValue).toBe("number");
      expect(typeof lr.reviewsAnalyzed).toBe("number");
      expect(typeof lr.falseAlarms).toBe("number");
      expect(typeof lr.missedFailures).toBe("number");
      expect(["keep", "promote", "demote", "retire"]).toContain(lr.recommendation);
      expect(typeof lr.reason).toBe("string");
    }
  });
});
