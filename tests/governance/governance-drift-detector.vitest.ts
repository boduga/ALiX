/**
 * P9.0d — GovernanceDriftDetector tests.
 *
 * 4 tests:
 *   1. Empty stores — no findings.
 *   2. Confidence drift detected when overconfidence > 60% of total signals
 *      (seed 8 over, 3 under → ratio 0.727 > 0.6, total 11 > 10).
 *   3. Chain coverage drop detected when evidenceChainUsage < 60%.
 *   4. Lens drift detected when calibration profile predictiveValue < 0.4.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock buildDashboardReport so chain-coverage tests can control the metric.
vi.mock("../../src/learning/learning-dashboard.js", () => ({
  buildDashboardReport: vi.fn(),
}));

import { detectGovernanceDrift } from "../../src/governance/governance-drift-detector.js";
import { buildDashboardReport } from "../../src/learning/learning-dashboard.js";
import { LearningStore } from "../../src/learning/learning-store.js";
import type { DashboardReport } from "../../src/learning/learning-dashboard.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "gov-drift-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  // Default mock: healthy dashboard (no chain coverage alarm).
  vi.mocked(buildDashboardReport).mockResolvedValue(
    makeDashboard({ evidenceChainUsage: 85 }),
  );
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recentISO(minutesAgo = 0): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

/** Build a minimal valid DashboardReport for the mock. */
function makeDashboard(
  overrides: Partial<{
    evidenceChainUsage: number;
    proposalsScanned: number;
  }> = {},
): DashboardReport {
  const proposalsScanned = overrides.proposalsScanned ?? 10;
  return {
    schemaVersion: "p8.5b.0",
    generatedAt: "2026-06-23T00:00:00.000Z",
    windowDays: 90,
    proposalsScanned,
    dashboardIntegrityScore: overrides.evidenceChainUsage ?? 85,
    explanationIntegrity: {
      totalExplanations: proposalsScanned,
      averageCompleteness: 80,
      bestLayer: "outcome",
      worstLayer: "calibration",
      layerAvailability: {},
      layerAvailabilityCounts: {},
      evidenceChainUsage: overrides.evidenceChainUsage ?? 85,
      fallbackJoinRate: 5,
      incompleteChainCount: 0,
    },
    calibrationHealth: { adapters: [] },
    signals: { totalSignals: 0, signals: [] },
    joinPathAnalysis: {
      distribution: {},
      joinPathByLayer: {},
      bestLayer: { name: "outcome", rate: 90 },
      worstLayer: { name: "calibration", rate: 10 },
      heuristicLayers: [],
    },
    chainAlerts: {
      critical: [],
      warnings: [],
      infos: [],
      totalAlerts: 0,
    },
  };
}

const LEARNING_DIR = join(".alix", "learning");

// ---------------------------------------------------------------------------
// Test 1: Empty stores — no findings
// ---------------------------------------------------------------------------

describe("detectGovernanceDrift", () => {
  it("returns no findings when no signals or profiles exist", async () => {
    const report = await detectGovernanceDrift({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    expect(report.reportType).toBe("governance_drift");
    expect(report.findings).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Confidence drift
  // ---------------------------------------------------------------------------

  it("detects confidence drift when overconfidence exceeds 60% of total confidence signals", async () => {
    const store = new LearningStore(join(tempRoot, LEARNING_DIR));

    // Seed 8 overconfidence + 3 underconfidence = 11 total (> 10 threshold).
    // Ratio: 8/11 ≈ 0.727 > 0.6.
    for (let i = 0; i < 8; i++) {
      await store.appendSignal({
        id: `over-${i}`,
        subject: "Confidence signal",
        outcome: "observed",
        confidence: 0.85,
        reasons: ["test"],
        generatedAt: recentISO(i),
        sourceReportId: "test-report",
        signalType: "overconfidence",
        strength: 0.8,
        summary: "Overconfidence detected",
        evidenceRefs: [],
      });
    }
    for (let i = 0; i < 3; i++) {
      await store.appendSignal({
        id: `under-${i}`,
        subject: "Confidence signal",
        outcome: "observed",
        confidence: 0.85,
        reasons: ["test"],
        generatedAt: recentISO(i),
        sourceReportId: "test-report",
        signalType: "underconfidence",
        strength: 0.3,
        summary: "Underconfidence detected",
        evidenceRefs: [],
      });
    }

    const report = await detectGovernanceDrift({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    const drift = report.findings.find(
      (f) => f.driftType === "confidence_drift",
    );
    expect(drift).toBeDefined();
    // Ratio 0.727 → medium (0.6-0.75 bracket)
    expect(drift!.severity).toBe("medium");
    // 11 total → 10-20 bracket → confidence 0.5
    expect(drift!.confidence).toBe(0.5);
    // Description should include the ratio
    expect(drift!.description).toContain("72.7%");
    expect(drift!.description).toContain("8/11");
  });

  // ---------------------------------------------------------------------------
  // Test 3: Chain coverage drop
  // ---------------------------------------------------------------------------

  it("detects chain coverage drop when evidenceChainUsage falls below 60%", async () => {
    // Override mock: low evidence chain usage
    vi.mocked(buildDashboardReport).mockResolvedValue(
      makeDashboard({ evidenceChainUsage: 45, proposalsScanned: 15 }),
    );

    const report = await detectGovernanceDrift({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    const drift = report.findings.find(
      (f) => f.driftType === "chain_coverage_drop",
    );
    expect(drift).toBeDefined();
    // 40-60% range → medium severity
    expect(drift!.severity).toBe("medium");
    // Confidence fixed at 0.7 per spec
    expect(drift!.confidence).toBe(0.7);
    expect(drift!.description).toContain("45%");
    expect(drift!.description).toContain("15 proposals");
  });

  // ---------------------------------------------------------------------------
  // Test 4: Lens drift
  // ---------------------------------------------------------------------------

  it("detects lens drift when calibration profile predictiveValue drops below 0.4", async () => {
    const store = new LearningStore(join(tempRoot, LEARNING_DIR));

    // Seed a calibration profile with degraded predictive value (confidence < 0.4).
    await store.appendProfile({
      id: "cp-degraded-lens",
      subject: "Lens calibration",
      outcome: "profile_generated",
      confidence: 0.3, // below 0.4 threshold → degraded
      reasons: ["signal-based"],
      generatedAt: recentISO(),
      target: "governance_lens_weight",
      targetName: "stale_reviewer",
      previousValue: 0.5,
      suggestedValue: 0.3,
      reason: "High false-alarm rate observed",
      evidenceRefs: [],
      sourceSignalIds: ["sig-1", "sig-2"],
    });

    const report = await detectGovernanceDrift({
      cwd: tempRoot,
      windowDays: 90,
      generatedAt: "2026-06-23T00:00:00.000Z",
    });

    const drift = report.findings.find((f) => f.driftType === "lens_drift");
    expect(drift).toBeDefined();
    // predictiveValue 0.3 >= 0.2 → medium severity
    expect(drift!.severity).toBe("medium");
    expect(drift!.confidence).toBe(0.7);
    expect(drift!.description).toContain("stale_reviewer");
    expect(drift!.description).toContain("30");
  });
});
