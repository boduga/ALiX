// tests/learning/governance-calibration-builder.vitest.ts
import { describe, it, expect } from "vitest";
import { GovernanceCalibrationBuilder } from "../../src/learning/governance-calibration-builder.js";
import type {
  LensCalibrationEntry,
  LensCalibrationReport,
} from "../../src/adaptation/outcome-types.js";

const SOURCE_REPORT = "lens-cal-1";
const GENERATED_AT = "2026-06-22T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<LensCalibrationEntry> = {}): LensCalibrationEntry {
  return {
    reviewsAnalyzed: 10,
    concernsRaised: 10,
    concernsValidated: 5,
    falseAlarms: 5,
    missedFailures: 1,
    predictiveValue: 0.5,
    calibration: "moderate",
    ...overrides,
  };
}

function makeReport(
  lenses: Record<string, LensCalibrationEntry>,
): LensCalibrationReport {
  return {
    id: "lr-1",
    subject: "Lens Calibration Report",
    outcome: "report_generated",
    confidence: 0.9,
    reasons: [],
    generatedAt: GENERATED_AT,
    windowDays: 30,
    lenses: lenses as LensCalibrationReport["lenses"],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GovernanceCalibrationBuilder", () => {
  const builder = new GovernanceCalibrationBuilder();

  // -----------------------------------------------------------------------
  // High predictive value
  // -----------------------------------------------------------------------

  it("emits high predictive value signal for strong lenses", () => {
    const report = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 50,
        concernsRaised: 50,
        concernsValidated: 41,
        falseAlarms: 9,
        missedFailures: 2,
        predictiveValue: 0.82,
        calibration: "strong",
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    const high = result.signals.find(
      (s) => s.signalType === "lens_high_predictive_value",
    );
    expect(high).toBeDefined();
    expect(high!.summary).toContain("historian");
    expect(high!.strength).toBeCloseTo(0.82, 2);

    // PV deviation is 0.32 — should produce a profile
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].target).toBe("governance_lens_weight");
    expect(result.profiles[0].suggestedValue).toBeGreaterThan(1.0);
  });

  // -----------------------------------------------------------------------
  // Low predictive value
  // -----------------------------------------------------------------------

  it("emits low predictive value signal for weak lenses (with extra samples)", () => {
    const report = makeReport({
      red_team: makeEntry({
        reviewsAnalyzed: 29, // >= minReviews * 2 = 10
        concernsRaised: 29,
        concernsValidated: 12,
        falseAlarms: 17,
        missedFailures: 3,
        predictiveValue: 0.41,
        calibration: "weak",
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    const low = result.signals.find(
      (s) => s.signalType === "lens_low_predictive_value",
    );
    expect(low).toBeDefined();
    expect(low!.summary).toContain("red_team");
    expect(low!.strength).toBeCloseTo(0.41, 2);
  });

  it("does NOT emit low predictive value with insufficient samples", () => {
    const report = makeReport({
      red_team: makeEntry({
        reviewsAnalyzed: 8, // above minReviews (5) but below minReviews*2 (10)
        predictiveValue: 0.41,
        calibration: "weak",
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    const low = result.signals.find(
      (s) => s.signalType === "lens_low_predictive_value",
    );
    expect(low).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Insufficient data — below minReviews
  // -----------------------------------------------------------------------

  it("emits zero signals when reviewsAnalyzed is below minSamples", () => {
    const report = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 3, // below minReviews of 5
        predictiveValue: 0.95,
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // High false positive rate
  // -----------------------------------------------------------------------

  it("emits false positive signal when lens overfires", () => {
    const report = makeReport({
      red_team: makeEntry({
        reviewsAnalyzed: 10,
        concernsRaised: 10,
        concernsValidated: 1,
        falseAlarms: 9,
        missedFailures: 0,
        predictiveValue: 0.1,
        calibration: "weak",
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    const fp = result.signals.find(
      (s) => s.signalType === "lens_high_false_positive",
    );
    // falseAlarms/concernsRaised = 9/10 = 0.9, above 0.4 threshold
    expect(fp).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // High miss rate
  // -----------------------------------------------------------------------

  it("emits miss rate signal when lens misses failures", () => {
    const report = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 10,
        concernsRaised: 5,
        concernsValidated: 5,
        falseAlarms: 0,
        missedFailures: 8, // 8/10 = 0.8 miss rate, above 0.3 threshold
        predictiveValue: 1.0,
        calibration: "strong",
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    const miss = result.signals.find(
      (s) => s.signalType === "lens_high_miss_rate",
    );
    expect(miss).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Mixed lenses
  // -----------------------------------------------------------------------

  it("handles multiple lenses with mixed calibration", () => {
    const report = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 50,
        concernsRaised: 50,
        concernsValidated: 41,
        falseAlarms: 9,
        missedFailures: 2,
        predictiveValue: 0.82,
        calibration: "strong",
      }),
      red_team: makeEntry({
        reviewsAnalyzed: 29,
        concernsRaised: 29,
        concernsValidated: 9,
        falseAlarms: 20,
        missedFailures: 3,
        predictiveValue: 0.30, // deviation 0.20 from 0.5 → triggers profile
        calibration: "weak",
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    const types = result.signals.map((s) => s.signalType);

    expect(types).toContain("lens_high_predictive_value");
    expect(types).toContain("lens_low_predictive_value");
    // 2 profiles: one increase, one decrease
    expect(result.profiles).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Empty report
  // -----------------------------------------------------------------------

  it("handles empty lens report gracefully", () => {
    const report = makeReport({});
    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // No profile for marginal deviations
  // -----------------------------------------------------------------------

  it("does not generate profile for marginal predictive value deviation", () => {
    // PV = 0.55, deviation from 0.5 is 0.05 — below 0.15 threshold.
    // Zero out FP/miss fields to isolate the PV-band check.
    const report = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 20,
        concernsRaised: 0,
        concernsValidated: 0,
        falseAlarms: 0,
        missedFailures: 0,
        predictiveValue: 0.55,
        calibration: "moderate",
      }),
    });

    const result = builder.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    // No high or low signal because PV is in the middle band
    expect(result.signals).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Custom thresholds
  // -----------------------------------------------------------------------

  it("respects custom thresholds", () => {
    const strict = new GovernanceCalibrationBuilder({
      minReviews: 20,
      highPvThreshold: 0.85,
      lowPvThreshold: 0.3,
    });

    const report = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 15, // below custom minReviews of 20
        predictiveValue: 0.95,
        calibration: "strong",
      }),
    });

    const result = strict.calibrate(report, SOURCE_REPORT, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Confidence scales with reviewsAnalyzed
  // -----------------------------------------------------------------------

  it("scales signal confidence with reviewsAnalyzed", () => {
    const small = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 8,
        predictiveValue: 0.9,
        calibration: "strong",
      }),
    });
    const large = makeReport({
      historian: makeEntry({
        reviewsAnalyzed: 120,
        predictiveValue: 0.9,
        calibration: "strong",
      }),
    });

    const smallResult = builder.calibrate(small, SOURCE_REPORT, GENERATED_AT);
    const largeResult = builder.calibrate(large, SOURCE_REPORT, GENERATED_AT);

    const smallSig = smallResult.signals.find(
      (s) => s.signalType === "lens_high_predictive_value",
    );
    const largeSig = largeResult.signals.find(
      (s) => s.signalType === "lens_high_predictive_value",
    );
    expect(smallSig!.confidence).toBeLessThan(largeSig!.confidence);
  });
});
