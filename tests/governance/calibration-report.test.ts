import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCalibrationReport, renderCalibrationReportText } from "../../src/governance/calibration-report.js";
import type { PolicyDriftSignal } from "../../src/governance/policy-drift-types.js";
import type { CalibrationConfidenceBand } from "../../src/governance/calibration-confidence-bands.js";

const ISO = "2026-07-08T18:00:00.000Z";

function signal(overrides: Partial<PolicyDriftSignal> = {}): PolicyDriftSignal {
  return {
    signalId: "p24-cs:abc123",
    kind: "calibration_skew",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    direction: "too_loose",
    severity: "medium",
    confidence: 0.7,
    sampleSize: { p22CalibrationCount: 20, p23ReplayCount: 15, pairedLifecycleCount: 10 },
    rates: { overconfidentRate: 0.65 },
    implicatedPolicyAreas: [],
    evidenceRefs: [],
    rationale: ["Overconfidence rate 0.65 across 20 calibrations."],
    ...overrides,
  };
}

function band(overrides: Partial<CalibrationConfidenceBand> = {}): CalibrationConfidenceBand {
  return {
    label: "moderate_confidence_drift",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    confidence: 0.7,
    signalCount: 1,
    rationale: ["1 analyzable signal with average confidence 70%."],
    ...overrides,
  };
}

describe("buildCalibrationReport", () => {

  it("empty signals produce empty report", () => {
    const report = buildCalibrationReport([], []);
    assert.equal(report.signals.length, 0);
    assert.equal(report.bands.length, 0);
    assert.ok(report.readOnly);
    assert.ok(report.noPolicyMutation);
  });

  it("includes boundary flags on report", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    assert.equal(report.readOnly, true);
    assert.equal(report.noPolicyMutation, true);
    assert.equal(report.noThresholdChange, true);
    assert.equal(report.noAutoAdoption, true);
    assert.equal(report.noRanking, true);
  });

  it("includes signals and bands", () => {
    const s = signal();
    const b = band();
    const report = buildCalibrationReport([s], [b]);
    assert.equal(report.signals.length, 1);
    assert.equal(report.bands.length, 1);
    assert.equal(report.signals[0]!.signalId, s.signalId);
    assert.equal(report.bands[0]!.label, b.label);
  });

  it("includes window metadata", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    assert.ok(report.generatedAt);
  });
});

describe("renderCalibrationReportText", () => {

  it("produces text output with expected structure", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    const text = renderCalibrationReportText(report);
    assert.ok(text.includes("P24-CALIBRATION-START"));
    assert.ok(text.includes("P24-CALIBRATION-END"));
    assert.ok(text.includes("calibration_skew"));
    assert.ok(text.includes("moderate_confidence_drift"));
    assert.ok(text.includes("readOnly"));
  });

  it("empty report renders cleanly", () => {
    const report = buildCalibrationReport([], []);
    const text = renderCalibrationReportText(report);
    assert.ok(text.includes("No calibration signals"));
  });

  it("JSON output produces parseable JSON", () => {
    const report = buildCalibrationReport([signal()], [band()]);
    const json = JSON.stringify(report, null, 2);
    const parsed = JSON.parse(json);
    assert.equal(parsed.signals.length, 1);
    assert.equal(parsed.bands.length, 1);
  });
});
