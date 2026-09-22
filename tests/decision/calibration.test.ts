import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CalibrationError,
  LabelReadError,
  LabelValidationError,
  LabelWriteError,
  buildCalibrationDataset,
  computeReliability,
  createOutcomeLabel,
  createOutcomeLabelStore,
  indexLabelsByDecisionId,
  type CalibrationSample,
  type DecisionJournalRecord,
  type DecisionOutcomeLabel,
} from "../../src/decision/index.js";

function record(
  overrides: Partial<DecisionJournalRecord> & { decisionId: string },
): DecisionJournalRecord {
  return {
    timestamp: 1,
    decision: "claim-verification",
    engineId: "local",
    projectionHash: "sha256:x",
    outcome: { kind: "choice", choice: "supported", candidates: ["supported"] },
    latencyMs: 5,
    remote: false,
    redactionApplied: false,
    ...overrides,
  };
}

function label(
  overrides: Partial<DecisionOutcomeLabel> & { decisionId: string },
): DecisionOutcomeLabel {
  return {
    decision: "claim-verification",
    label: "correct",
    observedAt: 10,
    ...overrides,
  };
}

function sample(overrides: Partial<CalibrationSample> & { correct: boolean }): CalibrationSample {
  return {
    decisionId: "d",
    decision: "claim-verification",
    engineId: "local",
    latencyMs: 1,
    remote: false,
    ...overrides,
  };
}

describe("outcome labels", () => {
  it("validates and defaults observedAt", () => {
    const built = createOutcomeLabel({ decisionId: "d1", decision: "claim-verification", label: "correct" });
    assert.equal(built.label, "correct");
    assert.ok(Number.isFinite(built.observedAt));
    assert.equal("risk" in built, false);
  });

  it("rejects malformed labels", () => {
    assert.throws(() => createOutcomeLabel({ decisionId: "", decision: "claim-verification", label: "correct" }), LabelValidationError);
    assert.throws(() => createOutcomeLabel({ decisionId: "d", decision: "claim-verification", label: "maybe" as never }), LabelValidationError);
    assert.throws(() => createOutcomeLabel({ decisionId: "d", decision: "claim-verification", label: "correct", risk: "extreme" as never }), LabelValidationError);
  });

  it("keeps the latest label per decision", () => {
    const index = indexLabelsByDecisionId([
      label({ decisionId: "d1", label: "incorrect", observedAt: 5 }),
      label({ decisionId: "d1", label: "correct", observedAt: 9 }),
      label({ decisionId: "d2", label: "unknown", observedAt: 1 }),
    ]);
    assert.equal(index.get("d1")?.label, "correct");
    assert.equal(index.get("d2")?.label, "unknown");
  });
});

describe("outcome label store", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "alix-calibration-"));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("empty store reads empty; append round-trips and filters", () => {
    const store = createOutcomeLabelStore(join(dir, "s1"));
    assert.deepEqual(store.readAll(), []);
    store.append(label({ decisionId: "d1" }));
    store.append(label({ decisionId: "d2", decision: "context-relevance" }));
    assert.equal(store.readAll().length, 2);
    assert.equal(store.findByDecision("claim-verification").length, 1);
  });

  it("validates before persisting", () => {
    const store = createOutcomeLabelStore(join(dir, "s2"));
    assert.throws(
      () => store.append({ decisionId: "d1", decision: "claim-verification", label: "nope" as never, observedAt: 1 }),
      LabelValidationError,
    );
    assert.equal(store.readAll().length, 0);
  });

  it("fails closed on a corrupt line and on I/O errors", () => {
    const corrupt = join(dir, "s3");
    const store = createOutcomeLabelStore(corrupt);
    store.append(label({ decisionId: "d1" }));
    writeFileSync(join(corrupt, "labels.jsonl"), "not-json{\n", "utf8");
    assert.throws(() => store.readAll(), LabelReadError);

    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a dir", "utf8");
    const broken = createOutcomeLabelStore(join(blocker, "inner"));
    assert.throws(() => broken.append(label({ decisionId: "d1" })), LabelWriteError);
  });
});

describe("calibration dataset", () => {
  const records: DecisionJournalRecord[] = [
    record({ decisionId: "d1" }),
    record({ decisionId: "d2", outcome: { kind: "choice", choice: "supported", candidates: ["supported"], confidence: 0.8 } }),
    record({ decisionId: "d3", outcome: { kind: "noul", probability: 0.7 } }),
    record({ decisionId: "d4", outcome: { kind: "failure", error: "down" } }),
    record({ decisionId: "d5" }),
    record({ decisionId: "d6", engineId: "jev" }),
  ];
  const labels: DecisionOutcomeLabel[] = [
    label({ decisionId: "d1", label: "correct" }),
    label({ decisionId: "d2", label: "incorrect", risk: "high" }),
    label({ decisionId: "d3", label: "correct" }),
    label({ decisionId: "d4", label: "correct" }),
    label({ decisionId: "d5", label: "unknown" }),
    // d6 intentionally unlabeled
  ];

  it("joins labelled records and counts everything it skips", () => {
    const { samples, skipped } = buildCalibrationDataset(records, labels);
    assert.equal(samples.length, 3);
    assert.deepEqual(skipped, { unlabeled: 1, unknownLabel: 1, failureOutcome: 1, duplicateDecisionId: 0 });

    const d2 = samples.find((s) => s.decisionId === "d2");
    assert.equal(d2?.confidence, 0.8);
    assert.equal(d2?.correct, false);
    assert.equal(d2?.risk, "high");

    const d3 = samples.find((s) => s.decisionId === "d3");
    assert.equal(d3?.probability, 0.7);
    assert.equal("confidence" in (d3 ?? {}), false);
  });

  it("filters by decision and engine", () => {
    assert.equal(buildCalibrationDataset(records, labels, { engineId: "jev" }).samples.length, 0);
    assert.equal(buildCalibrationDataset(records, labels, { decision: "model-tier" }).samples.length, 0);
  });

  it("counts duplicate journal rows for the same decision", () => {
    const { skipped } = buildCalibrationDataset([record({ decisionId: "d1" }), record({ decisionId: "d1" })], labels);
    assert.equal(skipped.duplicateDecisionId, 1);
  });
});

describe("reliability", () => {
  it("computes bins, ECE and Brier on a known set", () => {
    const samples: CalibrationSample[] = [
      ...Array.from({ length: 5 }, () => sample({ correct: true, confidence: 0.9 })),
      ...Array.from({ length: 5 }, () => sample({ correct: false, confidence: 0.1 })),
    ];
    const report = computeReliability(samples);
    assert.equal(report.metric, "confidence");
    assert.equal(report.sampleCount, 10);
    assert.equal(report.excludedUnscored, 0);
    assert.equal(report.bins.length, 10);
    // bin 9 = the five confident-and-correct samples; bin 1 = the five confident-and-wrong.
    assert.equal(report.bins[9].count, 5);
    assert.equal(report.bins[9].accuracy, 1);
    assert.equal(report.bins[1].count, 5);
    assert.equal(report.bins[1].accuracy, 0);
    assert.ok(Math.abs(report.expectedCalibrationError - 0.1) < 1e-9);
    assert.ok(Math.abs(report.brierScore - 0.01) < 1e-9);
  });

  it("surfaces overconfidence as ECE", () => {
    const samples = Array.from({ length: 10 }, (_, index) =>
      sample({ correct: index < 5, confidence: 0.9 }),
    );
    const report = computeReliability(samples);
    assert.equal(report.bins[9].count, 10);
    assert.equal(report.bins[9].accuracy, 0.5);
    assert.ok(Math.abs(report.expectedCalibrationError - 0.4) < 1e-9);
    assert.ok(Math.abs(report.brierScore - 0.41) < 1e-9);
  });

  it("reports zero error for perfectly calibrated confidence", () => {
    const samples = Array.from({ length: 8 }, () => sample({ correct: true, confidence: 1 }));
    const report = computeReliability(samples);
    assert.equal(report.expectedCalibrationError, 0);
    assert.equal(report.brierScore, 0);
  });

  it("uses probability for Noul samples", () => {
    const report = computeReliability([
      sample({ correct: true, probability: 0.6, decision: "context-relevance" }),
      sample({ correct: false, probability: 0.6, decision: "context-relevance" }),
    ]);
    assert.equal(report.metric, "probability");
    assert.equal(report.decision, "context-relevance");
  });

  it("counts samples with no native score instead of scoring them 0", () => {
    const report = computeReliability([
      sample({ correct: true, confidence: 0.5 }),
      sample({ correct: true }),
    ]);
    assert.equal(report.sampleCount, 1);
    assert.equal(report.excludedUnscored, 1);
  });

  it("refuses empty, mixed-metric, and cross-engine samples", () => {
    assert.throws(() => computeReliability([]), CalibrationError);
    assert.throws(
      () => computeReliability([sample({ correct: true, probability: 0.5 }), sample({ correct: true, confidence: 0.5 })]),
      /cannot mix probability/,
    );
    assert.throws(
      () =>
        computeReliability([
          sample({ correct: true, confidence: 0.5, engineId: "local" }),
          sample({ correct: true, confidence: 0.5, engineId: "jev" }),
        ]),
      /not transferable/,
    );
    assert.throws(
      () => computeReliability([sample({ correct: true, confidence: 0.5, decision: "model-tier" }), sample({ correct: false, confidence: 0.5 })]),
      /multiple decisions/,
    );
    assert.throws(() => computeReliability([sample({ correct: true })]), /no samples carry a native score/);
  });
});
