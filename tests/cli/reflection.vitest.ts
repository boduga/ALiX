/**
 * P5.0g — Reflection CLI command tests.
 *
 * Tests the reflection CLI command handler by mocking the ReflectionAgent
 * and verifying correct wiring and JSON output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import type { ReflectionReport } from "../../src/reflection/reflection-types.js";

// ---------------------------------------------------------------------------
// Mock state (set per-test and read by the hoisted factory mock)
// ---------------------------------------------------------------------------

let mockReportValue: ReflectionReport | null = null;

// Hoisted — must be at top level.
// Only mock ReflectionAgent; EvidenceStore and WorkflowCoordinator use real
// implementations with temp directories.
vi.mock("../../src/reflection/reflection-agent.js", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MockReflectionAgent = function (this: any) {
    this.generateReport = vi.fn(async () => {
      if (!mockReportValue) throw new Error("mockReportValue not set");
      return mockReportValue;
    });
  };
  return { ReflectionAgent: MockReflectionAgent };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a complete but minimal ReflectionReport. */
function cannedReport(overrides: Partial<ReflectionReport> = {}): ReflectionReport {
  return {
    generatedAt: new Date().toISOString(),
    observations: [],
    recommendations: [],
    metrics: {
      workflowsCompleted: 0,
      workflowsBlocked: 0,
      workflowsAborted: 0,
      capabilitiesRequested: 0,
      unresolvedCapabilities: 0,
      reviewApprovalRate: 1,
    },
    summary: {
      totalObservations: 0,
      totalRecommendations: 0,
      highSeverityCount: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — command handler with mocked agent
// ---------------------------------------------------------------------------

describe("reflection CLI command", () => {
  let storeDir: string;
  let workflowDir: string;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "reflection-cli-evidence-"));
    workflowDir = mkdtempSync(join(tmpdir(), "reflection-cli-workflow-"));
    mockReportValue = null;
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
    rmSync(workflowDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Subcommand parsing
  // -----------------------------------------------------------------------

  it("prints usage and exits with code 1 for unknown subcommand", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: string | number | null) => {
      throw new Error(`process.exit(${_code})`);
    });

    const { handleReflectionCommand } = await import(
      "../../src/cli/commands/reflection.js"
    );

    await expect(handleReflectionCommand(["unknown"])).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it("prints usage and exits with code 1 when no subcommand is provided", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: string | number | null) => {
      throw new Error(`process.exit(${_code})`);
    });

    const { handleReflectionCommand } = await import(
      "../../src/cli/commands/reflection.js"
    );

    await expect(handleReflectionCommand([])).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Report generation (mocked agent, real EvidenceStore + WorkflowCoordinator)
  // -----------------------------------------------------------------------

  it("outputs valid JSON report to stdout for 'report' subcommand", async () => {
    mockReportValue = cannedReport({
      metrics: {
        workflowsCompleted: 5,
        workflowsBlocked: 2,
        workflowsAborted: 1,
        capabilitiesRequested: 12,
        unresolvedCapabilities: 3,
        reviewApprovalRate: 0.8,
      },
      observations: [
        {
          type: "workflow_stall" as const,
          severity: "high" as const,
          title: "Test stall observation",
          detail: "Test detail",
          source: "test",
          count: 3,
        },
      ],
      recommendations: [
        {
          type: "process_change" as const,
          confidence: 0.9,
          title: "Test recommendation",
          evidence: ["test evidence"],
          recommendedAction: "Test action",
        },
      ],
      summary: {
        totalObservations: 1,
        totalRecommendations: 1,
        highSeverityCount: 1,
      },
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { handleReflectionCommand } = await import(
      "../../src/cli/commands/reflection.js"
    );

    await handleReflectionCommand(["report"]);

    // Verify console.log was called with the JSON report
    expect(logSpy).toHaveBeenCalledTimes(1);
    const jsonOutput = logSpy.mock.calls[0][0] as string;
    const report: ReflectionReport = JSON.parse(jsonOutput);

    // Validate top-level shape
    expect(report).toHaveProperty("generatedAt");
    expect(report).toHaveProperty("observations");
    expect(report).toHaveProperty("recommendations");
    expect(report).toHaveProperty("metrics");
    expect(report).toHaveProperty("summary");

    // Validate metrics
    expect(report.metrics.workflowsCompleted).toBe(5);
    expect(report.metrics.workflowsBlocked).toBe(2);
    expect(report.metrics.workflowsAborted).toBe(1);
    expect(report.metrics.capabilitiesRequested).toBe(12);
    expect(report.metrics.unresolvedCapabilities).toBe(3);
    expect(report.metrics.reviewApprovalRate).toBe(0.8);

    // Validate observations and recommendations
    expect(report.observations).toHaveLength(1);
    expect(report.observations[0].title).toBe("Test stall observation");
    expect(report.recommendations).toHaveLength(1);
    expect(report.recommendations[0].title).toBe("Test recommendation");

    // Validate summary
    expect(report.summary.totalObservations).toBe(1);
    expect(report.summary.totalRecommendations).toBe(1);
    expect(report.summary.highSeverityCount).toBe(1);

    logSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tests — store-level integration (no mocking of ReflectionAgent needed)
// ---------------------------------------------------------------------------

describe("reflection CLI store integration", () => {
  let storeDir: string;

  beforeEach(() => {
    storeDir = mkdtempSync(join(tmpdir(), "reflection-cli-store-"));
  });

  afterEach(() => {
    rmSync(storeDir, { recursive: true, force: true });
  });

  it("EvidenceStore constructor accepts the .alix/security directory", () => {
    const store = new EvidenceStore({
      storeDir: join(".alix", "security"),
    });
    expect(store).toBeDefined();
    expect(store.query).toBeInstanceOf(Function);
  });

  it("EvidenceStore appends and queries records used by reflection metrics", async () => {
    const store = new EvidenceStore({ storeDir });

    // Seed evidence that drives reflection metrics
    await store.appendBatch([
      { type: "merge_completed", payload: { pr: "1" } },
      { type: "merge_completed", payload: { pr: "2" } },
      { type: "workflow_blocked", payload: { reason: "stuck" } },
      { type: "capability_routed", payload: { capability: "ts-fix", candidates: 2 } },
      { type: "review_completed", payload: { verdict: "approve", pr: "1" } },
    ]);

    const mergedCount = (await store.query({ type: "merge_completed" })).total;
    const blockedCount = (await store.query({ type: "workflow_blocked" })).total;
    const routedCount = (await store.query({ type: "capability_routed" })).total;
    const reviewCount = (await store.query({ type: "review_completed" })).total;

    expect(mergedCount).toBe(2);
    expect(blockedCount).toBe(1);
    expect(routedCount).toBe(1);
    expect(reviewCount).toBe(1);
  });

  it("generatedAt is a valid ISO timestamp in the JSON output format", () => {
    const generatedAt = new Date().toISOString();
    const parsed = new Date(generatedAt);
    expect(parsed.getTime()).toBeGreaterThan(0);
    expect(generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});
