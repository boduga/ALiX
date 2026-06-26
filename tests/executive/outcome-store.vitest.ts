import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OutcomeReportStore } from "../../src/executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../src/executive/outcome-evaluator.js";

function makeReport(overrides: Partial<ExecutiveOutcomeEvaluationReport> = {}): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: "2026-06-25T12:00:00.000Z",
    planId: "plan-abc",
    planStatus: "completed",
    evaluationStatus: "completed",
    evaluatedSubsystems: ["workflow"],
    objectives: [],
    overallDelta: 40,
    warnings: [],
    ...overrides,
  };
}

describe("OutcomeReportStore", () => {
  let tmpDir: string;
  let store: OutcomeReportStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "outcome-test-"));
    store = new OutcomeReportStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saves a report and returns the reportId", () => {
    const report = makeReport();
    const id = store.save(report);
    expect(id).toMatch(/^outcome-plan-abc-\d+T\d+Z$/);
  });

  it("loads a saved report by reportId", () => {
    const report = makeReport();
    const id = store.save(report);
    const loaded = store.load(id);
    expect(loaded).not.toBeNull();
    expect(loaded!.planId).toBe("plan-abc");
    expect(loaded!.overallDelta).toBe(40);
  });

  it("returns null when loading a non-existent report", () => {
    const result = store.load("nonexistent");
    expect(result).toBeNull();
  });

  it("throws on hash mismatch (tampered file)", () => {
    const report = makeReport();
    const id = store.save(report);
    const path = join(tmpDir, `${id}.json`);
    const raw = readFileSync(path, "utf-8");
    const tampered = raw.replace(/plan-abc/g, "plan-TAMPERED");
    writeFileSync(path, tampered, "utf-8");
    expect(() => store.load(id)).toThrow(/contentHash|integrity|mismatch/i);
  });

  it("throws on invalid JSON (corrupt file)", () => {
    const report = makeReport();
    const id = store.save(report);
    const path = join(tmpDir, `${id}.json`);
    writeFileSync(path, "not-json{", "utf-8");
    expect(() => store.load(id)).toThrow();
  });

  it("lists saved reports sorted by generatedAt descending", () => {
    const r1 = makeReport({ generatedAt: "2026-06-25T10:00:00.000Z", planId: "plan-first" });
    const r2 = makeReport({ generatedAt: "2026-06-26T10:00:00.000Z", planId: "plan-second" });
    store.save(r1);
    store.save(r2);
    const list = store.list();
    expect(list.length).toBe(2);
    expect(list[0].planId).toBe("plan-second");
    expect(list[1].planId).toBe("plan-first");
  });

  it("list returns empty array when directory is missing", () => {
    const emptyStore = new OutcomeReportStore(join(tmpDir, "nonexistent"));
    const list = emptyStore.list();
    expect(list).toEqual([]);
  });

  it("list skips corrupt files and warns on stderr", () => {
    const report = makeReport();
    store.save(report);
    writeFileSync(join(tmpDir, "outcome-corrupt-20260625T120000000Z.json"), "bad{json", "utf-8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const list = store.list();
    expect(list.length).toBe(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("save creates directory if missing", () => {
    const deepDir = join(tmpDir, "a", "b", "c");
    const deepStore = new OutcomeReportStore(deepDir);
    const report = makeReport();
    const id = deepStore.save(report);
    const loaded = deepStore.load(id);
    expect(loaded!.planId).toBe("plan-abc");
  });
});
