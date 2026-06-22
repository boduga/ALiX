// tests/learning/recommendation-calibration-builder.vitest.ts
import { describe, it, expect } from "vitest";
import {
  RecommendationCalibrationBuilder,
  type ConfidenceBucketObservation,
} from "../../src/learning/recommendation-calibration-builder.js";

const SOURCE_REPORT_ID = "acc-1";
const GENERATED_AT = "2026-06-22T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBucket(
  overrides: Partial<ConfidenceBucketObservation> & { bucketMidpoint: number },
): ConfidenceBucketObservation {
  return {
    bucketLabel: `${overrides.bucketMidpoint - 0.05}-${overrides.bucketMidpoint + 0.05}`,
    totalCount: 100,
    successCount: Math.round(overrides.bucketMidpoint * 100), // perfect calibration
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RecommendationCalibrationBuilder", () => {
  const builder = new RecommendationCalibrationBuilder();

  // -----------------------------------------------------------------------
  // Perfect calibration
  // -----------------------------------------------------------------------

  it("produces zero signals when calibration is perfect", () => {
    const buckets: ConfidenceBucketObservation[] = [
      { bucketLabel: "0.8-1.0", bucketMidpoint: 0.9, totalCount: 100, successCount: 90 },
      { bucketLabel: "0.6-0.8", bucketMidpoint: 0.7, totalCount: 100, successCount: 70 },
      { bucketLabel: "0.4-0.6", bucketMidpoint: 0.5, totalCount: 100, successCount: 50 },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Overconfidence
  // -----------------------------------------------------------------------

  it("detects overconfidence when observed is significantly lower than expected", () => {
    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.8-1.0",
        bucketMidpoint: 0.9,
        totalCount: 100,
        successCount: 55, // expected 90, observed 55
      },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].signalType).toBe("overconfidence");
    expect(result.signals[0].strength).toBeCloseTo(0.35, 2);
    expect(result.signals[0].delta?.expected).toBe(0.9);
    expect(result.signals[0].delta?.observed).toBeCloseTo(0.55, 2);

    // Profile for significant delta (0.35 >= 0.1 * 2)
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].target).toBe("recommendation_confidence_multiplier");
    expect(result.profiles[0].previousValue).toBe(1.0);
    expect(result.profiles[0].suggestedValue).toBeLessThan(1.0);
  });

  // -----------------------------------------------------------------------
  // Underconfidence
  // -----------------------------------------------------------------------

  it("detects underconfidence when observed is significantly higher than expected", () => {
    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.4-0.6",
        bucketMidpoint: 0.5,
        totalCount: 100,
        successCount: 85, // expected 50, observed 85
      },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].signalType).toBe("underconfidence");
    expect(result.signals[0].delta?.expected).toBe(0.5);
    expect(result.signals[0].delta?.observed).toBeCloseTo(0.85, 2);
  });

  // -----------------------------------------------------------------------
  // Small sample size
  // -----------------------------------------------------------------------

  it("produces low confidence signals with small sample sizes", () => {
    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.8-1.0",
        bucketMidpoint: 0.9,
        totalCount: 6, // just above default minSamples of 5
        successCount: 2,
      },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].confidence).toBe(0.5); // low confidence
  });

  // -----------------------------------------------------------------------
  // Insufficient samples — below threshold
  // -----------------------------------------------------------------------

  it("produces zero signals when sample count is below minimum", () => {
    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.8-1.0",
        bucketMidpoint: 0.9,
        totalCount: 3, // below default minSamples of 5
        successCount: 1,
      },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Small delta — below threshold
  // -----------------------------------------------------------------------

  it("produces zero signals when delta is below threshold", () => {
    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.8-1.0",
        bucketMidpoint: 0.9,
        totalCount: 100,
        successCount: 88, // delta = -0.02, below threshold of 0.1
      },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Empty outcomes
  // -----------------------------------------------------------------------

  it("handles empty bucket list gracefully", () => {
    const result = builder.calibrate([], SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
    expect(result.profiles).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Multiple buckets — mixed signals
  // -----------------------------------------------------------------------

  it("handles multiple buckets with mixed calibration", () => {
    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.9-1.0",
        bucketMidpoint: 0.95,
        totalCount: 50,
        successCount: 50, // perfect
      },
      {
        bucketLabel: "0.8-0.9",
        bucketMidpoint: 0.85,
        totalCount: 100,
        successCount: 50, // overconfident: delta = -0.35
      },
      {
        bucketLabel: "0.5-0.6",
        bucketMidpoint: 0.55,
        totalCount: 20,
        successCount: 20, // underconfident: delta = +0.45
      },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(2);

    const over = result.signals.find((s) => s.signalType === "overconfidence");
    const under = result.signals.find((s) => s.signalType === "underconfidence");

    expect(over).toBeDefined();
    expect(under).toBeDefined();
    expect(over!.strength).toBeCloseTo(0.35, 2);
    expect(under!.strength).toBeCloseTo(0.45, 2);
  });

  // -----------------------------------------------------------------------
  // Custom thresholds
  // -----------------------------------------------------------------------

  it("respects custom minSamples and deltaThreshold", () => {
    const strict = new RecommendationCalibrationBuilder({
      minSamples: 50,
      deltaThreshold: 0.2,
    });

    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.8-1.0",
        bucketMidpoint: 0.9,
        totalCount: 40, // below custom minSamples of 50
        successCount: 20,
      },
      {
        bucketLabel: "0.6-0.8",
        bucketMidpoint: 0.7,
        totalCount: 100,
        successCount: 60, // delta = -0.1, below custom threshold of 0.2
      },
    ];

    const result = strict.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.signals).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Suggested value clamping
  // -----------------------------------------------------------------------

  it("clamps suggestedValue to [0.5, 1.5]", () => {
    const buckets: ConfidenceBucketObservation[] = [
      {
        bucketLabel: "0.8-1.0",
        bucketMidpoint: 0.9,
        totalCount: 200,
        successCount: 20, // extreme: 0.1 observed vs 0.9 expected
      },
    ];

    const result = builder.calibrate(buckets, SOURCE_REPORT_ID, GENERATED_AT);
    expect(result.profiles).toHaveLength(1);
    expect(result.profiles[0].suggestedValue).toBeGreaterThanOrEqual(0.5);
    // observed/expected = 0.1/0.9 ≈ 0.11 → clamped to 0.5
    expect(result.profiles[0].suggestedValue).toBe(0.5);
  });
});
