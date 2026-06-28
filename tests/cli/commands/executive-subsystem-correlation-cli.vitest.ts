/**
 * P10.8c — Predictive Signal Correlation CLI integration tests.
 *
 * 3 tests covering:
 *   1. Correlates recommendations with outcome reports, renders JSON
 *   2. No outcome reports → no_data status in JSON
 *   3. Terminal table output with --report flag
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { handleSubsystemCorrelationCommand } from "../../../src/cli/commands/executive-subsystem-correlation-handler.js";
import { RecommendationReportStore } from "../../../src/executive/recommendation-report-store.js";
import type { RecommendationReport, ExecutiveRecommendation, NewRecommendationReport } from "../../../src/executive/recommendation-report-store.js";
import type { ExecutiveOutcomeEvaluationReport, SubsystemDelta } from "../../../src/executive/outcome-evaluator.js";
import type { ExecutiveSubsystemName } from "../../../src/executive/executive-health.js";
import type { RecommendationDisposition } from "../../../src/executive/recommendation-effectiveness.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: any[]) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a: any[]) => { err.push(a.join(" ")); });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a: any[]) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); } };
}

function makeExecRec(over: Partial<ExecutiveRecommendation> = {}): ExecutiveRecommendation {
  return {
    subsystem: "workflow",
    signal: "degrading_trend",
    severity: "high",
    recommendation: "Investigate workflow regressions",
    signalConfidence: 0.88,
    occurrenceCount: 8,
    averageDelta: -3.2,
    ...over,
  };
}

function makeReport(recs: ExecutiveRecommendation[], generatedAt?: string): RecommendationReport {
  const ts = generatedAt ?? "2026-01-15T12:00:00.000Z";
  return {
    schemaVersion: "p10.7b.0",
    id: "recommendation-test",
    contentHash: "x",
    report: {
      generatedAt: ts,
      requestedWindow: 10,
      recommendationStatus: "ok",
      inputReportCount: recs.length,
      analyzedReportCount: recs.length,
      skippedReportCount: 0,
      evidenceReportIds: ["outcome-a"],
      recommendations: recs,
      warnings: [],
      loadWarnings: [],
    },
  };
}

function persist(report: RecommendationReport): RecommendationReport {
  const store = new RecommendationReportStore(join(tempRoot, ".alix", "executive", "recommendations"));
  const id = store.save(report.report);
  return store.load(id)!;
}

function makeOutcomeReport(generatedAt: string, subsystem: ExecutiveSubsystemName, delta: number): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt,
    planId: "plan-test",
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: [subsystem],
    objectives: [{
      objectiveId: "obj-test",
      objectiveType: "stabilize" as const,
      targetSubsystems: [subsystem],
      subsystemDeltas: [{ subsystem, baselineScore: 50, currentScore: 50 + delta, delta }],
      aggregateDelta: delta,
      outcome: delta > 0 ? "improved" : delta < 0 ? "degraded" : "unchanged",
    }],
    overallDelta: delta,
    warnings: [],
  };
}

function seedOutcomeReport(report: ExecutiveOutcomeEvaluationReport, id: string) {
  const dir = join(tempRoot, ".alix", "executive", "outcomes");
  mkdirSync(dir, { recursive: true });
  const contentHash = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const wrapper = { schemaVersion: "p10.5b.0", id, contentHash, report };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(wrapper, null, 2), "utf-8");
}

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-8c-correlation-cli-"));
  mkdirSync(join(tempRoot, ".alix", "executive", "recommendations"), { recursive: true });
  mkdirSync(join(tempRoot, ".alix", "executive", "outcomes"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive subsystem-correlation CLI", () => {
  it("recommendation + outcome → correlation json", async () => {
    const saved = persist(makeReport([makeExecRec()]));
    seedOutcomeReport(
      makeOutcomeReport("2026-01-20T12:00:00.000Z", "workflow", 5),
      "outcome-test-001",
    );
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleSubsystemCorrelationCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.correlationStatus).toBe("ok");
    expect(parsed.subsystemCorrelations[0].averageAbsoluteDelta).toBeDefined();
    expect(parsed.subsystemCorrelations[0].correlationEffectiveness).toBeDefined();
    expect(parsed.signalCorrelations[0].coverageRate).toBeDefined();
    expect(parsed.correlations[0].recommendationDisposition).toBeDefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("no outcome reports → no_data status", async () => {
    const saved = persist(makeReport([makeExecRec()]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleSubsystemCorrelationCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.correlationStatus).toBe("no_data");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("subsystem correlation table output", async () => {
    const saved = persist(makeReport([makeExecRec()]));
    seedOutcomeReport(
      makeOutcomeReport("2026-01-20T12:00:00.000Z", "workflow", 5),
      "outcome-test-001",
    );
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleSubsystemCorrelationCommand(["--report", saved.id]);
    const output = c.out().join("\n");
    expect(output).toContain("Predictive Signal Correlation");
    expect(output).toContain("Subsystem");
    expect(output).toContain("Signal");
    expect(c.err().length).toBe(0);
    cwdSpy.mockRestore();
    c.restore();
  });
});
