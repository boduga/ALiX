/**
 * P9.0c — GovernanceIntegrityBuilder tests.
 *
 * Tests that buildGovernanceIntegrity correctly translates
 * ProposalExplanation.explanationIntegrity into GovernanceIntegrityReport
 * metrics. No deeper store interaction beyond Explain assembler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGovernanceIntegrity } from "../../src/governance/governance-integrity.js";
import { GovernanceReviewStore } from "../../src/adaptation/governance-review-store.js";
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import { EvidenceChainStore } from "../../src/learning/evidence-chain-store.js";
import type { GovernanceReview } from "../../src/adaptation/governance-review-types.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";
import type { LearningEvidenceChain } from "../../src/learning/evidence-chain-types.js";

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
// Helpers
// ---------------------------------------------------------------------------

const PROPOSAL_ID = "prop-test-complete";
const NOW = "2026-06-23T12:00:00.000Z";

async function seedGovernanceReview(testDir: string): Promise<GovernanceReview> {
  const store = new GovernanceReviewStore(join(testDir, ".alix", "governance-reviews"));
  const review: GovernanceReview = {
    id: "gov-review-test",
    subject: "Test review",
    outcome: "reviewed",
    confidence: 0.85,
    reasons: ["integrity test"],
    generatedAt: NOW,
    recommendationId: "rec-test",
    proposalId: PROPOSAL_ID,
    verdict: "agree",
    concerns: [],
    blindSpots: [],
    historicalAnalogies: [],
    lensScores: [
      {
        lens: "red_team",
        recommendedVerdict: "agree",
        confidence: 0.9,
        rationale: "Seeded for test",
      },
    ],
    councilVote: { agree: 1, agreeWithConcerns: 0, challenge: 0, insufficientInformation: 0 },
    sourceArtifacts: [],
  };
  await store.append(review);
  return review;
}

async function seedOutcome(testDir: string): Promise<OutcomeRecord> {
  const store = new OutcomeStore(join(testDir, ".alix", "adaptation", "outcomes"));
  const record: OutcomeRecord = {
    id: "outcome-test-1",
    subjectId: PROPOSAL_ID,
    subjectType: "proposal",
    outcome: "success",
    subject: "Test outcome",
    confidence: 0.9,
    reasons: ["All metrics green"],
    generatedAt: NOW,
    actionTaken: "Merged proposal",
    observationWindowDays: 7,
  };
  await store.append(record);
  return record;
}

async function seedEvidenceChain(testDir: string, rootArtifactId: string): Promise<LearningEvidenceChain> {
  const store = new EvidenceChainStore(join(testDir, ".alix", "learning"));
  const chain: LearningEvidenceChain = {
    id: "chain-test-1",
    subject: "Test chain",
    outcome: "generated",
    confidence: 1,
    reasons: ["Seeded for integrity test"],
    generatedAt: NOW,
    rootArtifactId,
    rootArtifactType: "outcome_record",
    links: [
      {
        sourceArtifactId: rootArtifactId,
        sourceArtifactType: "outcome_record",
        targetArtifactId: "gov-review-test",
        targetArtifactType: "governance_review",
        relationship: "supports",
        recordedAt: NOW,
      },
    ],
    depth: 1,
    generatedBy: "alix explain",
  };
  await store.appendChain(chain);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGovernanceIntegrity", () => {
  it("returns 0% rates when no governance reviews exist", async () => {
    const report = await buildGovernanceIntegrity({ cwd: tempRoot, windowDays: 90 });
    expect(report.reportType).toBe("governance_integrity");
    expect(report.metrics.totalReviews).toBe(0);
    expect(report.metrics.reviewsWithProvenance).toBe(0);
    expect(report.metrics.reviewsWithExplanations).toBe(0);
    expect(report.metrics.reviewsLinkedToOutcomes).toBe(0);
    expect(report.metrics.untraceableFindings).toBe(0);
    expect(report.metrics.provenanceRate).toBe(0);
    expect(report.metrics.explanationRate).toBe(0);
    expect(report.metrics.outcomeLinkRate).toBe(0);
  });

  it("returns correct provenance/explanation/outcome rates when a seeded review has a complete explanation", async () => {
    // Arrange — seed GovernanceReview, OutcomeRecord, and EvidenceChain.
    await seedGovernanceReview(tempRoot);
    const outcomeRecord = await seedOutcome(tempRoot);
    await seedEvidenceChain(tempRoot, outcomeRecord.id);

    // Act
    const report = await buildGovernanceIntegrity({ cwd: tempRoot, windowDays: 90 });

    // Assert — one review, fully traceable
    expect(report.reportType).toBe("governance_integrity");
    expect(report.metrics.totalReviews).toBe(1);

    // evidenceChainUsed = true (chain rooted at the outcome found in step 1)
    expect(report.metrics.reviewsWithProvenance).toBe(1);

    // layersAvailable > 0 (outcome layer is available)
    expect(report.metrics.reviewsWithExplanations).toBe(1);

    // outcomeFound = true
    expect(report.metrics.reviewsLinkedToOutcomes).toBe(1);

    // No untraceable findings
    expect(report.metrics.untraceableFindings).toBe(0);

    // Rates — all 100%
    expect(report.metrics.provenanceRate).toBe(100);
    expect(report.metrics.explanationRate).toBe(100);
    expect(report.metrics.outcomeLinkRate).toBe(100);
  });

  it("uses the passed generatedAt when provided", async () => {
    const generatedAt = "2026-01-01T00:00:00.000Z";
    const report = await buildGovernanceIntegrity({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt,
    });
    expect(report.generatedAt).toBe(generatedAt);
    expect(report.id).toBe(`gov-integrity-${generatedAt}`);
  });
});
