import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

/** Repo root resolved from test file location (before cwd mock). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
import { OutcomeStore } from "../../src/adaptation/outcome-store.js";
import type { OutcomeRecord } from "../../src/adaptation/outcome-types.js";
import { RecommendationCalibrationAdapter } from "../../src/learning/recommendation-calibration-adapter.js";

let cwdSpy: ReturnType<typeof vi.spyOn>;
let tempRoot: string;
let storeDir: string;
let store: OutcomeStore;

function makeRecord(overrides: Partial<OutcomeRecord> = {}): OutcomeRecord {
  return {
    id: "",
    subject: "Test outcome record",
    outcome: "success",
    confidence: 0.9,
    reasons: ["Test reason"],
    generatedAt: "2026-06-21T00:00:00.000Z",
    subjectId: "subject-1",
    subjectType: "test",
    actionTaken: "Applied test action",
    observationWindowDays: 7,
    ...overrides,
  };
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "rec-adapter-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempRoot);
  storeDir = join(tempRoot, ".alix", "outcomes");
  store = new OutcomeStore(storeDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("RecommendationCalibrationAdapter", () => {
  it("returns an empty AdapterResult for an empty store", async () => {
    const adapter = new RecommendationCalibrationAdapter(store);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });
    expect(result.signals).toEqual([]);
    expect(result.profiles).toEqual([]);
    expect(result.diagnostics.processed).toBe(0);
    expect(result.diagnostics.sourceRecordsRead).toBe(0);
    expect(result.diagnostics.adapter).toBe("recommendation");
  });

  it("excludes outcomes with missing confidence", async () => {
    // 2 with confidence, 3 without
    await store.append(makeRecord({ id: "out-1", confidence: 0.85, outcome: "success", subjectId: "s-1" }));
    await store.append(makeRecord({ id: "out-2", confidence: 0.85, outcome: "failure", subjectId: "s-2" }));
    await store.append(makeRecord({ id: "out-3", confidence: undefined, outcome: "success", subjectId: "s-3" }));
    await store.append(makeRecord({ id: "out-4", confidence: undefined, outcome: "failure", subjectId: "s-4" }));
    await store.append(makeRecord({ id: "out-5", confidence: undefined, outcome: "success", subjectId: "s-5" }));

    const adapter = new RecommendationCalibrationAdapter(store);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    expect(result.diagnostics.excludedReasons.missingConfidence).toBe(3);
    expect(result.diagnostics.processed).toBe(2);
    expect(result.diagnostics.sourceRecordsRead).toBe(5);
  });

  it("buckets outcomes by confidence range correctly", async () => {
    // 5 at 0.85 all success, 5 at 0.85 all failure → 0.8-1.0 bucket has totalCount: 10, successCount: 5
    for (let i = 0; i < 5; i++) {
      await store.append(makeRecord({
        id: `succ-${i}`,
        confidence: 0.85,
        outcome: "success",
        subjectId: `s-${i}`,
      }));
    }
    for (let i = 0; i < 5; i++) {
      await store.append(makeRecord({
        id: `fail-${i}`,
        confidence: 0.85,
        outcome: "failure",
        subjectId: `f-${i}`,
      }));
    }

    const adapter = new RecommendationCalibrationAdapter(store);
    // We need to inspect the intermediate buckets; calibrate() returns built signals.
    // To assert bucket counts, we build a small adapter that exposes the buckets.
    // Instead, we infer correctness from the signal: with observed rate ~0.5 in the 0.9
    // midpoint bucket, delta = 0.5 - 0.9 = -0.4 (overconfidence, |delta| >= 0.1).
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    // There should be at least one overconfidence signal for the 0.8-1.0 bucket.
    const overSignals = result.signals.filter((s) => s.signalType === "overconfidence");
    expect(overSignals.length).toBeGreaterThanOrEqual(1);
    // And the diagnostics reflect 10 processed.
    expect(result.diagnostics.processed).toBe(10);
  });

  it("produces an overconfidence signal when observed success rate is below midpoint", async () => {
    // 10 at confidence 0.9, only 2 success → observed 0.2 vs midpoint 0.9, delta = -0.7
    for (let i = 0; i < 2; i++) {
      await store.append(makeRecord({
        id: `succ-${i}`,
        confidence: 0.9,
        outcome: "success",
        subjectId: `s-${i}`,
      }));
    }
    for (let i = 0; i < 8; i++) {
      await store.append(makeRecord({
        id: `fail-${i}`,
        confidence: 0.9,
        outcome: "failure",
        subjectId: `f-${i}`,
      }));
    }

    const adapter = new RecommendationCalibrationAdapter(store);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });

    const overSignals = result.signals.filter((s) => s.signalType === "overconfidence");
    expect(overSignals.length).toBe(1);
    expect(overSignals[0].signalType).toBe("overconfidence");
    // Delta should be approximately 0.2 - 0.9 = -0.7
    expect(overSignals[0].delta?.observed).toBeCloseTo(0.2, 5);
    expect(overSignals[0].delta?.expected).toBeCloseTo(0.9, 5);
  });

  it("reports fidelity: 'high' in diagnostics", async () => {
    await store.append(makeRecord({ id: "out-1", confidence: 0.5, outcome: "success", subjectId: "s-1" }));
    const adapter = new RecommendationCalibrationAdapter(store);
    const result = await adapter.calibrate({
      windowDays: 30,
      generatedAt: "2026-06-22T00:00:00.000Z",
    });
    expect(result.diagnostics.fidelity).toBe("high");
  });

  it("is pure: the adapter file does not import LearningStore", async () => {
    // Read the adapter source as text and assert no forbidden import.
    const { readFileSync: rfs } = await import("node:fs");
    const src = rfs(
      `${REPO_ROOT}/src/learning/recommendation-calibration-adapter.ts`,
      "utf-8",
    );
    const importLines = src.split("\n").filter((l) => l.trim().startsWith("import"));
    for (const line of importLines) {
      expect(line).not.toContain("LearningStore");
    }
  });
});
