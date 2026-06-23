import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeDashboardIntegrityScore } from "../../src/learning/dashboard-integrity-score.js";
import type { AggregatedIntegrity, ChainAlertPanel } from "../../src/learning/learning-dashboard.js";
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import { ApprovalRecommendationStore } from "../../src/adaptation/approval-recommendation-store.js";
import { LearningStore } from "../../src/learning/learning-store.js";
import { buildDashboardReport } from "../../src/learning/learning-dashboard.js";

// ---------------------------------------------------------------------------
// computeDashboardIntegrityScore tests
// ---------------------------------------------------------------------------

function mockAggregatedIntegrity(overrides: Partial<AggregatedIntegrity> = {}): AggregatedIntegrity {
  return {
    totalExplanations: 20,
    averageCompleteness: 90,
    bestLayer: "Outcome",
    worstLayer: "Governance",
    layerAvailability: { outcome: 100, recommendation: 90, risk: 85, governance: 70, learning: 80, calibration: 75 },
    layerAvailabilityCounts: {
      outcome: { present: 20, missing: 0 },
      recommendation: { present: 18, missing: 2 },
      risk: { present: 17, missing: 3 },
      governance: { present: 14, missing: 6 },
      learning: { present: 16, missing: 4 },
      calibration: { present: 15, missing: 5 },
    },
    evidenceChainUsage: 81,
    fallbackJoinRate: 3,
    incompleteChainCount: 2,
    ...overrides,
  };
}

function emptyAlerts(): ChainAlertPanel {
  return { critical: [], warnings: [], infos: [], totalAlerts: 0 };
}

describe("computeDashboardIntegrityScore", () => {
  it("returns 100 for perfect health", () => {
    const score = computeDashboardIntegrityScore({
      aggregatedIntegrity: mockAggregatedIntegrity({
        averageCompleteness: 100,
        evidenceChainUsage: 100,
        layerAvailabilityCounts: {
          outcome: { present: 20, missing: 0 },
          recommendation: { present: 20, missing: 0 },
          risk: { present: 20, missing: 0 },
          governance: { present: 20, missing: 0 },
          learning: { present: 20, missing: 0 },
          calibration: { present: 20, missing: 0 },
        },
      }),
      chainAlerts: emptyAlerts(),
    });
    expect(score).toBeCloseTo(100, 1);
  });

  it("penalizes missing layers", () => {
    const score = computeDashboardIntegrityScore({
      aggregatedIntegrity: mockAggregatedIntegrity({ averageCompleteness: 100, evidenceChainUsage: 100 }),
      chainAlerts: emptyAlerts(),
    });
    // 100*0.4 + 100*0.3 + (1 - 20/120)*100*0.2 + 100*0.1 = 40 + 30 + 16.7 + 10 = 96.7
    // (20 missing out of 120 slots)
    expect(score).toBeGreaterThan(90);
    expect(score).toBeLessThan(100);
  });

  it("penalizes alerts", () => {
    const score = computeDashboardIntegrityScore({
      aggregatedIntegrity: mockAggregatedIntegrity({ averageCompleteness: 100, evidenceChainUsage: 100, totalExplanations: 20 }),
      chainAlerts: { critical: [{ proposalId: "p-1", severity: "critical", message: "x" }], warnings: [], infos: [], totalAlerts: 1 },
    });
    // With 1 alert out of 20 proposals, alertPenalty = (1 - 1/20) * 100 = 95
    // 40 + 30 + 16.7 + 9.5 = 96.2
    expect(score).toBeGreaterThan(90);
  });
});

// ---------------------------------------------------------------------------
// buildDashboardReport tests
// ---------------------------------------------------------------------------

const OUTCOMES_DIR = join(".alix", "adaptation", "outcomes");
const RECOMMENDATIONS_DIR = join(".alix", "recommendations");
const LEARNING_DIR = join(".alix", "learning");
let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "db-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
});
afterEach(() => { cwdSpy.mockRestore(); rmSync(tempRoot, { recursive: true, force: true }); });

describe("buildDashboardReport", () => {
  it("returns empty report when no stores have data", async () => {
    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90 });
    // Even with empty stores, the integrity panel shows 0/6 layers → completenessPercent=0
    expect(report.schemaVersion).toBe("p8.5b.0");
    expect(report.proposalsScanned).toBe(0);
    expect(report.explanationIntegrity.totalExplanations).toBe(0);
    expect(report.dashboardIntegrityScore).toBe(0);
    expect(report.signals.totalSignals).toBe(0);
  });

  it("aggregates a single seeded proposal", async () => {
    // Seed one OutcomeRecord + one Recommendation
    const os = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await os.append({ id: "out-1", subject: "x", outcome: "success", reasons: [], generatedAt: new Date().toISOString(), subjectId: "prop-1", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7, recommendationId: "rec-1" } as any);
    const rs = new ApprovalRecommendationStore(join(tempRoot, RECOMMENDATIONS_DIR));
    await rs.append({ id: "rec-1", subject: "x", outcome: "recommended", confidence: 0.85, reasons: [], generatedAt: new Date().toISOString(), proposalId: "prop-1", recommendation: "approve" } as any);
    // Seed some LearningSignals
    const ls = new LearningStore(join(tempRoot, LEARNING_DIR));
    await ls.appendSignal({ id: "sig-1", subject: "Overconfidence signal", outcome: "signal_detected", confidence: 0.7, reasons: ["delta"], generatedAt: new Date().toISOString(), sourceReportId: "recommendation-accuracy-window-30", signalType: "overconfidence", strength: 0.7, summary: "x", evidenceRefs: [] });

    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90, generatedAt: "2026-06-23T00:00:00.000Z" });
    expect(report.proposalsScanned).toBeGreaterThanOrEqual(1);
    expect(report.explanationIntegrity.layerAvailability).toBeDefined();
    expect(report.calibrationHealth.adapters.length).toBe(3);
    expect(report.signals.totalSignals).toBeGreaterThanOrEqual(1);
    expect(report.chainAlerts).toBeDefined();
  });

  it("detects missing recommendation (chain integrity alert)", async () => {
    // Seed an OutcomeRecord with a stale recommendationId that has no matching rec
    const os = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
    await os.append({ id: "out-2", subject: "x", outcome: "failure", reasons: [], generatedAt: new Date().toISOString(), subjectId: "prop-2", subjectType: "proposal", actionTaken: "a", observationWindowDays: 7, recommendationId: "rec-MISSING" } as any);
    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90 });
    const criticalAlerts = report.chainAlerts.critical;
    expect(criticalAlerts.some((a) => a.message.includes("Recommendation: MISSING"))).toBe(true);
  });

  it("respects the limit parameter (bounded scan)", async () => {
    // Seed 3 proposals
    for (let i = 0; i < 3; i++) {
      const os = new OutcomeStore(join(tempRoot, OUTCOMES_DIR));
      await os.append({ id: `out-${i}`, subject: "x", outcome: "success", reasons: [], generatedAt: new Date().toISOString(), subjectId: `prop-${i}`, subjectType: "proposal", actionTaken: "a", observationWindowDays: 7 } as any);
    }
    const report = await buildDashboardReport({ cwd: tempRoot, windowDays: 90, limit: 2 });
    expect(report.proposalsScanned).toBeLessThanOrEqual(2);
  });
});
