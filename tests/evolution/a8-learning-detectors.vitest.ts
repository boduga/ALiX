import { describe, it, expect } from "vitest";
import type { MeasurementOutcomeRecord, LearningEngineOptions, LearningFinding } from "../../src/evolution/learning/contracts/learning-contract.js";
import { detectUnderperformer, UNDERPERFORMER_DETECTOR_KIND } from "../../src/evolution/learning/detectors/underperformer-detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = "2026-08-14T00:00:00.000Z";
const OPTIONS: LearningEngineOptions = {
  minCardinality: 3,
  evidenceWindowDays: 30,
};

/** Build an outcome record with sensible defaults. */
function makeRecord(overrides: Partial<MeasurementOutcomeRecord> & { capabilityId: string }): MeasurementOutcomeRecord {
  return {
    capabilityId: overrides.capabilityId,
    outcome: overrides.outcome ?? "ineffective",
    recordedAt: overrides.recordedAt ?? "2026-08-10T00:00:00.000Z",
    eventId: overrides.eventId ?? `evt-${Math.random().toString(36).slice(2, 8)}`,
  };
}

// ---------------------------------------------------------------------------
// Detector kind constant
// ---------------------------------------------------------------------------

describe("UNDERPERFORMER_DETECTOR_KIND", () => {
  it('is "underperformer"', () => {
    expect(UNDERPERFORMER_DETECTOR_KIND).toBe("underperformer");
  });
});

// ---------------------------------------------------------------------------
// detectUnderperformer — per-axis behavior
// ---------------------------------------------------------------------------

describe("detectUnderperformer", () => {
  it("returns 0 findings for empty input", () => {
    const result = detectUnderperformer([], OPTIONS, NOW);
    expect(result).toEqual([]);
  });

  it("returns 0 findings when every capability is below minCardinality", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      // only 2 ineffective for cap-A — below minCardinality=3
      makeRecord({ capabilityId: "cap-B", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toEqual([]);
  });

  it("emits 1 finding when one capability meets minCardinality (at threshold)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toHaveLength(1);
    const f = result[0]!;
    expect(f.findingId).toBe("underperformer:cap-A");
    expect(f.kind).toBe("underperformer");
    expect(f.identityKey).toBe("cap-A");
    expect(f.occurrences).toBe(3);
  });

  it("emits 1 finding when one capability exceeds minCardinality (above threshold)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e4" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e5" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toBe(5);
  });

  it("emits N findings when N capabilities exceed minCardinality (each above threshold)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      // cap-A: 4 ineffective
      makeRecord({ capabilityId: "cap-A", eventId: "a1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a3" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a4" }),
      // cap-B: 3 ineffective
      makeRecord({ capabilityId: "cap-B", eventId: "b1" }),
      makeRecord({ capabilityId: "cap-B", eventId: "b2" }),
      makeRecord({ capabilityId: "cap-B", eventId: "b3" }),
      // cap-C: 2 ineffective — below threshold, must be excluded
      makeRecord({ capabilityId: "cap-C", eventId: "c1" }),
      makeRecord({ capabilityId: "cap-C", eventId: "c2" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.identityKey)).toEqual(["cap-A", "cap-B"]);
    expect(result.find((f) => f.identityKey === "cap-A")!.occurrences).toBe(4);
    expect(result.find((f) => f.identityKey === "cap-B")!.occurrences).toBe(3);
  });

  it("is deterministic — same input twice produces identical findings (sorted by identityKey)", () => {
    // Intentionally scramble input order to prove sorting/determinism
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-Z", eventId: "z1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a1" }),
      makeRecord({ capabilityId: "cap-M", eventId: "m1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a2" }),
      makeRecord({ capabilityId: "cap-Z", eventId: "z2" }),
      makeRecord({ capabilityId: "cap-M", eventId: "m2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "a3" }),
      makeRecord({ capabilityId: "cap-M", eventId: "m3" }),
      makeRecord({ capabilityId: "cap-Z", eventId: "z3" }),
    ];
    const first = detectUnderperformer(records, OPTIONS, NOW);
    const second = detectUnderperformer(records, OPTIONS, NOW);
    expect(first).toEqual(second);
    // And the order is sorted by identityKey (string-locale compare)
    expect(first.map((f) => f.identityKey)).toEqual(["cap-A", "cap-M", "cap-Z"]);
  });

  it("preserves evidenceRefs exactly in encounter order", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result[0]!.evidenceRefs).toEqual(["e1", "e2", "e3"]);
  });

  it("ignores effective and inconclusive outcomes (only counts ineffective)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", outcome: "effective", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "effective", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", outcome: "inconclusive", eventId: "i1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "inconclusive", eventId: "i2" }),
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "n1" }),
      makeRecord({ capabilityId: "cap-A", outcome: "ineffective", eventId: "n2" }),
      // 2 ineffective — below minCardinality=3 — must NOT emit
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result).toEqual([]);
  });

  it("excludes records recorded before the evidence window", () => {
    // Window for NOW=2026-08-14T00:00:00.000Z, days=30 → [2026-07-15T00:00:00.000Z, 2026-08-14T00:00:00.000Z]
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-01T00:00:00.000Z", eventId: "old1" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-10T00:00:00.000Z", eventId: "old2" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-14T23:59:59.999Z", eventId: "old3" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-15T00:00:00.000Z", eventId: "in1" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-07-20T00:00:00.000Z", eventId: "in2" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-08-10T00:00:00.000Z", eventId: "in3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    // 3 in window (in1, in2, in3) → exactly meets threshold → 1 finding
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrences).toBe(3);
    expect(result[0]!.evidenceRefs).toEqual(["in1", "in2", "in3"]);
  });

  it("excludes records recorded after `now` (future-dated)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-08-13T00:00:00.000Z", eventId: "ok1" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-08-14T00:00:00.000Z", eventId: "now" }),
      makeRecord({ capabilityId: "cap-A", recordedAt: "2026-09-01T00:00:00.000Z", eventId: "future" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    // ok1 + now = 2 within window → below threshold → 0 findings
    expect(result).toEqual([]);
  });

  it("computes evidenceWindow as [now - days, now]", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result[0]!.evidenceWindow.from).toBe("2026-07-15T00:00:00.000Z");
    expect(result[0]!.evidenceWindow.to).toBe(NOW);
  });

  it("summary string includes count and window days", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    expect(result[0]!.summary).toBe(
      "3 ineffective outcomes for capability cap-A within 30 days",
    );
  });

  it("honors minCardinality overrides (higher threshold excludes weaker evidence)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e4" }),
    ];
    const threshold4: LearningEngineOptions = { minCardinality: 5, evidenceWindowDays: 30 };
    const lowThreshold = detectUnderperformer(records, OPTIONS, NOW);
    const highThreshold = detectUnderperformer(records, threshold4, NOW);
    expect(lowThreshold).toHaveLength(1);
    expect(highThreshold).toHaveLength(0);
  });

  it("emits LearningFinding objects (read-only shape with all required fields)", () => {
    const records: ReadonlyArray<MeasurementOutcomeRecord> = [
      makeRecord({ capabilityId: "cap-A", eventId: "e1" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e2" }),
      makeRecord({ capabilityId: "cap-A", eventId: "e3" }),
    ];
    const result = detectUnderperformer(records, OPTIONS, NOW);
    const f: LearningFinding = result[0]!;
    expect(typeof f.findingId).toBe("string");
    expect(typeof f.kind).toBe("string");
    expect(typeof f.identityKey).toBe("string");
    expect(typeof f.evidenceWindow.from).toBe("string");
    expect(typeof f.evidenceWindow.to).toBe("string");
    expect(typeof f.occurrences).toBe("number");
    expect(Array.isArray(f.evidenceRefs)).toBe(true);
    expect(typeof f.summary).toBe("string");
  });
});