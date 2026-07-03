// tests/learning/confidence-model-store.vitest.ts
//
// P11.4 — ConfidenceModelStore tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, rmdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { ConfidenceModelStore, validateConfidenceModel } from "../../src/learning/confidence-model-store.js";
import type { UpdatedConfidenceModel } from "../../src/learning/learning-types.js";
import { LearningEngineError } from "../../src/learning/learning-types.js";

function makeModel(overrides?: Partial<UpdatedConfidenceModel>): UpdatedConfidenceModel {
  return {
    schemaVersion: "p11.4.0",
    modelId: "lrn-20260703T120000000Z",
    generatedAt: "2026-07-03T12:00:00.000Z",
    sourcePlanId: "strat-test-1",
    rootCauseAnalysisId: "reason-anl-1",
    correlationGraphId: "abc123",
    updates: [],
    meta: {
      primarySignal: "score_improvement",
      secondarySignal: "plan_completion",
      recurrenceLearningEnabled: false,
      objectivesEvaluated: 2,
      objectivesWithSignals: 0,
      objectivesSkipped: 0,
      objectivesWithoutSignal: 0,
      baselineTimestamp: "2026-07-03T12:00:00.000Z",
      evaluationTimestamp: "2026-07-05T12:00:00.000Z",
    },
    summary: {
      positiveUpdates: 0,
      negativeUpdates: 0,
      zeroAdjustmentUpdates: 0,
      averageAdjustment: 0,
    },
    mechanismAdjustments: [],
    ...overrides,
  };
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "p11-4-store-test-"));
}

function cleanDir(dir: string): void {
  try {
    const f = join(dir, "confidence-models.jsonl");
    if (existsSync(f)) unlinkSync(f);
    rmdirSync(dir);
  } catch { /* ok */ }
}

describe("ConfidenceModelStore", () => {
  let dir: string;
  let store: ConfidenceModelStore;

  beforeEach(() => {
    dir = makeDir();
    store = new ConfidenceModelStore(dir);
  });

  afterEach(() => {
    cleanDir(dir);
  });

  // T13: save + loadLatest round-trip
  it("round-trips a model through save and loadLatest", async () => {
    const model = makeModel({ modelId: "lrn-test-1" });
    await store.save(model);

    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.modelId).toBe("lrn-test-1");
    expect(loaded!.sourcePlanId).toBe("strat-test-1");
  });

  // T14: loadLatest returns last of two saves
  it("loadLatest returns the most recently saved model", async () => {
    const first = makeModel({ modelId: "lrn-first" });
    const second = makeModel({ modelId: "lrn-second" });

    await store.save(first);
    await store.save(second);

    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.modelId).toBe("lrn-second");
  });

  // T15: loadLatest from non-existent file returns null
  it("loadLatest returns null when no file exists", async () => {
    const loaded = await store.loadLatest();
    expect(loaded).toBeNull();
  });


  // T16: invalid schema version throws LearningEngineError
  it("throws LearningEngineError on invalid schema version", () => {
    expect(() => validateConfidenceModel({ schemaVersion: "p11.3.0" })).toThrow(LearningEngineError);
  });
});
