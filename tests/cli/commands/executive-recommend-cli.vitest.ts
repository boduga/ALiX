import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRecommendCommand } from "../../../src/cli/commands/executive-recommend-handler.js";
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

// P10.7b: monotonic counter ensures each helper call gets a unique ISO timestamp
// so OutcomeReportStore.list() sort order is deterministic (newest-first by
// generatedAt). Without this, calls within the same millisecond produce ties
// that fall back to filesystem insertion order, which can shuffle recent
// reports ahead of older ones and break window-filtering assertions.
let __reportCallCounter = 0;
function __nextIsoTimestamp(): string {
  __reportCallCounter += 1;
  // Use the current millisecond plus a whole-ms counter offset to guarantee
  // distinct ISO-8601 timestamps even within the same real millisecond.
  // (The previous microsecond offset was truncated by toISOString().)
  return new Date(Date.now() + __reportCallCounter).toISOString();
}

/** A completed report whose single objective degraded `workflow` by 4 points. */
function makeDegradedReport(planId: string): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: __nextIsoTimestamp(),
    planId,
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: ["workflow"],
    objectives: [{
      objectiveId: "o1",
      objectiveType: "stabilize",
      targetSubsystems: ["workflow"],
      subsystemDeltas: [{ subsystem: "workflow", baselineScore: 60, currentScore: 50, delta: -10 }],
      aggregateDelta: -10,
      outcome: "degraded",
    }],
    overallDelta: -10,
    warnings: [],
  };
}

function makeInsufficientReport(planId: string): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: __nextIsoTimestamp(),
    planId,
    planStatus: "completed",
    evaluationStatus: "insufficient_data",
    evaluatedSubsystems: ["workflow"],
    objectives: [],
    overallDelta: 0,
    warnings: [],
  };
}

/**
 * A completed report whose single objective left `workflow` unchanged (delta 0).
 * Three of these yield trendStatus "ok" with no subsystem signal firing
 * (occurrenceCount 3 > low-confidence threshold; delta 0 is between -1 and +1).
 */
function makeUnchangedReport(planId: string): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: __nextIsoTimestamp(),
    planId,
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: ["workflow"],
    objectives: [{
      objectiveId: "o1",
      objectiveType: "stabilize",
      targetSubsystems: ["workflow"],
      subsystemDeltas: [{ subsystem: "workflow", baselineScore: 60, currentScore: 60, delta: 0 }],
      aggregateDelta: 0,
      outcome: "unchanged",
    }],
    overallDelta: 0,
    warnings: [],
  };
}

let tempRoot: string;
let execDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-7a-cli-"));
  execDir = join(tempRoot, ".alix", "executive");
  mkdirSync(join(execDir, "outcomes"), { recursive: true });
  __reportCallCounter = 0;
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive recommend CLI", () => {
  it("renders a terminal table with at least one recommendation", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    // Two degraded reports → occurrenceCount 2 → low_confidence; add more to cross degrading.
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10"]);

    const out = c.out().join("\n");
    expect(out).toContain("workflow");
    expect(out).toContain("Recommendation");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("outputs valid JSON with --json", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendationStatus).toBe("ok");
    expect(Array.isArray(parsed.subsystemRecommendations)).toBe(true);
    expect(parsed.subsystemRecommendations.length).toBeGreaterThan(0);
    expect(parsed.subsystemRecommendations[0]).toHaveProperty("signal");
    expect(parsed.subsystemRecommendations[0]).toHaveProperty("severity");
    expect(parsed.subsystemRecommendations[0]).toHaveProperty("signalConfidence");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("reports insufficient_data when all reports are insufficient", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    store.save(makeInsufficientReport("p1"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendationStatus).toBe("insufficient_data");
    expect(parsed.subsystemRecommendations).toEqual([]);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("prints the empty-result block when trends are ok but no signal fires", async () => {
    // Three unchanged-on-workflow reports → trendStatus "ok", no signal fires
    // (occurrenceCount 3 > low-confidence threshold; averageDelta 0 ∈ (-1, +1)).
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeUnchangedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10"]);

    const out = c.out().join("\n");
    expect(out).toContain("No recommendations generated.");
    expect(out).toContain("Recommendation status: ok");

    cwdSpy.mockRestore();
    c.restore();
  });

  it("silently excludes a corrupt report and still analyzes the valid one", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));
    // OutcomeReportStore.list() filters corrupt files; write one directly.
    writeFileSync(join(execDir, "outcomes", "outcome-corrupt.json"), "not valid json", "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.recommendationStatus).toBe("ok");
    expect(parsed.subsystemRecommendations.length).toBeGreaterThan(0);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("--window 1 limits analysis to a single report", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    store.save(makeDegradedReport("p1"));
    store.save(makeDegradedReport("p2"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "1", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.requestedWindow).toBe(1);

    cwdSpy.mockRestore();
    c.restore();
  });

  // --save tests (P10.7b)
  it("--save persists the report and prints the id to stderr", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--save"]);

    // id line went to stderr (console.warn capture channel).
    expect(c.err().join("\n")).toMatch(/Recommendation report saved: recommendation-/);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("--json --save emits the full persisted RecommendationReport as JSON", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10", "--save", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.schemaVersion).toBe("p10.7b.0");
    expect(parsed.id).toMatch(/^recommendation-/);
    expect(typeof parsed.contentHash).toBe("string");
    expect(parsed.report.evidenceReportIds.length).toBeGreaterThan(0);
    expect(parsed.report.recommendations.length).toBeGreaterThan(0);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("--save populates evidenceReportIds with the windowed outcome report ids", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    const idA = store.save(makeDegradedReport("pA"));
    const idB = store.save(makeDegradedReport("pB"));
    store.save(makeDegradedReport("pC"));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "2", "--save", "--json"]);

    const parsed = JSON.parse(c.out().join("\n"));
    // Newest-first: pC and pB are the first two; pA is excluded by the window.
    expect(parsed.report.evidenceReportIds).toContain(idB);
    expect(parsed.report.evidenceReportIds).not.toContain(idA);
    expect(parsed.report.evidenceReportIds).toHaveLength(2);

    cwdSpy.mockRestore();
    c.restore();
  });

  it("without --save, no report file is created (byte-identical to P10.7a)", async () => {
    const store = new OutcomeReportStore(join(execDir, "outcomes"));
    for (let i = 0; i < 3; i++) store.save(makeDegradedReport(`p${i}`));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleRecommendCommand(["--window", "10"]);

    // No recommendation report saved.
    const recsDir = join(execDir, "recommendations");
    const { existsSync } = await import("node:fs");
    expect(existsSync(recsDir)).toBe(false);
    expect(c.err().join("\n")).not.toMatch(/Recommendation report saved:/);

    cwdSpy.mockRestore();
    c.restore();
  });
});
