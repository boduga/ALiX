/**
 * P5.3.8 — IntelligenceReporter tests.
 *
 * Verifies that the orchestrator wires all components together, produces a
 * valid IntelligenceReport, and persists it to disk.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProposalStore } from "../../src/adaptation/proposal-store.js";
import { EffectivenessStore } from "../../src/adaptation/effectiveness-store.js";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { ProposalLifecycleAnalyzer } from "../../src/adaptation/proposal-lifecycle-analyzer.js";
import { EffectivenessTrendAnalyzer } from "../../src/adaptation/effectiveness-trend-analyzer.js";
import { BucketAggregator } from "../../src/adaptation/bucket-aggregator.js";
import { RevertSignalAnalyzer } from "../../src/adaptation/revert-signal-analyzer.js";
import { ConfidenceCalibrationAnalyzer } from "../../src/adaptation/confidence-calibration-analyzer.js";
import { IntelligenceReporter } from "../../src/adaptation/intelligence-reporter.js";
import { IntelligenceStore } from "../../src/adaptation/intelligence-store.js";
import type { EnrichedProposal } from "../../src/adaptation/intelligence-types.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";
import type { ProposalEffectivenessReport } from "../../src/adaptation/effectiveness-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProposal(overrides?: Partial<AdaptationProposal>): AdaptationProposal {
  return {
    id: "prop-test-" + Math.random().toString(36).slice(2, 8),
    createdAt: "2026-06-15T00:00:00.000Z",
    status: "applied",
    action: "update_agent_card",
    target: { kind: "agent_card", id: "test.agent" },
    payload: {},
    sourceRecommendationType: "agent_card_update",
    sourceConfidence: 0.85,
    evidenceFingerprints: [],
    reason: "Test",
    approvedBy: "tester",
    approvedAt: "2026-06-15T02:00:00.000Z",
    appliedAt: "2026-06-15T03:00:00.000Z",
    ...overrides,
  };
}
function makeEffectivenessReport(
  proposalId: string,
  recommendation: "keep" | "revert" | "investigate",
  overrides?: Partial<ProposalEffectivenessReport>,
): ProposalEffectivenessReport {
  return {
    proposalId,
    assessedAt: "2026-06-16T00:00:00.000Z",
    appliedAt: "2026-06-15T03:00:00.000Z",
    windowDays: 7,
    metricsBefore: {
      workflowsCompleted: 20,
      workflowsAborted: 5,
      workflowsBlocked: 3,
      unresolvedCapabilities: 10,
      capabilitiesRequested: 20,
      reviewApprovalRate: 0.75,
    },
    metricsAfter: {
      workflowsCompleted: 12,
      workflowsAborted: 2,
      workflowsBlocked: 1,
      unresolvedCapabilities: 5,
      capabilitiesRequested: 15,
      reviewApprovalRate: 0.85,
    },
    primary: {
      metric: "unresolvedCapabilities",
      direction: "lower_is_better",
      before: 10,
      after: 5,
      absoluteDelta: -5,
      relativeDelta: -0.5,
    },
    dataSufficient: true,
    recommendation,
    reason: "Test assessment",
    ...overrides,
  };
}
interface Fixture {
  root: string;
  proposalStore: ProposalStore;
  effectivenessStore: EffectivenessStore;
  evidenceStore: EvidenceStore;
  reporter: IntelligenceReporter;
  intelligenceStore: IntelligenceStore;
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "intel-reporter-"));
  const proposalStore = new ProposalStore(join(root, ".alix", "adaptation", "proposals"));
  const effectivenessStore = new EffectivenessStore(join(root, ".alix", "adaptation", "effectiveness"));
  const evidenceStore = new EvidenceStore({ storeDir: join(root, ".alix", "security") });
  const intelligenceStore = new IntelligenceStore(join(root, ".alix", "adaptation", "intelligence"));

  const lifecycleAnalyzer = new ProposalLifecycleAnalyzer(proposalStore, effectivenessStore, evidenceStore);
  const trendAnalyzer = new EffectivenessTrendAnalyzer();
  const bucketAggregator = new BucketAggregator(trendAnalyzer);
  const revertSignalAnalyzer = new RevertSignalAnalyzer();
  const confidenceCalibrationAnalyzer = new ConfidenceCalibrationAnalyzer();

  const reporter = new IntelligenceReporter(
    lifecycleAnalyzer,
    bucketAggregator,
    revertSignalAnalyzer,
    confidenceCalibrationAnalyzer,
    intelligenceStore,
  );

  return { root, proposalStore, effectivenessStore, evidenceStore, reporter, intelligenceStore };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntelligenceReporter", () => {
  let fix: Fixture;

  beforeEach(() => {
    fix = createFixture();
  });

  afterEach(() => {
    rmSync(fix.root, { recursive: true, force: true });
  });

  it("produces a report with zero proposals when store is empty", async () => {
    const report = await fix.reporter.generateReport();
    expect(report.totalProposalsAnalyzed).toBe(0);
    expect(report.dataWindow.oldestProposalCreatedAt).toBe("");
    expect(report.dataWindow.newestProposalCreatedAt).toBe("");
    expect(report.executiveSummary).toContain("No proposals found");
  });

  it("produces a report with single proposal", async () => {
    const prop = makeProposal({ id: "prop-1" });
    await fix.proposalStore.save(prop);
    await fix.effectivenessStore.save(makeEffectivenessReport("prop-1", "keep"));

    const report = await fix.reporter.generateReport();
    expect(report.totalProposalsAnalyzed).toBe(1);
    expect(report.buckets.byAction.buckets).toHaveLength(1);
    expect(report.buckets.byAction.buckets[0].value).toBe("update_agent_card");
    // Single proposal is below min threshold — insufficient data
    expect(report.buckets.byAction.buckets[0].insufficientData).toBe(true);
    expect(report.confidenceCalibration.totalAssessed).toBe(1);
    expect(report.revertSignalAnalysis.totalAdvisoryReverts).toBe(0);
  });

  it("produces report with sufficient data across multiple buckets", async () => {
    // Seed 6 update_agent_card proposals — 4 keep, 2 revert
    for (let i = 0; i < 6; i++) {
      const id = `prop-upd-${i}`;
      await fix.proposalStore.save(
        makeProposal({ id, action: "update_agent_card", target: { kind: "agent_card", id: "a" } }),
      );
      await fix.effectivenessStore.save(
        makeEffectivenessReport(id, i < 4 ? "keep" : "revert"),
      );
    }

    // Seed 5 add_capability proposals — all keep
    for (let i = 0; i < 5; i++) {
      const id = `prop-cap-${i}`;
      await fix.proposalStore.save(
        makeProposal({ id, action: "add_capability", target: { kind: "agent_card", id: "b" } }),
      );
      await fix.effectivenessStore.save(
        makeEffectivenessReport(id, "keep"),
      );
    }

    const report = await fix.reporter.generateReport({
      minBucketSize: 3, // Lower threshold so 5-6 proposals is sufficient
    });

    expect(report.totalProposalsAnalyzed).toBe(11);
    expect(report.buckets.byAction.buckets).toHaveLength(2);

    const updBucket = report.buckets.byAction.buckets.find((b) => b.value === "update_agent_card");
    const capBucket = report.buckets.byAction.buckets.find((b) => b.value === "add_capability");

    expect(updBucket).toBeDefined();
    expect(capBucket).toBeDefined();
    expect(updBucket!.totalProposals).toBe(6);
    expect(updBucket!.insufficientData).toBe(false);
    expect(updBucket!.keepCount).toBe(4);
    expect(updBucket!.keepRate).toBe(4 / 6);
    expect(capBucket!.totalProposals).toBe(5);
    expect(capBucket!.keepRate).toBe(1.0);

    // Executive summary mentions buckets and keep rate
    expect(report.executiveSummary).toContain("11 proposals");
    expect(report.topPerforming.length).toBeGreaterThanOrEqual(1);
    expect(report.lowestPerforming.length).toBeGreaterThanOrEqual(1);
    expect(report.topPerforming[0].value).toBe("add_capability");
    expect(report.topPerforming[0].keepRate).toBe(1.0);
  });

  it("includes revert signal analysis when reverts exist", async () => {
    // Create 5 proposals, 3 with advisory revert, 2 actually reverted
    for (let i = 0; i < 5; i++) {
      const id = `prop-r-${i}`;
      await fix.proposalStore.save(
        makeProposal({ id, action: "update_agent_card", target: { kind: "agent_card", id: "a" } }),
      );
      await fix.effectivenessStore.save(
        makeEffectivenessReport(id, i < 3 ? "revert" : "keep"),
      );
    }

    // Create a revert proposal for 2 of them
    for (let i = 0; i < 2; i++) {
      const revId = `prop-revert-${i}`;
      await fix.proposalStore.save(
        makeProposal({
          id: revId,
          action: "revert_proposal",
          target: { kind: "revert", sourceProposalId: `prop-r-${i}` },
          status: "applied",
          payload: {},
          sourceRecommendationType: "manual_revert",
        }),
      );
    }

    const report = await fix.reporter.generateReport({
      minBucketSize: 3,
    });

    expect(report.revertSignalAnalysis.totalAdvisoryReverts).toBe(3);
    expect(report.revertSignalAnalysis.totalActualReverts).toBe(2);
    expect(report.revertSignalAnalysis.totalUnactedReverts).toBe(1);
    expect(report.revertSignalAnalysis.revertPrecision).toBe(1.0); // 2 out of 3 reverted were also advisory
  });

  it("persists the report to disk", async () => {
    const prop = makeProposal({ id: "prop-persist" });
    await fix.proposalStore.save(prop);

    const report = await fix.reporter.generateReport();
    expect(report.totalProposalsAnalyzed).toBe(1);

    // Verify report was saved
    const filenames = await fix.intelligenceStore.list();
    expect(filenames.length).toBeGreaterThanOrEqual(1);

    const loaded = await fix.intelligenceStore.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.generatedAt).toBe(report.generatedAt);
  });

  it("executive summary has non-empty content for sufficient data", async () => {
    // Seed enough proposals to have sufficient data
    for (let i = 0; i < 6; i++) {
      const id = `prop-es-${i}`;
      await fix.proposalStore.save(makeProposal({ id }));
      await fix.effectivenessStore.save(makeEffectivenessReport(id, "keep"));
    }

    const report = await fix.reporter.generateReport({
      minBucketSize: 3,
    });

    expect(report.executiveSummary.length).toBeGreaterThan(0);
    expect(report.executiveSummary).toContain("6 proposals");
  });

  it("topPerforming and lowestPerforming are correct", async () => {
    // 6 agent_card proposals (all keep) + 5 skill proposals (mixed)
    for (let i = 0; i < 6; i++) {
      await fix.proposalStore.save(
        makeProposal({ id: `ac-${i}`, action: "update_agent_card", target: { kind: "agent_card", id: "x" } }),
      );
      await fix.effectivenessStore.save(makeEffectivenessReport(`ac-${i}`, "keep"));
    }

    for (let i = 0; i < 5; i++) {
      await fix.proposalStore.save(
        makeProposal({ id: `sk-${i}`, action: "adjust_skill_definition", target: { kind: "skill", id: "y" } }),
      );
      await fix.effectivenessStore.save(
        makeEffectivenessReport(`sk-${i}`, i < 2 ? "keep" : "revert"),
      );
    }

    const report = await fix.reporter.generateReport({ minBucketSize: 3 });

    expect(report.topPerforming.length).toBeGreaterThanOrEqual(1);
    expect(report.lowestPerforming.length).toBeGreaterThanOrEqual(1);

    // agent_card should be top (100% keep)
    const topCard = report.topPerforming.find((r) => r.value === "update_agent_card");
    expect(topCard).toBeDefined();
    expect(topCard!.keepRate).toBe(1.0);

    // skill should be lowest (40% keep)
    const lowSkill = report.lowestPerforming.find((r) => r.value === "adjust_skill_definition");
    expect(lowSkill).toBeDefined();
    expect(lowSkill!.keepRate).toBe(0.4);
  });

  it("filters proposals by minConfidence", async () => {
    for (let i = 0; i < 3; i++) {
      await fix.proposalStore.save(makeProposal({ id: `hc-${i}`, sourceConfidence: 0.9 }));
    }
    for (let i = 0; i < 3; i++) {
      await fix.proposalStore.save(makeProposal({ id: `lc-${i}`, sourceConfidence: 0.5 }));
    }

    const report = await fix.reporter.generateReport({ minConfidence: 0.8 });
    expect(report.totalProposalsAnalyzed).toBe(3);
  });
});
