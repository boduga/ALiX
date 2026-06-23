/**
 * P8.5c.2 — assembler tests (Outcome + Recommendation + Risk + Governance
 * layers via direct-id + proposal-fallback).
 *
 * Mirrors the temp-dir + vi.spyOn(process, "cwd") pattern used across the
 * P7.5p.* store tests. Each test seeds a real artifact and asserts the
 * layer is `available` with the correct joinPath.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import { ApprovalRecommendationStore } from "../../src/adaptation/approval-recommendation-store.js";
import { RiskScoreStore } from "../../src/adaptation/risk-score-store.js";
import { GovernanceReviewStore } from "../../src/adaptation/governance-review-store.js";
import { LearningStore } from "../../src/learning/learning-store.js";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import { assembleProposalExplanation } from "../../src/explain/proposal-explanation-assembler.js";

const OUTCOMES_DIR = join(".alix", "outcomes");
const RECOMMENDATIONS_DIR = join(".alix", "recommendations");
const RISK_SCORES_DIR = join(".alix", "risk-scores");
const GOVERNANCE_REVIEWS_DIR = join(".alix", "governance-reviews");
const LEARNING_DIR = join(".alix", "learning");

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "explain-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("assembleProposalExplanation", () => {
  it("returns all layers not_available when stores are empty", async () => {
    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.proposalId).toBe("prop-1");
    expect(result.outcome.status).toBe("not_available");
    expect(result.recommendation.status).toBe("not_available");
    expect(result.risk.status).toBe("not_available");
    expect(result.governance.status).toBe("not_available");
    expect(result.learning.totalSignals).toBe(0);
    expect(result.calibration.profilesByTarget).toEqual({});
    expect(result.explanationIntegrity.totalLayers).toBe(6);
    expect(result.explanationIntegrity.layersAvailable).toBe(0);
    expect(result.explanationIntegrity.completenessPercent).toBe(0);
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(false);
    expect(result.learningRefreshHint).not.toBeNull();
  });

  it("populates Recommendation via direct-id OutcomeRecord.recommendationId (joinPath: direct_id)", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: ["Deployed cleanly"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
      recommendationId: "rec-1", // DIRECT-ID JOIN
    } as any);

    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({
      id: "rec-1",
      subject: "Recommendation for prop-1",
      outcome: "recommended",
      confidence: 0.85,
      reasons: ["risk acceptable"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      proposalId: "prop-1",
      recommendation: "approve",
      sourceArtifacts: [],
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.outcome.status).toBe("available");
    expect(result.recommendation.status).toBe("available");
    if (result.recommendation.status === "available") {
      expect(result.recommendation.recommendationId).toBe("rec-1");
      expect(result.recommendation.decision).toBe("approve");
      expect(result.recommendation.confidence).toBe(0.85);
      expect(result.recommendation.joinPath).toBe("direct_id");
    }
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(false);
  });

  it("populates Recommendation via proposal-fallback when no recommendationId on outcome (joinPath: proposal_fallback)", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
      // NO recommendationId — forces proposal-fallback
    } as any);

    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({
      id: "rec-1",
      subject: "Recommendation for prop-1",
      outcome: "recommended",
      confidence: 0.9,
      reasons: [],
      generatedAt: "2026-06-01T00:00:00.000Z",
      proposalId: "prop-1",
      recommendation: "approve",
      sourceArtifacts: [],
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.recommendation.status).toBe("available");
    if (result.recommendation.status === "available") {
      expect(result.recommendation.recommendationId).toBe("rec-1");
      expect(result.recommendation.joinPath).toBe("proposal_fallback");
    }
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(true);
  });

  it("populates Risk via direct-id OutcomeRecord.riskScoreId (joinPath: direct_id)", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome prop-1",
      outcome: "success",
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
      riskScoreId: "risk-prop-1", // DIRECT-ID JOIN
    } as any);

    const riskStore = new RiskScoreStore(join(tempRoot, RISK_SCORES_DIR));
    await riskStore.append({
      id: "risk-prop-1",
      subject: "Risk prop-1",
      outcome: "assessed",
      confidence: 0.9,
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      overallRisk: 0.42,
      risks: [{ dimension: "operational", score: 0.5, confidence: 0.8, reasons: ["op risk"] }],
      dimensions: {
        governance: 0.4,
        operational: 0.5,
        capability: 0.3,
        revertability: 0.4,
        evidence_quality: 0.5,
      },
      sourceArtifacts: [],
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.risk.status).toBe("available");
    if (result.risk.status === "available") {
      expect(result.risk.riskScoreId).toBe("risk-prop-1");
      expect(result.risk.overallRisk).toBe(0.42);
      expect(result.risk.outcome).toBe("medium"); // 0.42 → medium
      expect(result.risk.joinPath).toBe("direct_id");
      const op = result.risk.dimensions.find((d) => d.dimension === "operational");
      expect(op?.confidence).toBe(0.8);
    }
  });

  it("populates Governance via direct-id OutcomeRecord.governanceReviewId (joinPath: direct_id)", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome prop-1",
      outcome: "success",
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
      governanceReviewId: "review-1", // DIRECT-ID JOIN
    } as any);

    const govStore = new GovernanceReviewStore(join(tempRoot, GOVERNANCE_REVIEWS_DIR));
    await govStore.append({
      id: "review-1",
      subject: "Governance review for prop-1",
      outcome: "reviewed",
      confidence: 0.7,
      reasons: ["council convened"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      recommendationId: "rec-1",
      proposalId: "prop-1",
      verdict: "agree_with_concerns",
      concerns: ["minor policy gap"],
      blindSpots: [],
      historicalAnalogies: [],
      lensScores: [
        { lens: "red_team", recommendedVerdict: "challenge", confidence: 0.8, rationale: "x" },
        { lens: "historian", recommendedVerdict: "agree", confidence: 0.7, rationale: "y" },
      ],
      councilVote: { agree: 1, agreeWithConcerns: 0, challenge: 1, insufficientInformation: 0 },
      sourceArtifacts: [],
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.governance.status).toBe("available");
    if (result.governance.status === "available") {
      expect(result.governance.reviewId).toBe("review-1");
      expect(result.governance.verdict).toBe("agree_with_concerns");
      expect(result.governance.concerns).toEqual(["minor policy gap"]);
      expect(result.governance.joinPath).toBe("direct_id");
      expect(result.governance.lensScores).toHaveLength(2);
      expect(result.governance.lensScores[0]).toEqual({
        lens: "red_team",
        verdict: "challenge",
        confidence: 0.8,
      });
    }
  });

  it("reports completenessPercent correctly (2 of 6 layers available)", async () => {
    // Seed only Outcome + Recommendation (no Risk, no Governance, no Learning, no Calibration).
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome prop-1",
      outcome: "success",
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
      recommendationId: "rec-1",
    } as any);

    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({
      id: "rec-1",
      subject: "Recommendation for prop-1",
      outcome: "recommended",
      confidence: 0.9,
      reasons: [],
      generatedAt: new Date().toISOString(),
      proposalId: "prop-1",
      recommendation: "approve",
      sourceArtifacts: [],
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.explanationIntegrity.layersAvailable).toBe(2);
    expect(result.explanationIntegrity.completenessPercent).toBeCloseTo(33.3, 1);
  });

  // -------------------------------------------------------------------------
  // P8.5c.3 — Task 3 tests: EvidenceChain traversal + Learning + Calibration
  // -------------------------------------------------------------------------

  it("uses EvidenceChain to populate Recommendation layer (joinPath: evidence_chain)", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: [],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
    } as any);

    const recStore = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await recStore.append({
      id: "rec-1",
      subject: "Recommendation for prop-1",
      outcome: "recommended",
      confidence: 0.85,
      reasons: [],
      generatedAt: "2026-06-01T00:00:00.000Z",
      proposalId: "prop-1",
      recommendation: "approve",
      sourceArtifacts: [],
    } as any);

    // Seed an EvidenceChain linking out-1 → rec-1.
    const chainStore = new EvidenceChainStore(join(tempRoot, LEARNING_DIR));
    await chainStore.appendChain({
      id: "chain-1",
      subject: "Chain for prop-1",
      outcome: "computed",
      confidence: 1,
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      rootArtifactId: "out-1",
      rootArtifactType: "outcome_record",
      links: [
        {
          sourceArtifactId: "out-1",
          sourceArtifactType: "outcome_record",
          targetArtifactId: "rec-1",
          targetArtifactType: "recommendation",
          relationship: "derived_from",
          recordedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      depth: 1,
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.explanationIntegrity.evidenceChainUsed).toBe(true);
    expect(result.recommendation.status).toBe("available");
    if (result.recommendation.status === "available") {
      expect(result.recommendation.recommendationId).toBe("rec-1");
      expect(result.recommendation.joinPath).toBe("evidence_chain");
    }
  });

  it("increments incompleteChainLayers when EvidenceChain references a missing artifact", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: [],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
    } as any);

    // Chain references rec-MISSING which is absent from the store → orphan.
    const chainStore = new EvidenceChainStore(join(tempRoot, LEARNING_DIR));
    await chainStore.appendChain({
      id: "chain-orphan",
      subject: "Broken chain for prop-1",
      outcome: "computed",
      confidence: 1,
      reasons: ["x"],
      generatedAt: "2026-06-01T00:00:00.000Z",
      rootArtifactId: "out-1",
      rootArtifactType: "outcome_record",
      links: [
        {
          sourceArtifactId: "out-1",
          sourceArtifactType: "outcome_record",
          targetArtifactId: "rec-MISSING",
          targetArtifactType: "recommendation",
          relationship: "derived_from",
          recordedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      depth: 1,
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.explanationIntegrity.evidenceChainUsed).toBe(true);
    expect(result.explanationIntegrity.incompleteChainLayers).toBeGreaterThanOrEqual(1);
    // Falls through to proposal-fallback, finds nothing → recommendation unavailable.
    expect(result.recommendation.status).toBe("not_available");
  });

  it("populates Learning layer via EvidenceChain link from signal to proposal artifact (subject has no proposalId)", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: [],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
    } as any);

    // Signal subject intentionally does NOT contain proposalId — the chain
    // is the ONLY link. evidenceRefs empty so only chain can resolve it.
    const learningStore = new LearningStore(join(tempRoot, LEARNING_DIR));
    await learningStore.appendSignal({
      id: "sig-1",
      subject: "Overconfidence signal",
      outcome: "signal_detected",
      confidence: 0.7,
      reasons: ["delta"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "risk-calibration-window-30",
      signalType: "risk_dimension_overfire",
      strength: 0.7,
      summary: "x",
      evidenceRefs: [],
    } as any);

    // Chain: rootArtifactId = sig-1 (the signal), links target out-1 (the
    // proposal artifact). So a signal's chain root resolves to a proposal
    // artifact → signal is reachable via chain.
    const chainStore = new EvidenceChainStore(join(tempRoot, LEARNING_DIR));
    await chainStore.appendChain({
      id: "chain-sig-1",
      subject: "Chain linking sig-1 to out-1",
      outcome: "computed",
      confidence: 1,
      reasons: ["x"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      rootArtifactId: "sig-1",
      rootArtifactType: "learning_signal",
      links: [
        {
          sourceArtifactId: "sig-1",
          sourceArtifactType: "learning_signal",
          targetArtifactId: "out-1",
          targetArtifactType: "outcome_record",
          relationship: "derived_from",
          recordedAt: "2026-06-22T00:00:00.000Z",
        },
      ],
      depth: 1,
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.explanationIntegrity.evidenceChainUsed).toBe(true);
    expect(result.learning.totalSignals).toBe(1);
    expect(result.explanationIntegrity.learningFound).toBe(true);
    // Adapter classification via sourceReportId prefix.
    expect(result.learning.adaptersWithSignals).toContain("risk");
    // No heuristic fallback needed — chain resolved.
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(false);
    expect(result.learningRefreshHint).toBeNull();
  });

  it("populates Learning layer via string heuristic fallback (fallbackJoinsUsed: true)", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: [],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
    } as any);

    // No chain seeded — heuristic must kick in. Subject contains proposalId.
    const learningStore = new LearningStore(join(tempRoot, LEARNING_DIR));
    await learningStore.appendSignal({
      id: "sig-1",
      subject: "Signal for prop-1 recommendation",
      outcome: "signal_detected",
      confidence: 0.6,
      reasons: [],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "recommendation-window-30",
      signalType: "overconfidence",
      strength: 0.6,
      summary: "x",
      evidenceRefs: [],
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.learning.totalSignals).toBe(1);
    expect(result.explanationIntegrity.learningFound).toBe(true);
    expect(result.explanationIntegrity.fallbackJoinsUsed).toBe(true);
    expect(result.learning.adaptersWithSignals).toContain("recommendation");
  });

  it("populates Calibration layer via signal evidenceRefs when chain resolves signal", async () => {
    const outcomeStore = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await outcomeStore.append({
      id: "out-1",
      subject: "Outcome for prop-1",
      outcome: "success",
      reasons: [],
      generatedAt: "2026-06-01T00:00:00.000Z",
      subjectId: "prop-1",
      subjectType: "proposal",
      actionTaken: "applied",
      observationWindowDays: 7,
    } as any);

    const learningStore = new LearningStore(join(tempRoot, LEARNING_DIR));
    await learningStore.appendSignal({
      id: "sig-1",
      subject: "Overconfidence signal",
      outcome: "signal_detected",
      confidence: 0.7,
      reasons: ["delta"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      sourceReportId: "risk-calibration-window-30",
      signalType: "risk_dimension_overfire",
      strength: 0.7,
      summary: "x",
      evidenceRefs: [],
    } as any);

    // Profile references sig-1 via sourceSignalIds. Since sig-1 is a chain
    // root (links to out-1), the profile is reachable via chain.
    await learningStore.appendProfile({
      id: "prof-1",
      subject: "Confidence multiplier bucket",
      outcome: "suggested",
      confidence: 0.7,
      reasons: ["delta"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      target: "recommendation_confidence_multiplier",
      targetName: "confidence_multiplier_0.8-1.0",
      previousValue: 1.0,
      suggestedValue: 0.85,
      reason: "Observed success rate below midpoint",
      evidenceRefs: ["sig-1"],
      sourceSignalIds: ["sig-1"],
    } as any);

    const chainStore = new EvidenceChainStore(join(tempRoot, LEARNING_DIR));
    await chainStore.appendChain({
      id: "chain-sig-1",
      subject: "Chain linking sig-1 to out-1",
      outcome: "computed",
      confidence: 1,
      reasons: ["x"],
      generatedAt: "2026-06-22T00:00:00.000Z",
      rootArtifactId: "sig-1",
      rootArtifactType: "learning_signal",
      links: [
        {
          sourceArtifactId: "sig-1",
          sourceArtifactType: "learning_signal",
          targetArtifactId: "out-1",
          targetArtifactType: "outcome_record",
          relationship: "derived_from",
          recordedAt: "2026-06-22T00:00:00.000Z",
        },
      ],
      depth: 1,
    } as any);

    const result = await assembleProposalExplanation({
      proposalId: "prop-1",
      cwd: tempRoot,
      windowDays: 30,
    });

    expect(result.calibration.profilesByTarget).toHaveProperty(
      "recommendation_confidence_multiplier",
    );
    expect(result.calibration.adjustments).toHaveLength(1);
    expect(result.calibration.adjustments[0].suggestedValue).toBe(0.85);
    expect(result.explanationIntegrity.calibrationFound).toBe(true);
  });
});
