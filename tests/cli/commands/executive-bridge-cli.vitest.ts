/**
 * P10.7c — Executive Bridge CLI integration tests.
 *
 * 10 tests covering:
 *   1. Happy path: eligible recs → proposals + patched report
 *   2. Latest-report resolution (no --report)
 *   3. recIndex order preservation
 *   4. Idempotent re-run (no duplicate proposals)
 *   5. No-op short-circuit (zero eligible → no writes)
 *   6. Copy-on-write (non-bridged recs unchanged)
 *   7. Partial-failure (save throws → stop, no rewrite)
 *   8. No reports in store → clean error
 *   9. --report <missing> → clean error
 *  10. Corrupt report (integrity failure surfaced distinctly)
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleBridgeCommand } from "../../../src/cli/commands/executive-bridge-handler.js";
import { RecommendationReportStore } from "../../../src/executive/recommendation-report-store.js";
import { ProposalStore } from "../../../src/adaptation/proposal-store.js";
import type { RecommendationReport } from "../../../src/executive/recommendation-report-store.js";
import type { ExecutiveRecommendation } from "../../../src/executive/recommendation-report-store.js";

// ---------------------------------------------------------------------------
// Mock ProposalStore for partial-failure test
//
// vi.mock is hoisted above imports, so this is always active. The mock
// conditionally throws only when mockSaveShouldThrow is true AND the
// current save is the 2nd call (mockSaveCallCount === 2). Both control
// variables are reset in beforeEach, so other tests are unaffected.
// ---------------------------------------------------------------------------
let mockSaveCallCount = 0;
let mockSaveShouldThrow = false;

vi.mock("../../../src/adaptation/proposal-store.js", async () => {
  const actual = await vi.importActual<any>("../../../src/adaptation/proposal-store.js");
  return {
    ...actual,
    ProposalStore: class extends actual.ProposalStore {
      async save(p: any) {
        mockSaveCallCount++;
        if (mockSaveShouldThrow && mockSaveCallCount === 2) throw new Error("disk full");
        return super.save(p);
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsole() {
  const out: string[] = [];
  const err: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a) => { out.push(a.join(" ")); });
  const warnSpy = vi.spyOn(console, "warn").mockImplementation((...a) => { err.push(a.join(" ")); });
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...a) => { err.push(a.join(" ")); });
  return { out: () => out, err: () => err, restore: () => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); } };
}

let __tsCounter = 0;
function nextTs(): string {
  __tsCounter += 1;
  return new Date(Date.now() + __tsCounter).toISOString();
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

function makeReport(recs: ExecutiveRecommendation[]): RecommendationReport {
  return {
    schemaVersion: "p10.7b.0",
    id: "recommendation-test",
    contentHash: "x",
    report: {
      generatedAt: nextTs(),
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
  const store = new RecommendationReportStore(
    join(tempRoot, ".alix", "executive", "recommendations"),
  );
  const id = store.save(report.report);
  return store.load(id)!;
}

let tempRoot: string;
let execDir: string;
let adaptationDir: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "p10-7c-cli-"));
  execDir = join(tempRoot, ".alix", "executive");
  adaptationDir = join(tempRoot, ".alix", "adaptation");
  mkdirSync(join(execDir, "recommendations"), { recursive: true });
  mkdirSync(join(adaptationDir, "proposals"), { recursive: true });
  mockSaveCallCount = 0;
  mockSaveShouldThrow = false;
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("executive bridge CLI", () => {
  it("bridges eligible recs: creates proposals + patches the report", async () => {
    const saved = persist(
      makeReport([makeExecRec(), makeExecRec({ signal: "improving_trend", subsystem: "beta" })]),
    );
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.createdProposalIds).toHaveLength(1);
    expect(parsed.skippedCount).toBe(1);
    // Verify the report was patched
    const reloaded = new RecommendationReportStore(
      join(execDir, "recommendations"),
    ).load(saved.id)!;
    expect(reloaded.report.recommendations[0].proposalId).toBe(
      parsed.createdProposalIds[0],
    );
    expect(reloaded.report.recommendations[0].governanceStatus).toBe("proposed");
    expect(reloaded.report.recommendations[1].proposalId).toBeUndefined(); // skipped rec unchanged
    cwdSpy.mockRestore();
    c.restore();
  });

  it("without --report, bridges the latest report", async () => {
    persist(makeReport([makeExecRec({ subsystem: "old" })]));
    // sleep 2 ms so the second report has a strictly newer generatedAt
    await new Promise((r) => setTimeout(r, 2));
    const newer = persist(makeReport([makeExecRec({ subsystem: "new" })]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.reportId).toBe(newer.id);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("emits createdProposalIds in source-report recIndex order", async () => {
    const saved = persist(
      makeReport([
        makeExecRec({ subsystem: "alpha", signal: "degrading_trend" }),
        makeExecRec({ subsystem: "beta", signal: "persistent_instability" }),
        makeExecRec({ subsystem: "gamma", signal: "improving_trend" }), // skipped
        makeExecRec({ subsystem: "delta", signal: "degrading_trend" }),
      ]),
    );
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.createdProposalIds).toHaveLength(3);
    // alpha (rec 0), beta (rec 1), delta (rec 3) — order matches source
    const reloaded = new RecommendationReportStore(
      join(execDir, "recommendations"),
    ).load(saved.id)!;
    expect(reloaded.report.recommendations[0].proposalId).toBe(
      parsed.createdProposalIds[0],
    );
    expect(reloaded.report.recommendations[1].proposalId).toBe(
      parsed.createdProposalIds[1],
    );
    expect(reloaded.report.recommendations[2].proposalId).toBeUndefined();
    expect(reloaded.report.recommendations[3].proposalId).toBe(
      parsed.createdProposalIds[2],
    );
    cwdSpy.mockRestore();
    c.restore();
  });

  it("idempotent re-run: second call creates 0 new proposals", async () => {
    const saved = persist(makeReport([makeExecRec()]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const first = JSON.parse(c.out().join("\n"));
    expect(first.createdProposalIds).toHaveLength(1);
    c.out().length = 0;
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const second = JSON.parse(c.out().join("\n"));
    expect(second.createdProposalIds).toHaveLength(0);
    expect(second.skippedCount).toBe(1);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("no-op short-circuit: zero eligible → no proposal saves, no report rewrite", async () => {
    const saved = persist(makeReport([makeExecRec({ signal: "improving_trend" })]));
    const reportPath = join(execDir, "recommendations", `${saved.id}.json`);
    const mtimeBefore = statSync(reportPath).mtimeMs;
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(true);
    expect(parsed.createdProposalIds).toHaveLength(0);
    expect(parsed.skippedCount).toBe(1);
    // Verify the report file mtime did NOT change (no rewrite)
    const mtimeAfter = statSync(reportPath).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("copy-on-write: non-bridged recs are unchanged bit-for-bit", async () => {
    const originalRec: ExecutiveRecommendation = makeExecRec({
      signal: "improving_trend",
      subsystem: "stable",
      signalConfidence: 0.5,
      occurrenceCount: 3,
      averageDelta: 0.1,
      recommendation: "Continue current stable optimizations",
    });
    const saved = persist(makeReport([makeExecRec(), originalRec]));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const reloaded = new RecommendationReportStore(
      join(execDir, "recommendations"),
    ).load(saved.id)!;
    const reloadedStable = reloaded.report.recommendations[1];
    expect(reloadedStable.signal).toBe("improving_trend");
    expect(reloadedStable.signalConfidence).toBe(0.5);
    expect(reloadedStable.recommendation).toBe(
      "Continue current stable optimizations",
    );
    expect(reloadedStable.proposalId).toBeUndefined();
    expect(reloadedStable.governanceStatus).toBeUndefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("partial-failure: save() throws → stop, no report rewrite, error surfaced", async () => {
    const saved = persist(
      makeReport([
        makeExecRec({ subsystem: "first" }),
        makeExecRec({ subsystem: "second" }),
      ]),
    );
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    mockSaveShouldThrow = true;
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.partial).toHaveLength(1); // first proposal saved before failure
    // Verify the report was NOT rewritten (proposalId still undefined for both recs)
    const reloaded = new RecommendationReportStore(
      join(execDir, "recommendations"),
    ).load(saved.id)!;
    expect(reloaded.report.recommendations[0].proposalId).toBeUndefined();
    expect(reloaded.report.recommendations[1].proposalId).toBeUndefined();
    cwdSpy.mockRestore();
    c.restore();
  });

  it("no reports in store: clean error, exit cleanly", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/no.*report/i);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--report <missing-id>: clean error", async () => {
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", "recommendation-does-not-exist", "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/not found/i);
    cwdSpy.mockRestore();
    c.restore();
  });

  it("--report <corrupt-id>: integrity failure surfaced distinctly", async () => {
    // Persist a valid report, then tamper with its contentHash on disk.
    const saved = persist(makeReport([makeExecRec()]));
    const reportPath = join(execDir, "recommendations", `${saved.id}.json`);
    const raw = JSON.parse(readFileSync(reportPath, "utf-8")) as any;
    raw.contentHash = "tampered-hash";
    writeFileSync(reportPath, JSON.stringify(raw, null, 2), "utf-8");

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
    const c = captureConsole();
    await handleBridgeCommand(["--report", saved.id, "--json"]);
    const parsed = JSON.parse(c.out().join("\n"));
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toMatch(/integrity failure/i);
    expect(parsed.reason).not.toMatch(/not found/i);
    cwdSpy.mockRestore();
    c.restore();
  });
});
