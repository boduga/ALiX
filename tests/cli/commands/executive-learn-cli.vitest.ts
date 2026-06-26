import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleLearnCommand } from "../../../src/cli/commands/executive-learn-handler.js";
import { OutcomeReportStore } from "../../../src/executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../../src/executive/outcome-evaluator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); } };
}

function makeReport(planId: string, evaluationStatus: string): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: new Date().toISOString(),
    planId,
    planStatus: "completed",
    evaluationStatus: evaluationStatus as any,
    evaluatedSubsystems: ["workflow"],
    objectives: evaluationStatus === "completed"
      ? [{
          objectiveId: "o1",
          objectiveType: "stabilize",
          targetSubsystems: ["workflow"],
          subsystemDeltas: [{ subsystem: "workflow", baselineScore: 40, currentScore: 55, delta: 15 }],
          aggregateDelta: 15,
          outcome: "improved",
        }]
      : [],
    overallDelta: evaluationStatus === "completed" ? 15 : 0,
    warnings: [],
  };
}

function saveReport(store: OutcomeReportStore, report: ExecutiveOutcomeEvaluationReport): void {
  store.save(report);
}

let tempRoot: string;
let execDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-6-cli-"));
  execDir = join(tempRoot, ".alix", "executive");
  mkdirSync(join(execDir, "outcomes"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive learn CLI", () => {
  it("renders terminal table with trends", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    saveReport(store, makeReport("p1", "completed"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10"]);

    expect(c.out().join("\n")).toContain("Subsystem");
    expect(c.out().join("\n")).toContain("workflow");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("outputs valid JSON with --json", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    saveReport(store, makeReport("p1", "completed"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.trendStatus).toBe("ok");
    expect(parsed.subsystemTrends.length).toBeGreaterThan(0);
    expect(parsed.objectiveTrends.length).toBeGreaterThan(0);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("includes skippedReportCount in JSON output", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    saveReport(store, makeReport("p1", "completed"));
    saveReport(store, makeReport("p2", "insufficient_data"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.inputReportCount).toBe(2);
    expect(parsed.analyzedReportCount).toBe(1);
    expect(parsed.skippedReportCount).toBe(1);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("handles empty store gracefully", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.trendStatus).toBe("insufficient_data");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("handles corrupt report gracefully — corrupt file silently excluded, valid report analyzed", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    const validReport = makeReport("p1", "completed");
    store.save(validReport);

    // Manually write a corrupt report file (invalid JSON) — store.list() will skip it
    const outcomesDir = join(execDir, "outcomes");
    writeFileSync(join(outcomesDir, "outcome-corrupt.json"), "not valid json", "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();

    await handleLearnCommand(["trends", "--window", "10", "--json"]);

    // Valid report should still be analyzed; corrupt one silently excluded
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.trendStatus).toBe("ok");
    expect(parsed.analyzedReportCount).toBe(1);

    cwdSpy.mockRestore();
    c.restore();
  });
});
