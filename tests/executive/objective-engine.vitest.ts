/**
 * P10.2 — Executive Objective Engine tests.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { buildObjectiveReport } from "../../src/executive/objective-engine.js";
import type { ExecutiveHealthReport } from "../../src/executive/executive-health.js";
import type { ExecutivePriorityReport, ExecutivePriorityEntry } from "../../src/executive/priority-engine.js";
import type { InvestigationRecommendation } from "../../src/governance/investigation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePriorityEntry(overrides: Partial<ExecutivePriorityEntry> = {}): ExecutivePriorityEntry {
  return {
    subsystem: "governance",
    healthScore: 65,
    healthDeficit: 35,
    trendScore: 25,
    blastRadius: 100,
    priorityScore: 65.0,
    factorBreakdown: [
      { name: "Health Deficit", weight: 0.6, value: 35 },
      { name: "Trend", weight: 0.25, value: 25 },
      { name: "Blast Radius", weight: 0.15, value: 100 },
    ],
    summary: "governance score 65, priority 65.0",
    ...overrides,
  };
}

function makeHealthReport(overrides: Partial<ExecutiveHealthReport> = {}): ExecutiveHealthReport {
  return {
    schemaVersion: "p10.0.0",
    generatedAt: "2026-06-24T12:00:00.000Z",
    windowDays: 90,
    overallScore: 75,
    rankedSubsystems: [
      { subsystem: "governance", score: 65, summary: "Governance health", status: "warning", topIssues: ["Chain coverage dropping"] },
      { subsystem: "security", score: 92, summary: "Security health", status: "healthy", topIssues: [] },
      { subsystem: "adaptation", score: 78, summary: "Adaptation health", status: "warning", topIssues: ["Success rate declining"] },
      { subsystem: "learning", score: 85, summary: "Learning health", status: "healthy", topIssues: [] },
      { subsystem: "memory", score: 88, summary: "Memory health", status: "healthy", topIssues: [] },
      { subsystem: "tools", score: 70, summary: "Tools health", status: "warning", topIssues: ["Tool reliability"] },
      { subsystem: "workflow", score: 82, summary: "Workflow health", status: "healthy", topIssues: [] },
      { subsystem: "agents", score: 90, summary: "Agent health", status: "healthy", topIssues: [] },
    ],
    ...overrides,
  };
}

function makePriorityReport(overrides: Partial<ExecutivePriorityReport> = {}): ExecutivePriorityReport {
  return {
    schemaVersion: "p10.1.0",
    generatedAt: "2026-06-24T12:00:00.000Z",
    windowDays: 90,
    priorities: [
      makePriorityEntry({ subsystem: "governance", healthScore: 65, priorityScore: 65.0 }),
      makePriorityEntry({ subsystem: "tools", healthScore: 70, priorityScore: 55.0 }),
      makePriorityEntry({ subsystem: "adaptation", healthScore: 78, priorityScore: 50.0 }),
      makePriorityEntry({ subsystem: "learning", healthScore: 85, priorityScore: 40.0 }),
      makePriorityEntry({ subsystem: "memory", healthScore: 88, priorityScore: 35.0 }),
      makePriorityEntry({ subsystem: "workflow", healthScore: 82, priorityScore: 30.0 }),
      makePriorityEntry({ subsystem: "agents", healthScore: 90, priorityScore: 25.0 }),
      makePriorityEntry({ subsystem: "security", healthScore: 92, priorityScore: 20.0 }),
    ],
    ...overrides,
  };
}

function makeInvestigation(overrides: Partial<InvestigationRecommendation> = {}): InvestigationRecommendation {
  return {
    id: "inv-001",
    kind: "chain_restoration",
    status: "open",
    severity: "high",
    source: "drift",
    sourceArtifactId: "drift-001",
    evidenceRefs: [],
    title: "Test investigation",
    description: "Test",
    operatorGuidance: "Investigate",
    createdAt: "2026-06-24T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildObjectiveReport", () => {
  it("returns at most one objective per subsystem (0–8)", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    expect(report.objectives.length).toBeLessThanOrEqual(8);
    const subsystems = report.objectives.map((o) => o.targetSubsystems[0]);
    const unique = new Set(subsystems);
    expect(unique.size).toBe(report.objectives.length);
  });

  it("assigns stabilize type to subsystems with score < 80 and high priority", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const gov = report.objectives.find((o) => o.targetSubsystems[0] === "governance");
    expect(gov).toBeDefined();
    expect(gov!.objectiveType).toBe("stabilize");
  });

  it("assigns investigate type when governance investigations exist", async () => {
    const health = makeHealthReport();
    // Make governance score high so it doesn't qualify for stabilize
    health.rankedSubsystems[0] = { subsystem: "governance", score: 85, summary: "ok", status: "healthy", topIssues: [] };
    const priority = makePriorityReport();
    priority.priorities[0] = makePriorityEntry({ subsystem: "governance", healthScore: 85, priorityScore: 40 });
    const investigations = [
      makeInvestigation({ id: "inv-gov" }),
    ];

    const report = buildObjectiveReport(health, priority, investigations);
    const gov = report.objectives.find((o) => o.targetSubsystems[0] === "governance");
    expect(gov).toBeDefined();
    expect(gov!.objectiveType).toBe("investigate");
    expect(gov!.supportingInvestigations).toContain("inv-gov");
  });

  it("assigns improve type to healthy subsystems (score >= 80) without investigations", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const learning = report.objectives.find((o) => o.targetSubsystems[0] === "learning");
    expect(learning).toBeDefined();
    expect(learning!.objectiveType).toBe("improve");
  });

  it("assigns maintain type to subsystems with score >= 90", async () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const security = report.objectives.find((o) => o.targetSubsystems[0] === "security");
    expect(security).toBeDefined();
    expect(security!.objectiveType).toBe("maintain");
  });

  it("computes objectiveScore using the 4-component weighted formula", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const gov = report.objectives.find((o) => o.targetSubsystems[0] === "governance");
    expect(gov).toBeDefined();
    expect(gov!.objectiveScore).toBeGreaterThan(0);
    expect(gov!.objectiveScore).toBeLessThanOrEqual(100);
    // governance: priorityScore=65, healthImpact=35, persistenceScore=25, investigationPressure=0
    // expected: 65*0.4 + 35*0.3 + 25*0.2 + 0*0.1 = 26 + 10.5 + 5 + 0 = 41.5 => Math.round = 42
    expect(gov!.objectiveScore).toBe(42);
  });

  it("separates priorityScore (from P10.1) from objectiveScore (computed by P10.2)", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const obj = report.objectives[0];
    expect(obj.priorityScore).toBeDefined();
    expect(obj.objectiveScore).toBeDefined();
    expect(obj.priorityScore).not.toEqual(obj.objectiveScore);
  });

  it("includes derivedFrom provenance with priorityReportGeneratedAt and investigationIds", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    const obj = report.objectives[0];
    expect(obj.derivedFrom).toBeDefined();
    expect(obj.derivedFrom.priorityReportGeneratedAt).toBe("2026-06-24T12:00:00.000Z");
    expect(Array.isArray(obj.derivedFrom.investigationIds)).toBe(true);
  });

  it("sorts objectives by objectiveScore descending", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    for (let i = 1; i < report.objectives.length; i++) {
      expect(report.objectives[i - 1].objectiveScore).toBeGreaterThanOrEqual(report.objectives[i].objectiveScore);
    }
  });

  it("sets generatedAt from healthReport.generatedAt (not fresh Date)", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    expect(report.generatedAt).toBe("2026-06-24T12:00:00.000Z");
  });

  it("sets schemaVersion to p10.2.0", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    expect(report.schemaVersion).toBe("p10.2.0");
  });

  it("has status proposed on all new objectives", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    for (const obj of report.objectives) {
      expect(obj.status).toBe("proposed");
    }
  });

  it("includes evidenceRefs on every objective", () => {
    const report = buildObjectiveReport(makeHealthReport(), makePriorityReport(), []);
    for (const obj of report.objectives) {
      expect(Array.isArray(obj.evidenceRefs)).toBe(true);
    }
  });

  it("maps investigations to governance subsystem only", async () => {
    const health = makeHealthReport();
    // Make governance score high so it doesn't qualify for stabilize
    health.rankedSubsystems[0] = { subsystem: "governance", score: 85, summary: "ok", status: "healthy", topIssues: [] };
    const priority = makePriorityReport();
    priority.priorities[0] = makePriorityEntry({ subsystem: "governance", healthScore: 85, priorityScore: 40 });
    const investigations = [makeInvestigation({ id: "inv-gov" })];

    const report = buildObjectiveReport(health, priority, investigations);
    // Governance should have investigate type
    const gov = report.objectives.find((o) => o.targetSubsystems[0] === "governance");
    expect(gov).toBeDefined();
    expect(gov!.objectiveType).toBe("investigate");
    // Security (no investigations) should NOT have investigate type
    const security = report.objectives.find((o) => o.targetSubsystems[0] === "security");
    expect(security).toBeDefined();
    expect(security!.objectiveType).not.toBe("investigate");
  });
});
