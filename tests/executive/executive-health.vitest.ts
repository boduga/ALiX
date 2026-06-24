/**
 * P10.0 — Executive Intelligence aggregator unit tests.
 *
 * 9 tests covering: schema shape, all-8 subsystems present, worst-first
 * ordering, overall-score computation, status mapping, generatedAt +
 * windowDays passthrough, default-window fallback, and failure-tolerance
 * (one bad adapter does not sink the whole report).
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// --- Mocks for the 6 Tier-2 adapters + the 3 governance/learning sources.
// vi.mock is hoisted; the per-test override is set in beforeEach.
vi.mock("../../src/executive/adapters/adaptation-health.js", () => ({
  buildAdaptationHealth: vi.fn(),
}));
vi.mock("../../src/executive/adapters/agent-health.js", () => ({
  buildAgentHealth: vi.fn(),
}));
vi.mock("../../src/executive/adapters/tool-health.js", () => ({
  buildToolHealth: vi.fn(),
}));
vi.mock("../../src/executive/adapters/workflow-health.js", () => ({
  buildWorkflowHealth: vi.fn(),
}));
vi.mock("../../src/executive/adapters/memory-health.js", () => ({
  buildMemoryHealth: vi.fn(),
}));
vi.mock("../../src/executive/adapters/security-health.js", () => ({
  buildSecurityHealth: vi.fn(),
}));
vi.mock("../../src/governance/governance-health-builder.js", () => ({
  buildGovernanceHealth: vi.fn(),
}));
vi.mock("../../src/governance/governance-assessment.js", () => ({
  buildGovernanceAssessment: vi.fn(),
}));
vi.mock("../../src/learning/learning-dashboard.js", () => ({
  buildDashboardReport: vi.fn(),
}));

import { buildExecutiveHealthReport } from "../../src/executive/executive-health.js";
import { buildAdaptationHealth } from "../../src/executive/adapters/adaptation-health.js";
import { buildAgentHealth } from "../../src/executive/adapters/agent-health.js";
import { buildToolHealth } from "../../src/executive/adapters/tool-health.js";
import { buildWorkflowHealth } from "../../src/executive/adapters/workflow-health.js";
import { buildMemoryHealth } from "../../src/executive/adapters/memory-health.js";
import { buildSecurityHealth } from "../../src/executive/adapters/security-health.js";
import { buildGovernanceHealth } from "../../src/governance/governance-health-builder.js";
import { buildGovernanceAssessment } from "../../src/governance/governance-assessment.js";
import { buildDashboardReport } from "../../src/learning/learning-dashboard.js";

const adapterMock = {
  buildAdaptationHealth: buildAdaptationHealth as unknown as ReturnType<typeof vi.fn>,
  buildAgentHealth: buildAgentHealth as unknown as ReturnType<typeof vi.fn>,
  buildToolHealth: buildToolHealth as unknown as ReturnType<typeof vi.fn>,
  buildWorkflowHealth: buildWorkflowHealth as unknown as ReturnType<typeof vi.fn>,
  buildMemoryHealth: buildMemoryHealth as unknown as ReturnType<typeof vi.fn>,
  buildSecurityHealth: buildSecurityHealth as unknown as ReturnType<typeof vi.fn>,
  buildGovernanceHealth: buildGovernanceHealth as unknown as ReturnType<typeof vi.fn>,
  buildGovernanceAssessment: buildGovernanceAssessment as unknown as ReturnType<typeof vi.fn>,
  buildDashboardReport: buildDashboardReport as unknown as ReturnType<typeof vi.fn>,
};

let cwd: string;
const GENERATED_AT = "2026-06-24T12:00:00.000Z";

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "exec-health-"));
  // Default: all adapters return perfect score 100.
  adapterMock.buildAdaptationHealth.mockResolvedValue({ score: 100, summary: "adapt", topIssues: [] });
  adapterMock.buildAgentHealth.mockResolvedValue({ score: 100, summary: "agents", topIssues: [] });
  adapterMock.buildToolHealth.mockResolvedValue({ score: 100, summary: "tools", topIssues: [] });
  adapterMock.buildWorkflowHealth.mockResolvedValue({ score: 100, summary: "workflow", topIssues: [] });
  adapterMock.buildMemoryHealth.mockResolvedValue({ score: 100, summary: "memory", topIssues: [] });
  adapterMock.buildSecurityHealth.mockResolvedValue({ score: 100, summary: "security", topIssues: [] });
  // Governance: return a real (non-null) health report so the synchronous
  // buildGovernanceAssessment call inside the aggregator has something to
  // assess. The assessment is now called synchronously (post-Promise.all),
  // so it uses mockReturnValue rather than mockResolvedValue.
  adapterMock.buildGovernanceHealth.mockResolvedValue({
    reportType: "governance_health",
    id: "test",
    subject: "test",
    outcome: "ok",
    confidence: 1,
    reasons: [],
    generatedAt: GENERATED_AT,
    totalReviews: 0,
    totalProposals: 0,
    lensEffectiveness: {},
    policyCoverage: 0,
    sourceMetrics: {
      dashboardIntegrityScore: null,
      explanationCompleteness: null,
      evidenceChainUsage: null,
      incompleteChainLayers: 0,
    },
  });
  adapterMock.buildGovernanceAssessment.mockReturnValue({
    governanceConfidence: 1.0,
    unresolvedGovernanceIssues: 0,
  } as never);
  adapterMock.buildDashboardReport.mockResolvedValue({
    dashboardIntegrityScore: 100,
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(cwd, { recursive: true, force: true });
});

describe("buildExecutiveHealthReport", () => {
  it("returns a p10.0.0 report with the expected top-level shape", async () => {
    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: GENERATED_AT });
    expect(report.schemaVersion).toBe("p10.0.0");
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.windowDays).toBe(30);
    expect(typeof report.overallScore).toBe("number");
    expect(Array.isArray(report.rankedSubsystems)).toBe(true);
  });

  it("returns exactly 8 ranked subsystems covering all expected names", async () => {
    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: GENERATED_AT });
    expect(report.rankedSubsystems).toHaveLength(8);
    const names = report.rankedSubsystems.map((s) => s.subsystem).sort();
    expect(names).toEqual([
      "adaptation",
      "agents",
      "governance",
      "learning",
      "memory",
      "security",
      "tools",
      "workflow",
    ]);
  });

  it("sorts subsystems worst-first (ascending score)", async () => {
    // Stagger scores so order is deterministic.
    adapterMock.buildAdaptationHealth.mockResolvedValue({ score: 100, summary: "a", topIssues: [] });
    adapterMock.buildAgentHealth.mockResolvedValue({ score: 30, summary: "agents", topIssues: ["bad"] });
    adapterMock.buildToolHealth.mockResolvedValue({ score: 90, summary: "tools", topIssues: [] });
    adapterMock.buildWorkflowHealth.mockResolvedValue({ score: 70, summary: "workflow", topIssues: [] });
    adapterMock.buildMemoryHealth.mockResolvedValue({ score: 50, summary: "memory", topIssues: [] });
    adapterMock.buildSecurityHealth.mockResolvedValue({ score: 80, summary: "security", topIssues: [] });
    adapterMock.buildGovernanceAssessment.mockReturnValue({
      governanceConfidence: 0.6,
      unresolvedGovernanceIssues: 1,
    } as never);
    adapterMock.buildDashboardReport.mockResolvedValue({ dashboardIntegrityScore: 60 } as never);

    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: GENERATED_AT });
    const scores = report.rankedSubsystems.map((s) => s.score);
    const sorted = [...scores].sort((a, b) => a - b);
    expect(scores).toEqual(sorted);
  });

  it("computes overallScore as the rounded mean of subsystem scores", async () => {
    adapterMock.buildAdaptationHealth.mockResolvedValue({ score: 80, summary: "a", topIssues: [] });
    adapterMock.buildAgentHealth.mockResolvedValue({ score: 60, summary: "b", topIssues: [] });
    adapterMock.buildToolHealth.mockResolvedValue({ score: 100, summary: "c", topIssues: [] });
    adapterMock.buildWorkflowHealth.mockResolvedValue({ score: 100, summary: "d", topIssues: [] });
    adapterMock.buildMemoryHealth.mockResolvedValue({ score: 100, summary: "e", topIssues: [] });
    adapterMock.buildSecurityHealth.mockResolvedValue({ score: 100, summary: "f", topIssues: [] });
    adapterMock.buildGovernanceAssessment.mockReturnValue({ governanceConfidence: 0.8, unresolvedGovernanceIssues: 0 } as never);
    adapterMock.buildDashboardReport.mockResolvedValue({ dashboardIntegrityScore: 100 } as never);

    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: GENERATED_AT });
    // Sum: 80 + 60 + 100*5 + 80 = 720; mean = 90.
    expect(report.overallScore).toBe(90);
  });

  it("maps scores to status using the critical<60 / warning<80 / healthy boundaries", async () => {
    adapterMock.buildAdaptationHealth.mockResolvedValue({ score: 100, summary: "a", topIssues: [] });
    adapterMock.buildAgentHealth.mockResolvedValue({ score: 55, summary: "critical-agent", topIssues: [] });
    adapterMock.buildToolHealth.mockResolvedValue({ score: 79, summary: "warning-tool", topIssues: [] });
    adapterMock.buildWorkflowHealth.mockResolvedValue({ score: 100, summary: "d", topIssues: [] });
    adapterMock.buildMemoryHealth.mockResolvedValue({ score: 100, summary: "e", topIssues: [] });
    adapterMock.buildSecurityHealth.mockResolvedValue({ score: 100, summary: "f", topIssues: [] });
    adapterMock.buildGovernanceAssessment.mockReturnValue({ governanceConfidence: 0.4, unresolvedGovernanceIssues: 0 } as never);
    adapterMock.buildDashboardReport.mockResolvedValue({ dashboardIntegrityScore: 100 } as never);

    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: GENERATED_AT });
    const byName = Object.fromEntries(report.rankedSubsystems.map((s) => [s.subsystem, s]));
    expect(byName.governance!.status).toBe("critical");   // 0.4 * 100 = 40
    expect(byName.agents!.status).toBe("critical");        // 55
    expect(byName.tools!.status).toBe("warning");          // 79
    expect(byName.adaptation!.status).toBe("healthy");     // 100
  });

  it("uses the provided generatedAt verbatim and a 30-day window", async () => {
    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: GENERATED_AT });
    expect(report.generatedAt).toBe(GENERATED_AT);
    expect(report.windowDays).toBe(30);
    // Sanity: every adapter received the same window + generatedAt.
    for (const fn of [
      adapterMock.buildAdaptationHealth,
      adapterMock.buildAgentHealth,
      adapterMock.buildToolHealth,
      adapterMock.buildWorkflowHealth,
      adapterMock.buildMemoryHealth,
      adapterMock.buildSecurityHealth,
    ]) {
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ cwd, windowDays: 30, generatedAt: GENERATED_AT }),
      );
    }
  });

  it("falls back to the default 90-day window when windowDays is omitted (runtime behavior)", async () => {
    // The public type marks windowDays as required, but the runtime
    // applies a 90-day default via `?? DEFAULT_WINDOW_DAYS`. Verify that
    // fallback using a structural cast that bypasses the type check.
    const report = await buildExecutiveHealthReport(
      { cwd, generatedAt: GENERATED_AT } as unknown as { cwd: string; windowDays: number },
    );
    expect(report.windowDays).toBe(90);
  });

  it("produces a generatedAt when none is provided (uses current ISO time)", async () => {
    const before = Date.now();
    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30 });
    const after = Date.now();
    const generated = Date.parse(report.generatedAt);
    expect(Number.isFinite(generated)).toBe(true);
    expect(generated).toBeGreaterThanOrEqual(before);
    expect(generated).toBeLessThanOrEqual(after);
  });

  it("tolerates a single failing adapter by scoring that subsystem as critical (0) without throwing", async () => {
    adapterMock.buildAdaptationHealth.mockResolvedValue({ score: 100, summary: "a", topIssues: [] });
    adapterMock.buildAgentHealth.mockResolvedValue({ score: 100, summary: "b", topIssues: [] });
    adapterMock.buildToolHealth.mockResolvedValue({ score: 100, summary: "c", topIssues: [] });
    adapterMock.buildWorkflowHealth.mockResolvedValue({ score: 100, summary: "d", topIssues: [] });
    adapterMock.buildMemoryHealth.mockResolvedValue({ score: 100, summary: "e", topIssues: [] });
    adapterMock.buildSecurityHealth.mockRejectedValue(new Error("boom"));
    adapterMock.buildGovernanceAssessment.mockReturnValue({ governanceConfidence: 1, unresolvedGovernanceIssues: 0 } as never);
    adapterMock.buildDashboardReport.mockResolvedValue({ dashboardIntegrityScore: 100 } as never);

    const report = await buildExecutiveHealthReport({ cwd, windowDays: 30, generatedAt: GENERATED_AT });
    const security = report.rankedSubsystems.find((s) => s.subsystem === "security");
    expect(security).toBeDefined();
    expect(security!.score).toBe(0);
    expect(security!.status).toBe("critical");
    expect(security!.summary).toMatch(/unavailable/);
  });
});
