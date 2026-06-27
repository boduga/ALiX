/**
 * P10.8 — Executive Effectiveness CLI integration tests.
 *
 * 7 tests covering:
 *   1. Happy path: classifies recs, renders signal calibration table
 *   2. Proposal status reflected in --json output
 *   3. --since filters reports by recency
 *   4. --threshold changes stale classification boundary
 *   5. proposal_missing when proposal file not found
 *   6. --report <missing-id>: clean error
 *   7. Corrupt report integrity failure surfaced distinctly
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleEffectivenessCommand } from "../../../src/cli/commands/executive-effectiveness-handler.js";
import { RecommendationReportStore } from "../../../src/executive/recommendation-report-store.js";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import type { RecommendationReport, ExecutiveRecommendation } from "../../../src/executive/recommendation-report-store.js";
import type { AdaptationProposal } from "../../../src/adaptation/adaptation-types.js";

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
  const ts = generatedAt ?? new Date().toISOString();
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

let tempRoot: string;
let execDir: string;
let adaptationDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-8-effectiveness-cli-"));
  execDir = join(tempRoot, ".alix", "executive");
  adaptationDir = join(tempRoot, ".alix", "adaptation");
  mkdirSync(join(execDir, "recommendations"), { recursive: true });
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive effectiveness CLI", () => {
  it("happy path: classifies recs and renders terminal table", async () => {
    const saved = persist(
      makeReport([
        makeExecRec(),
        makeExecRec({ subsystem: "alpha", signal: "improving_trend" }),
      ]),
    );
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id]);
    const output = c.out().join("\n");
    expect(output).toMatch(/Recommendation Effectiveness/i);
    expect(output).toMatch(/Total recommendations: 2/);
    expect(output).toMatch(/degrading_trend/);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("proposal status reflected in --json output", async () => {
    // Create a pending proposal
    const proposal: AdaptationProposal = {
      id: "effectiveness-prop-1",
      createdAt: new Date().toISOString(),
      status: "pending",
      action: "create_improvement_issue",
      target: { kind: "issue", title: "test" },
      payload: {},
      sourceRecommendationType: "trend",
      sourceConfidence: 0.8,
      evidenceFingerprints: [],
      reason: "test proposal",
    };
    mkdirSync(join(adaptationDir, "proposals"), { recursive: true });
    const proposalStore = new ProposalStore(join(adaptationDir, "proposals"));
    await proposalStore.save(proposal);

    const recWithProposal = makeExecRec({ proposalId: "effectiveness-prop-1" });
    const recWithoutProposal = makeExecRec({
      subsystem: "alpha",
      signal: "improving_trend",
    });
    const saved = persist(makeReport([recWithProposal, recWithoutProposal]));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));

    expect(parsed.effectivenessStatus).toBe("ok");
    expect(parsed.totalRecommendations).toBe(2);
    expect(parsed.recommendations[0].disposition).toBe("awaiting_review");
    expect(parsed.recommendations[1].disposition).toBe("unreviewed");

    // Verify calibration aggregates
    const cal = parsed.signalCalibration.find(
      (s: any) => s.signal === "degrading_trend",
    );
    expect(cal).toBeDefined();
    expect(cal.awaitingReview).toBe(1);
    expect(cal.bridgedCount).toBe(1);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--since filters reports by recency", async () => {
    const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
    persist(makeReport([makeExecRec({ subsystem: "old" })], oldDate));
    const newDate = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const newSaved = persist(makeReport([makeExecRec({ subsystem: "new" })], newDate));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--since", "5", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));

    expect(parsed.effectivenessStatus).toBe("ok");
    expect(parsed.reportCount).toBe(1);
    expect(parsed.totalRecommendations).toBe(1);
    expect(parsed.recommendations[0].subsystem).toBe("new");
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--threshold changes stale classification boundary", async () => {
    const oldDate = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const saved = persist(makeReport([makeExecRec()], oldDate));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);

    // Default threshold (7 days) → 10-day-old rec is > 7 → stale
    const c1 = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id, "--json"]);
    const r1 = JSON.parse(c1.out().join("\n"));
    expect(r1.recommendations[0].disposition).toBe("stale");
    c1.restore();

    // Custom threshold (14 days) → 10-day-old rec is < 14 → unreviewed
    const c2 = captureConsole();
    await handleEffectivenessCommand([
      "--report",
      saved.id,
      "--threshold",
      "14",
      "--json",
    ]);
    const r2 = JSON.parse(c2.out().join("\n"));
    expect(r2.recommendations[0].disposition).toBe("unreviewed");
    c2.restore();

    cwdSpy.mockRestore();
  });

  it("proposal_missing when proposal file not found", async () => {
    const rec = makeExecRec({ proposalId: "missing-proposal" });
    const saved = persist(makeReport([rec]));

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));

    expect(parsed.recommendations[0].disposition).toBe("proposal_missing");
    expect(parsed.loadWarnings.length).toBeGreaterThan(0);
    expect(parsed.loadWarnings[0]).toMatch(/missing-proposal/);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--report <missing-id>: clean error", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand([
      "--report",
      "recommendation-nonexistent",
      "--json",
    ]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/not found/i);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("corrupt report integrity failure surfaced distinctly", async () => {
    const saved = persist(makeReport([makeExecRec()]));
    const reportPath = join(execDir, "recommendations", `${saved.id}.json`);
    const raw = JSON.parse(readFileSync(reportPath, "utf-8")) as any;
    raw.contentHash = "tampered-hash";
    writeFileSync(reportPath, JSON.stringify(raw, null, 2), "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/integrity failure/i);
    expect(parsed.reason).not.toMatch(/not found/i);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("no reports in store → no_data status", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleEffectivenessCommand(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.effectivenessStatus).toBe("no_data");
    expect(parsed.signalCalibration).toEqual([]);
    cwdSpy.mockRestore();
    c.restore();
  });
});
