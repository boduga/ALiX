import { describe, it, expect } from "vitest";
import {
  CAPABILITY_MEASUREMENT_OUTCOMES,
  isCapabilityMeasurementOutcome,
  isEffectiveOutcome,
  isIneffectiveOutcome,
  isInconclusiveOutcome,
} from "../../src/capability/measurement/outcome-discriminated-union.js";
import type { CapabilityMeasurementOutcome } from "../../src/capability/measurement/outcome-discriminated-union.js";

function mkOutcome(kind: "effective" | "ineffective" | "inconclusive"): CapabilityMeasurementOutcome {
  return {
    kind,
    evidenceRefs: ["obs-1"],
    confidence: 0.9,
    summary: "Test outcome",
    signals: [],
  };
}

describe("CapabilityMeasurementOutcome (CAP-10 ruling #15)", () => {
  it("has exactly three outcome kinds", () => {
    expect(CAPABILITY_MEASUREMENT_OUTCOMES).toEqual(["effective", "ineffective", "inconclusive"]);
  });

  it("isCapabilityMeasurementOutcome accepts each variant", () => {
    for (const kind of CAPABILITY_MEASUREMENT_OUTCOMES) {
      expect(isCapabilityMeasurementOutcome(mkOutcome(kind as "effective" | "ineffective" | "inconclusive"))).toBe(true);
    }
  });

  it("isCapabilityMeasurementOutcome rejects invalid shapes", () => {
    expect(isCapabilityMeasurementOutcome({ kind: "unknown" })).toBe(false);
    expect(isCapabilityMeasurementOutcome({ kind: "effective" })).toBe(false);
    expect(isCapabilityMeasurementOutcome(null)).toBe(false);
    expect(isCapabilityMeasurementOutcome(undefined)).toBe(false);
    expect(isCapabilityMeasurementOutcome(42)).toBe(false);
  });

  it("narrow helpers discriminate on kind", () => {
    expect(isEffectiveOutcome(mkOutcome("effective"))).toBe(true);
    expect(isEffectiveOutcome(mkOutcome("ineffective"))).toBe(false);
    expect(isIneffectiveOutcome(mkOutcome("ineffective"))).toBe(true);
    expect(isInconclusiveOutcome(mkOutcome("inconclusive"))).toBe(true);
  });

  it("each variant carries the same five common fields", () => {
    const variants: CapabilityMeasurementOutcome[] = [
      mkOutcome("effective"),
      mkOutcome("ineffective"),
      mkOutcome("inconclusive"),
    ];
    for (const v of variants) {
      expect(v.evidenceRefs).toBeDefined();
      expect(typeof v.confidence).toBe("number");
      expect(typeof v.summary).toBe("string");
      expect(Array.isArray(v.signals)).toBe(true);
    }
  });
});
