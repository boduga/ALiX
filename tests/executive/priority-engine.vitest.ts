/**
 * P10.1 — Priority Engine unit tests.
 *
 * @module
 */

import { describe, it, expect } from "vitest";
import {
  computePriorityScore,
  computeTrendScore,
  buildPriorityReport,
} from "../../src/executive/priority-engine.js";
import type { ExecutiveHealthReport } from "../../src/executive/executive-health.js";
import type { ExecutiveTrendSnapshot } from "../../src/executive/trend-store.js";

function makeHealthReport(
  overrides?: Partial<ExecutiveHealthReport>,
): ExecutiveHealthReport {
  return {
    schemaVersion: "p10.0.0",
    generatedAt: "2026-06-24T00:00:00.000Z",
    windowDays: 90,
    overallScore: 78,
    rankedSubsystems: [
      { subsystem: "tools", score: 54, status: "critical", summary: "tools at 54", topIssues: [] },
      { subsystem: "memory", score: 68, status: "warning", summary: "memory at 68", topIssues: [] },
      { subsystem: "learning", score: 76, status: "warning", summary: "learning at 76", topIssues: [] },
      { subsystem: "workflow", score: 79, status: "warning", summary: "workflow at 79", topIssues: [] },
      { subsystem: "agents", score: 82, status: "healthy", summary: "agents at 82", topIssues: [] },
      { subsystem: "adaptation", score: 88, status: "healthy", summary: "adaptation at 88", topIssues: [] },
      { subsystem: "governance", score: 91, status: "healthy", summary: "governance at 91", topIssues: [] },
      { subsystem: "security", score: 95, status: "healthy", summary: "security at 95", topIssues: [] },
    ],
    ...overrides,
  };
}

function makeSnapshot(
  scores: Record<string, number>,
): ExecutiveTrendSnapshot {
  return {
    id: "exec-trend-test",
    generatedAt: "2026-06-23T00:00:00.000Z",
    windowDays: 90,
    subsystemScores: scores as any,
  };
}

describe("computePriorityScore", () => {
  it("returns expected composite for known inputs", () => {
    // healthDeficit=46, trendScore=100, blastRadius=40 (tools)
    // 46*0.60 + 100*0.25 + 40*0.15 = 27.6 + 25 + 6 = 58.6
    const result = computePriorityScore(46, 100, 40);
    expect(result).toBeCloseTo(58.6, 1);
  });

  it("returns 0 when all factors are 0", () => {
    expect(computePriorityScore(0, 0, 0)).toBe(0);
  });

  it("returns 100 when all factors are 100", () => {
    expect(computePriorityScore(100, 100, 100)).toBe(100);
  });
});

describe("computeTrendScore", () => {
  it("returns 100 for sharp decline (delta = -25)", () => {
    expect(computeTrendScore(55, 80)).toBe(100);
  });

  it("returns 50 for stable (delta = 0)", () => {
    expect(computeTrendScore(80, 80)).toBe(50);
  });

  it("returns 0 for strong improvement (delta = +15)", () => {
    expect(computeTrendScore(95, 80)).toBe(0);
  });

  it("returns 25 when no prior snapshot exists", () => {
    expect(computeTrendScore(80, undefined)).toBe(25);
  });
});

describe("buildPriorityReport", () => {
  it("returns schemaVersion p10.1.0 and 8 entries", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    expect(report.schemaVersion).toBe("p10.1.0");
    expect(report.priorities.length).toBe(8);
  });

  it("sorts entries descending by priorityScore", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    for (let i = 1; i < report.priorities.length; i++) {
      expect(report.priorities[i - 1].priorityScore).toBeGreaterThanOrEqual(
        report.priorities[i].priorityScore,
      );
    }
  });

  it("includes factorBreakdown with 3 entries per subsystem", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    for (const entry of report.priorities) {
      expect(entry.factorBreakdown.length).toBe(3);
      const names = entry.factorBreakdown.map((f) => f.name);
      expect(names).toContain("Health Deficit");
      expect(names).toContain("Trend");
      expect(names).toContain("Blast Radius");
    }
  });

  it("computes healthDeficit = 100 - score", () => {
    const health = makeHealthReport();
    const report = buildPriorityReport(health, null);
    const tools = report.priorities.find((p) => p.subsystem === "tools");
    expect(tools?.healthDeficit).toBe(46);
  });
});
