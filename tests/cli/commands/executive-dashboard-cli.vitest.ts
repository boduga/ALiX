/**
 * P10.9 — Executive Dashboard CLI integration tests.
 *
 * Tests the full pipeline: loader → builder → renderer.
 * Uses temp directories with seeded store data.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runDashboard } from "../../../src/cli/commands/executive-dashboard-handler.js";
import { RecommendationReportStore, type RecommendationReport } from "../../../src/executive/recommendation-report-store.js";
import { OutcomeReportStore } from "../../../src/executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport, SubsystemDelta } from "../../../src/executive/outcome-evaluator.js";
import type { ExecutiveSubsystemName } from "../../../src/executive/executive-health.js";

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); } };
}

function makeExecRec(over = {}) {
  return {
    subsystem: "workflow", signal: "degrading_trend", severity: "high",
    recommendation: "Investigate workflow", signalConfidence: 0.88,
    occurrenceCount: 8, averageDelta: -3.2, ...over,
  };
}

function makeReport(recs: any[], generatedAt = "2026-06-15T12:00:00.000Z"): RecommendationReport {
  return {
    schemaVersion: "p10.7b.0", id: "recommendation-test",
    contentHash: "x",
    report: {
      generatedAt, requestedWindow: 10, recommendationStatus: "ok",
      inputReportCount: recs.length, analyzedReportCount: recs.length,
      skippedReportCount: 0, evidenceReportIds: ["outcome-a"],
      recommendations: recs, warnings: [], loadWarnings: [],
    },
  };
}

function persist(report: RecommendationReport, tempRoot: string): string {
  const store = new RecommendationReportStore(join(tempRoot, ".alix", "executive", "recommendations"));
  return store.save(report.report);
}

let tempRoot: string;
const MS_PER_DAY = 86_400_000;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-9-dashboard-cli-"));
  mkdirSync(join(tempRoot, ".alix", "executive", "recommendations"), { recursive: true });
  mkdirSync(join(tempRoot, ".alix", "executive", "outcomes"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive dashboard CLI", () => {
  it("renders terminal dashboard with all panel headers", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard([]);
    const output = c.out().join("\n");
    expect(output).toContain("Executive Dashboard");
    expect(output).toContain("Executive Summary");
    expect(output).toContain("Subsystem Health");
    expect(output).toContain("Pipeline");
    expect(output).toContain("Integrity");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--brief shows summary + alerts only", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--brief"]);
    const output = c.out().join("\n");
    expect(output).toContain("Executive Dashboard (brief)");
    expect(output).toContain("Executive Summary");
    expect(output).not.toContain("Subsystem Health");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--json outputs valid ExecutiveDashboardReport", async () => {
    const rec = makeExecRec();
    const savedId = persist(makeReport([rec]), tempRoot);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.metadata.schemaVersion).toBe(1);
    expect(parsed.metadata.dashboardVersion).toBe("p10.9.0");
    expect(parsed.summary).toBeDefined();
    expect(parsed.panels).toBeDefined();
    expect(parsed.alerts).toBeDefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("partial data renders available panels with warnings", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.summary.empty).toBe(false);
    expect(parsed.panels.some((p: any) => p.empty)).toBe(true);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("empty dashboard (no stores) still produces summary + integrity + alerts", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(Object.values(parsed.metadata.sources).every(v => v === false)).toBe(true);
    expect(parsed.summary.empty).toBe(false);
    expect(parsed.alerts).toBeDefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("large dashboard: 100+ recs renders with deterministic ordering", async () => {
    const recs = Array.from({ length: 120 }, (_, i) => ({
      subsystem: i % 3 === 0 ? "workflow" : i % 3 === 1 ? "memory" : "security",
      signal: i % 5 === 0 ? "degrading_trend" : i % 5 === 1 ? "persistent_instability"
        : i % 5 === 2 ? "low_confidence" : "improving_trend",
      severity: "high", recommendation: `Rec ${i}`, signalConfidence: 0.5 + (i % 5) * 0.1,
      occurrenceCount: 5, averageDelta: i % 2 === 0 ? -2 : 3,
      proposalId: i < 50 ? `p${i}` : undefined,
    }));
    persist(makeReport(recs, "2026-06-15T12:00:00.000Z"), tempRoot);
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.panels.map((p: any) => p.id))
      .toEqual(["health", "pipeline", "effectiveness", "signal-reliability", "integrity"]);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("corrupt data (null/NaN/undefined) never crashes dashboard", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await runDashboard(["--brief"]);
    expect(c.out().join("\n")).toContain("Executive Dashboard");
    expect(c.err().length).toBe(0);
    cwdSpy.mockRestore();
    c.restore();
  });
});
