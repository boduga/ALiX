import { describe, it, expect } from "vitest";
import {
  internalScoreToBand,
  RISK_BAND_THRESHOLDS,
} from "../../src/evolution/a9/risk-band.js";

// ---------------------------------------------------------------------------
// Phase 3 — locked A6 thresholds
//   [0.0, 0.3)   low
//   [0.3, 0.6)   medium
//   [0.6, 0.85)  high
//   [0.85, 1.0]  critical
// ---------------------------------------------------------------------------

describe("internalScoreToBand — locked A6 thresholds, boundaries mandatory", () => {
  it("exposes the locked thresholds", () => {
    expect(RISK_BAND_THRESHOLDS.low.maxExclusive).toBe(0.3);
    expect(RISK_BAND_THRESHOLDS.medium.maxExclusive).toBe(0.6);
    expect(RISK_BAND_THRESHOLDS.high.maxExclusive).toBe(0.85);
    expect(RISK_BAND_THRESHOLDS.critical.maxInclusive).toBe(1.0);
  });

  it("0 → low (lower boundary inclusive)", () => {
    expect(internalScoreToBand(0)).toBe("low");
  });

  it("0.2999... (just below 0.3) → low", () => {
    expect(internalScoreToBand(0.2999999999999999)).toBe("low");
  });

  it("0.3 → medium (left boundary inclusive)", () => {
    expect(internalScoreToBand(0.3)).toBe("medium");
  });

  it("0.5999... (just below 0.6) → medium", () => {
    expect(internalScoreToBand(0.5999999999999999)).toBe("medium");
  });

  it("0.6 → high (left boundary inclusive)", () => {
    expect(internalScoreToBand(0.6)).toBe("high");
  });

  it("0.8499... (just below 0.85) → high", () => {
    expect(internalScoreToBand(0.8499999999999999)).toBe("high");
  });

  it("0.85 → critical (left boundary inclusive)", () => {
    expect(internalScoreToBand(0.85)).toBe("critical");
  });

  it("1.0 → critical (upper boundary inclusive)", () => {
    expect(internalScoreToBand(1.0)).toBe("critical");
  });

  it("interior values map to the correct band", () => {
    expect(internalScoreToBand(0.1)).toBe("low");
    expect(internalScoreToBand(0.45)).toBe("medium");
    expect(internalScoreToBand(0.72)).toBe("high");
    expect(internalScoreToBand(0.92)).toBe("critical");
  });

  it("is deterministic — repeated calls return the same band", () => {
    for (const score of [0, 0.3, 0.6, 0.85, 1.0, 0.2999999999999999, 0.5999999999999999, 0.8499999999999999]) {
      expect(internalScoreToBand(score)).toBe(internalScoreToBand(score));
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid input — handled deterministically (documented: throws RangeError)
// ---------------------------------------------------------------------------

describe("internalScoreToBand — invalid input handling (deterministic throw)", () => {
  const INVALID = [
    -0.01,
    1.01,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ] as const;

  it("throws RangeError for every out-of-range / non-finite score", () => {
    for (const score of INVALID) {
      expect(() => internalScoreToBand(score)).toThrow(RangeError);
    }
  });

  it("throws for non-number inputs (deterministic rejection)", () => {
    // @ts-expect-error — deliberately passing a non-number to test rejection.
    expect(() => internalScoreToBand("0.5")).toThrow(RangeError);
    // @ts-expect-error — deliberately passing undefined.
    expect(() => internalScoreToBand(undefined)).toThrow(RangeError);
  });

  it("does not silently fail-closed on invalid input (no silent 'critical')", () => {
    expect(() => internalScoreToBand(-0.01)).toThrow(RangeError);
    expect(() => internalScoreToBand(2)).toThrow(RangeError);
  });
});
