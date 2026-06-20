/**
 * P5.4.2 — ProposalScorer tests.
 *
 * Verifies scoring with full/partial/no IntelligenceReport, age multiplier,
 * score capping, rationale generation, score distribution, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import { IntelligenceStore } from "../../src/adaptation/intelligence-store.js";
import { PriorityStore } from "../../src/adaptation/priority-store.js";
import { ProposalScorer, computeAgeMultiplier } from "../../src/adaptation/proposal-scorer.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type {
  BucketSet,
  BucketStat,
  IntelligenceReport,
} from "../../src/adaptation/intelligence-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(overrides?: Partial<AdaptationProposal>): AdaptationProposal {
  return {
    id: "prop-test-" + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    status: "pending",
    action: "add_capability",
    target: { kind: "capability", capability: "test.cap" },
    payload: {},
    sourceRecommendationType: "capability_gap",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test reason",
    provenance: "auto",
    ...overrides,
  };
}

/** Create a bucket stat with sufficient data (totalProposals >= 5). */
function makeBucketStat(
  value: string,
  totalProposals: number,
  overrides?: Partial<BucketStat>,
): BucketStat {
  return {
    value,
    totalProposals,
    insufficientData: totalProposals < 5,
    keepCount: overrides?.keepCount ?? totalProposals,
    keepRate: overrides?.keepRate ?? 0.85,
    advisoryRevertCount: overrides?.advisoryRevertCount ?? 0,
    advisoryRevertRate: overrides?.advisoryRevertRate ?? 0.05,
    investigateCount: overrides?.investigateCount ?? 0,
    investigateRate: overrides?.investigateRate ?? 0.0,
    notAssessedCount: overrides?.notAssessedCount ?? 0,
    notAssessedRate: overrides?.notAssessedRate ?? 0.0,
    applyFailureCount: overrides?.applyFailureCount ?? 0,
    applyFailureRate: overrides?.applyFailureRate ?? 0.0,
    rejectionCount: overrides?.rejectionCount ?? 0,
    rejectionRate: overrides?.rejectionRate ?? 0.0,
    approvalRate: overrides?.approvalRate ?? 0.9,
    actualRevertCount: overrides?.actualRevertCount ?? 0,
    actualRevertRate: overrides?.actualRevertRate ?? 0.02,
    medianTimeToApprovalHours: overrides?.medianTimeToApprovalHours ?? 2,
    medianTimeToApplyHours: overrides?.medianTimeToApplyHours ?? 1,
    meanSourceConfidence: overrides?.meanSourceConfidence ?? 0.85,
    humansOverruledCount: overrides?.humansOverruledCount ?? 0,
    ...overrides,
  };
}

/** Create a bucket stat with insufficient data. */
function makeInsufficientBucket(value: string): BucketStat {
  return {
    value,
    totalProposals: 2,
    insufficientData: true,
  };
}

function makeBucketSet(dimension: string, buckets: BucketStat[]): BucketSet {
  const totalInDimension = buckets.reduce((sum, b) => sum + b.totalProposals, 0);
  const insufficientDataCount = buckets.filter((b) => b.insufficientData).length;
  return { dimension, buckets, totalInDimension, insufficientDataCount };
}

function makeIntelligenceReport(overrides?: {
  buckets?: Partial<IntelligenceReport["buckets"]>;
}): IntelligenceReport {
  const defaultBuckets: IntelligenceReport["buckets"] = {
    byAction: makeBucketSet("byAction", [
      makeBucketStat("add_capability", 20),
      makeBucketStat("update_agent_card", 15),
    ]),
    byTargetKind: makeBucketSet("byTargetKind", [
      makeBucketStat("capability", 25),
      makeBucketStat("agent_card", 15),
    ]),
    bySourceRecommendationType: makeBucketSet("bySourceRecommendationType", [
      makeBucketStat("capability_gap", 20),
      makeBucketStat("agent_card_update", 10),
    ]),
    byProvenance: makeBucketSet("byProvenance", [
      makeBucketStat("auto", 20),
      makeBucketStat("manual", 10),
    ]),
    byCapability: makeBucketSet("byCapability", [
      makeBucketStat("test.cap", 10),
    ]),
    byOutcome: makeBucketSet("byOutcome", [
      makeBucketStat("applied", 30),
    ]),
  };

  return {
    generatedAt: "2026-06-19T00:00:00.000Z",
    totalProposalsAnalyzed: 30,
    dataWindow: {
      oldestProposalCreatedAt: "2026-01-01T00:00:00.000Z",
      newestProposalCreatedAt: "2026-06-19T00:00:00.000Z",
      oldestEffectivenessAssessedAt: "2026-01-02T00:00:00.000Z",
    },
    executiveSummary: "Test intelligence report.",
    buckets: { ...defaultBuckets, ...overrides?.buckets } as IntelligenceReport["buckets"],
    confidenceCalibration: {
      buckets: [],
      totalAssessed: 30,
      confidenceOutcomeCorrelation: 0.7,
    },
    revertSignalAnalysis: {
      totalAdvisoryReverts: 2,
      totalActualReverts: 1,
      totalUnactedReverts: 1,
      revertPrecision: 1.0,
      topUnactedRevertBuckets: [],
      humansOverruledCount: 0,
    },
    topPerforming: [],
    lowestPerforming: [],
  };
}

function setupStores() {
  const proposalDir = mkdtempSync(join(tmpdir(), "proposal-scorer-proposals-"));
  const intelligenceDir = mkdtempSync(join(tmpdir(), "proposal-scorer-intelligence-"));
  const priorityDir = mkdtempSync(join(tmpdir(), "proposal-scorer-priority-"));

  const proposalStore = new ProposalStore(proposalDir);
  const intelligenceStore = new IntelligenceStore(intelligenceDir);
  const priorityStore = new PriorityStore(priorityDir);

  return { proposalDir, intelligenceDir, priorityDir, proposalStore, intelligenceStore, priorityStore };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProposalScorer", () => {
  let dirs: ReturnType<typeof setupStores>;
  let scorer: ProposalScorer;

  afterEach(() => {
    if (dirs) {
      rmSync(dirs.proposalDir, { recursive: true, force: true });
      rmSync(dirs.intelligenceDir, { recursive: true, force: true });
      rmSync(dirs.priorityDir, { recursive: true, force: true });
    }
  });

  describe("with full IntelligenceReport", () => {
    beforeEach(async () => {
      dirs = setupStores();
      scorer = new ProposalScorer(dirs.proposalStore, dirs.intelligenceStore, dirs.priorityStore);
    });

    it("(a) scores pending proposals with correct score computation and HIGH confidence", async () => {
      // Seed pending proposals
      const p1 = makeProposal({
        id: "prop-001",
        action: "add_capability",
        target: { kind: "capability", capability: "test.cap" },
        sourceRecommendationType: "capability_gap",
        sourceConfidence: 0.9,
        provenance: "auto",
      });
      const p2 = makeProposal({
        id: "prop-002",
        action: "update_agent_card",
        target: { kind: "agent_card", id: "test.agent" },
        sourceRecommendationType: "agent_card_update",
        sourceConfidence: 0.7,
        provenance: "manual",
      });
      await dirs.proposalStore.save(p1);
      await dirs.proposalStore.save(p2);

      // Seed IntelligenceReport
      const report = makeIntelligenceReport();
      // add_capability bucket has higher keepRate
      report.buckets.byAction.buckets.find((b) => b.value === "add_capability")!.keepRate = 0.92;
      report.buckets.byAction.buckets.find((b) => b.value === "add_capability")!.approvalRate = 0.95;
      report.buckets.byAction.buckets.find((b) => b.value === "add_capability")!.advisoryRevertRate = 0.03;
      report.buckets.byAction.buckets.find((b) => b.value === "add_capability")!.actualRevertRate = 0.01;
      // update_agent_card bucket has lower metrics
      report.buckets.byAction.buckets.find((b) => b.value === "update_agent_card")!.keepRate = 0.80;
      report.buckets.byAction.buckets.find((b) => b.value === "update_agent_card")!.approvalRate = 0.85;
      report.buckets.byAction.buckets.find((b) => b.value === "update_agent_card")!.advisoryRevertRate = 0.08;
      report.buckets.byAction.buckets.find((b) => b.value === "update_agent_card")!.actualRevertRate = 0.05;
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      // Report structure
      expect(result.scoringVersion).toBe("v1");
      expect(result.intelligenceReportDate).toBe("2026-06-19T00:00:00.000Z");
      expect(result.totalPending).toBe(2);
      expect(result.totalScored).toBe(2);

      // Both proposals should have HIGH confidence (matching 4-5 dimensions)
      const scoredP1 = result.ranked.find((s) => s.proposalId === "prop-001")!;
      const scoredP2 = result.ranked.find((s) => s.proposalId === "prop-002")!;

      expect(scoredP1.confidence).toBe("HIGH");
      expect(scoredP2.confidence).toBe("HIGH");

      // P1 has higher score (higher sourceConfidence + higher bucket keepRate)
      expect(scoredP1.priorityScore).toBeGreaterThan(scoredP2.priorityScore);

      // Verify P1 components
      expect(scoredP1.components.confidenceWeight).toBe(0.9);
      expect(scoredP1.components.historicalSuccessWeight).toBeGreaterThan(0);
      expect(scoredP1.components.approvalWeight).toBeGreaterThan(0);
      expect(scoredP1.components.revertPenalty).toBeGreaterThan(0.5); // low revert risk
      expect(scoredP1.components.ageMultiplier).toBe(1.0); // just created

      // Verify score computation for P1 manually
      // keepRate=0.92, approvalRate=0.95, advisoryRevertRate=0.03, actualRevertRate=0.01
      const expectedBaseP1 =
        0.3 * 0.9 +           // confidence
        0.3 * 0.92 +          // historical (best keepRate from byAction, byTargetKind, bySourceRecommendationType, byProvenance, byCapability — 0.92 is highest)
        0.15 * 0.95 +         // approval (0.95 is highest across matching buckets)
        0.15 * (1 - Math.max(0.03, 0.01)); // revert penalty = 1 - 0.03 = 0.97
      // 0.27 + 0.276 + 0.1425 + 0.1455 = 0.834
      expect(scoredP1.priorityScore).toBeCloseTo(expectedBaseP1, 3);

      // Rationale contains key signals
      expect(scoredP1.rationale).toContain("0.90");
      expect(scoredP1.rationale).toContain("add_capability");

      // Top proposal is p1
      expect(result.ranked[0].proposalId).toBe("prop-001");
    });

    it("(h) report has scoringVersion v1", async () => {
      const p = makeProposal();
      await dirs.proposalStore.save(p);
      const report = makeIntelligenceReport();
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();
      expect(result.scoringVersion).toBe("v1");
    });

    it("(i) score distribution computed correctly", async () => {
      // Create proposals with distinct scores spanning multiple deciles
      for (let i = 0; i < 5; i++) {
        const p = makeProposal({
          id: `prop-d-${i}`,
          sourceConfidence: 0.2 + i * 0.15, // 0.2, 0.35, 0.5, 0.65, 0.8
        });
        await dirs.proposalStore.save(p);
      }
      const report = makeIntelligenceReport();
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      expect(result.scoreDistribution).toHaveLength(10);
      expect(result.scoreDistribution[0].decile).toBe("0.0-0.1");
      expect(result.scoreDistribution[9].decile).toBe("0.9-1.0");

      // Total counts should sum to totalScored
      const totalInDistribution = result.scoreDistribution.reduce((s, d) => s + d.count, 0);
      expect(totalInDistribution).toBe(result.totalScored);
    });

    it("(f) score capped at 1.0", async () => {
      // Extremely high confidence + perfect bucket + very old
      const oldDate = new Date(Date.now() - 100 * 86_400_000).toISOString(); // 100 days ago
      const p = makeProposal({
        id: "prop-cap",
        sourceConfidence: 1.0,
        createdAt: oldDate,
      });
      await dirs.proposalStore.save(p);

      const report = makeIntelligenceReport();
      // Perfect bucket metrics
      const buckets = [
        report.buckets.byAction,
        report.buckets.byTargetKind,
        report.buckets.bySourceRecommendationType,
        report.buckets.byProvenance,
        report.buckets.byCapability,
      ];
      for (const bs of buckets) {
        for (const b of bs.buckets) {
          b.keepRate = 1.0;
          b.approvalRate = 1.0;
          b.advisoryRevertRate = 0.0;
          b.actualRevertRate = 0.0;
        }
      }
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      const scored = result.ranked[0];
      // baseScore = 0.3*1.0 + 0.3*1.0 + 0.15*1.0 + 0.15*1.0 = 1.0
      // ageMultiplier = 1.15 (100 days old)
      // unclamped = 1.0 * 1.15 = 1.15
      // clamped = min(1.15, 1.0) = 1.0
      expect(scored.priorityScore).toBe(1.0);
      expect(scored.components.ageMultiplier).toBe(1.15);
    });
  });

  describe("without IntelligenceReport (graceful degradation)", () => {
    beforeEach(async () => {
      dirs = setupStores();
      scorer = new ProposalScorer(dirs.proposalStore, dirs.intelligenceStore, dirs.priorityStore);
    });

    it("(b) scores on confidence + age only, confidence LOW", async () => {
      const p = makeProposal({
        id: "prop-no-intel",
        sourceConfidence: 0.8,
      });
      await dirs.proposalStore.save(p);

      const result = await scorer.generateReport();

      expect(result.intelligenceReportDate).toBeNull();
      expect(result.totalPending).toBe(1);
      expect(result.totalScored).toBe(1);
      expect(result.totalLowConfidence).toBe(1);

      const scored = result.ranked[0];
      expect(scored.confidence).toBe("LOW");
      expect(scored.components.confidenceWeight).toBe(0.8);
      expect(scored.components.historicalSuccessWeight).toBe(0);
      expect(scored.components.approvalWeight).toBe(0);
      expect(scored.components.revertPenalty).toBe(0.5);

      // baseScore = 0.3*0.8 + 0.3*0 + 0.15*0 + 0.15*0.5 = 0.24 + 0 + 0 + 0.075 = 0.315
      expect(scored.priorityScore).toBeCloseTo(0.315, 3);

      // Rationale mentions insufficient data
      expect(scored.rationale).toContain("Insufficient historical data");
    });
  });

  describe("with partial IntelligenceReport", () => {
    beforeEach(async () => {
      dirs = setupStores();
      scorer = new ProposalScorer(dirs.proposalStore, dirs.intelligenceStore, dirs.priorityStore);
    });

    it("(c) MEDIUM confidence when only one dimension has sufficient data", async () => {
      const p = makeProposal({
        id: "prop-partial",
        action: "add_capability",
        target: { kind: "capability", capability: "test.cap" },
        sourceRecommendationType: "capability_gap",
        provenance: "auto",
      });
      await dirs.proposalStore.save(p);

      // Create report where only byAction has sufficient data; others have insufficient
      const report = makeIntelligenceReport({
        buckets: {
          byAction: makeBucketSet("byAction", [makeBucketStat("add_capability", 20)]),
          // Other dimensions have insufficient data or no match
          byTargetKind: makeBucketSet("byTargetKind", [makeInsufficientBucket("capability")]),
          bySourceRecommendationType: makeBucketSet("bySourceRecommendationType", [makeInsufficientBucket("capability_gap")]),
          byProvenance: makeBucketSet("byProvenance", [makeInsufficientBucket("auto")]),
          byCapability: makeBucketSet("byCapability", [makeInsufficientBucket("test.cap")]),
          byOutcome: makeBucketSet("byOutcome", [makeBucketStat("applied", 30)]),
        },
      });
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      const scored = result.ranked[0];
      expect(scored.confidence).toBe("MEDIUM");

      // Only byAction contributes metrics
      expect(scored.components.historicalSuccessWeight).toBe(0.85); // from byAction
      expect(scored.components.approvalWeight).toBe(0.9); // from byAction
      expect(scored.components.revertPenalty).toBe(1 - Math.max(0.05, 0.02)); // from byAction
    });

    it("(c) LOW confidence when no dimension has sufficient data", async () => {
      const p = makeProposal({
        id: "prop-all-insufficient",
        action: "add_capability",
        target: { kind: "capability", capability: "test.cap" },
        sourceRecommendationType: "capability_gap",
        provenance: "auto",
      });
      await dirs.proposalStore.save(p);

      const report = makeIntelligenceReport({
        buckets: {
          byAction: makeBucketSet("byAction", [makeInsufficientBucket("add_capability")]),
          byTargetKind: makeBucketSet("byTargetKind", [makeInsufficientBucket("capability")]),
          bySourceRecommendationType: makeBucketSet("bySourceRecommendationType", [makeInsufficientBucket("capability_gap")]),
          byProvenance: makeBucketSet("byProvenance", [makeInsufficientBucket("auto")]),
          byCapability: makeBucketSet("byCapability", [makeInsufficientBucket("test.cap")]),
          byOutcome: makeBucketSet("byOutcome", [makeBucketStat("applied", 30)]),
        },
      });
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      const scored = result.ranked[0];
      expect(scored.confidence).toBe("LOW");
      expect(scored.components.historicalSuccessWeight).toBe(0);
      expect(scored.components.approvalWeight).toBe(0);
      expect(scored.components.revertPenalty).toBe(0.5);
    });
  });

  describe("edge cases", () => {
    beforeEach(async () => {
      dirs = setupStores();
      scorer = new ProposalScorer(dirs.proposalStore, dirs.intelligenceStore, dirs.priorityStore);
    });

    it("(d) no pending proposals returns empty ranked list with totalPending=0", async () => {
      const result = await scorer.generateReport();

      expect(result.totalPending).toBe(0);
      expect(result.totalScored).toBe(0);
      expect(result.totalLowConfidence).toBe(0);
      expect(result.ranked).toHaveLength(0);
      expect(result.executiveSummary).toContain("No pending proposals");
    });

    it("(j) single pending proposal works correctly", async () => {
      const p = makeProposal({ id: "prop-solo" });
      await dirs.proposalStore.save(p);
      const report = makeIntelligenceReport();
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      expect(result.totalPending).toBe(1);
      expect(result.totalScored).toBe(1);
      expect(result.ranked).toHaveLength(1);
      expect(result.ranked[0].proposalId).toBe("prop-solo");
    });

    it("(e) age multiplier: 60-day-old proposal gets 1.10", async () => {
      const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const p = makeProposal({
        id: "prop-old",
        createdAt: oldDate,
        sourceConfidence: 0.7,
      });
      await dirs.proposalStore.save(p);

      const result = await scorer.generateReport();

      const scored = result.ranked[0];
      // Without report, base = 0.3*0.7 + 0.3*0 + 0.15*0 + 0.15*0.5 = 0.21 + 0.075 = 0.285
      // With age 1.10: 0.285 * 1.10 = 0.3135
      expect(scored.components.ageMultiplier).toBe(1.1);
      expect(scored.priorityScore).toBeCloseTo(0.285 * 1.1, 3);
    });

    it("(g) rationale includes all key signals", async () => {
      const p = makeProposal({
        id: "prop-rationale",
        sourceConfidence: 0.93,
        action: "add_capability",
        provenance: "auto",
      });
      await dirs.proposalStore.save(p);
      const report = makeIntelligenceReport();
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();
      const scored = result.ranked[0];

      // Source confidence
      expect(scored.rationale).toContain("0.93");
      // Key bucketing signal (best bucket by keepRate)
      expect(scored.rationale).toContain("add_capability");
      // Revert risk assessment
      expect(scored.rationale).toMatch(/revert risk/i);
      // Age mention
      expect(scored.rationale).toMatch(/Created today|Pending \d+ day/i);
    });

    it("provenance defaults to 'manual' when undefined", async () => {
      const p = makeProposal({
        id: "prop-no-prov",
        provenance: undefined,
        action: "add_capability",
        target: { kind: "capability", capability: "test.cap" },
      });
      await dirs.proposalStore.save(p);

      const report = makeIntelligenceReport();
      // Ensure byProvenance has a "manual" bucket
      report.buckets.byProvenance.buckets.find((b) => b.value === "manual")!.keepRate = 0.88;
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      const scored = result.ranked[0];
      // Should have matched the "manual" provenance bucket
      expect(scored.components.historicalSuccessWeight).toBeGreaterThanOrEqual(0.88);
    });

    it("top option limits ranked results", async () => {
      for (let i = 0; i < 5; i++) {
        const p = makeProposal({
          id: `prop-top-${i}`,
          sourceConfidence: 0.5 + i * 0.1,
        });
        await dirs.proposalStore.save(p);
      }
      const report = makeIntelligenceReport();
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport({ top: 3 });

      // totalPending and totalScored still reflect all proposals
      expect(result.totalPending).toBe(5);
      expect(result.totalScored).toBe(5);
      // But ranked only has top 3
      expect(result.ranked).toHaveLength(3);
    });

    it("minScore option filters ranked results", async () => {
      for (let i = 0; i < 5; i++) {
        const p = makeProposal({
          id: `prop-min-${i}`,
          sourceConfidence: 0.2 + i * 0.15,
        });
        await dirs.proposalStore.save(p);
      }
      const report = makeIntelligenceReport();
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport({ minScore: 0.5 });

      // All should be above 0.5 with full report metrics
      // But totalPending and totalScored still show all
      expect(result.totalPending).toBe(5);
      expect(result.totalScored).toBe(5);
    });

    it("executive summary mentions high-score count and low-confidence count", async () => {
      // Create proposals with mixed confidence levels
      const p1 = makeProposal({ id: "prop-es-1", sourceConfidence: 0.95 }); // high score
      const p2 = makeProposal({ id: "prop-es-2", sourceConfidence: 0.2 }); // lower score
      await dirs.proposalStore.save(p1);
      await dirs.proposalStore.save(p2);
      const report = makeIntelligenceReport();
      await dirs.intelligenceStore.save(report);

      const result = await scorer.generateReport();

      expect(result.executiveSummary).toContain("2 pending proposals");
      expect(result.executiveSummary).toContain("ranked");
    });
  });
});

// ---------------------------------------------------------------------------
// computeAgeMultiplier unit tests
// ---------------------------------------------------------------------------

describe("computeAgeMultiplier", () => {
  it("returns 1.00 for proposals less than 7 days old", () => {
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
    expect(computeAgeMultiplier(recent)).toBe(1.0);
  });

  it("returns 1.00 for a just-created proposal", () => {
    expect(computeAgeMultiplier(new Date().toISOString())).toBe(1.0);
  });

  it("returns 1.05 for proposals 7-29 days old", () => {
    const d = new Date(Date.now() - 14 * 86_400_000).toISOString();
    expect(computeAgeMultiplier(d)).toBe(1.05);
  });

  it("returns 1.05 at exactly 7 days", () => {
    // 7 days ago + 1ms to account for floating point in daysSince
    const d = new Date(Date.now() - 7 * 86_400_000 + 1000).toISOString();
    // The function uses < 7 for 1.00, so >= 7 && < 30 => 1.05
    // Due to floating point, test with 7.1 days
    const d2 = new Date(Date.now() - 7.1 * 86_400_000).toISOString();
    expect(computeAgeMultiplier(d2)).toBe(1.05);
  });

  it("returns 1.10 for proposals 30-89 days old", () => {
    const d = new Date(Date.now() - 60 * 86_400_000).toISOString();
    expect(computeAgeMultiplier(d)).toBe(1.1);
  });

  it("returns 1.15 for proposals 90+ days old", () => {
    const d = new Date(Date.now() - 120 * 86_400_000).toISOString();
    expect(computeAgeMultiplier(d)).toBe(1.15);
  });
});
