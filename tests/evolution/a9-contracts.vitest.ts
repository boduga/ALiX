import { describe, it, expect } from "vitest";
import type {
  A9Forecast,
  A9Correlation,
  CapabilityMeasurementRecord,
} from "../../src/evolution/a9/contracts/a9-contract.js";
import {
  A9_FORECAST_VERSION,
  A9_CORRELATION_VERSION,
  A9_GENERATOR_VERSION,
  A9_FORECAST_HORIZON_DAYS,
} from "../../src/evolution/a9/contracts/a9-contract.js";

// ---------------------------------------------------------------------------
// Type-level guard helpers
// ---------------------------------------------------------------------------

/** `true` only when T is the `never` type. Used to pin "this key must not
 *  exist" at compile time. */
type AssertNever<T> = [T] extends [never] ? true : false;

// ---------------------------------------------------------------------------
// Phase 1 — A9Forecast contract shape
// ---------------------------------------------------------------------------

describe("A9Forecast contract", () => {
  it("exposes the exact locked fields (no primary / correlationStatus / correlation semantics)", () => {
    // Runtime structural guard on a canonical instance.
    const forecast: A9Forecast = {
      forecastId: "a9-" + "0".repeat(63),
      forecastVersion: A9_FORECAST_VERSION,
      subject: "prop-1",
      subjectCapability: "cap-1",
      prediction: { kind: "trust-velocity", band: "high", internalScore: 0.7 },
      horizon: { from: "2026-08-14T00:00:00.000Z", to: "2026-09-13T00:00:00.000Z" },
      confidence: 0.8,
      provenance: {
        generatedAt: "2026-08-14T00:00:00.000Z",
        generatorVersion: A9_GENERATOR_VERSION,
        evidenceRefs: ["ev-1"],
      },
    };
    expect(Object.keys(forecast).sort()).toEqual([
      "confidence",
      "forecastId",
      "forecastVersion",
      "horizon",
      "prediction",
      "provenance",
      "subject",
      "subjectCapability",
    ]);
    // Contract rule: no primary / correlationStatus / correlation semantics in the forecast layer.
    const forbidden = ["primary", "correlationStatus", "correlationId", "measurementId"] as const;
    for (const key of forbidden) {
      expect((forecast as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
  });

  it("pins the 'do not add' rule at the type level (A9Forecast)", () => {
    // If a future change adds `primary` or `correlationStatus` to A9Forecast,
    // the intersection below stops being `never` and this assignment fails to
    // compile — a hard, static guard.
    type ForecastForbidden = "primary" | "correlationStatus";
    type ForecastLeak = Extract<keyof A9Forecast, ForecastForbidden>;
    const guard: AssertNever<ForecastLeak> = true;
    expect(guard).toBe(true);
  });

  it("pins the 'do not add' rule at the type level (A9Correlation)", () => {
    type CorrelationForbidden = "primary" | "correlationStatus";
    type CorrelationLeak = Extract<keyof A9Correlation, CorrelationForbidden>;
    const guard: AssertNever<CorrelationLeak> = true;
    expect(guard).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Q8 sentinel — CapabilityMeasurementRecord carries NO proposal linkage
// ---------------------------------------------------------------------------

describe("Q8 sentinel — CapabilityMeasurementRecord exposes no proposal linkage", () => {
  const FORBIDDEN_KEYS = ["proposalId", "sourceProposalIds", "forecastId", "correlationId"] as const;

  it("the record type has no proposalId / sourceProposalIds / forecastId / correlationId (compile-time)", () => {
    // Q8 locked ruling: measurement events deliberately carry NO proposal
    // linkage. The A9 measurement adapter's output record MUST NOT expose or
    // invent these fields. If a future change adds one, the intersection below
    // stops being `never` and this assignment fails to compile.
    type Q8Forbidden = "proposalId" | "sourceProposalIds" | "forecastId" | "correlationId";
    type Q8Leak = Extract<keyof CapabilityMeasurementRecord, Q8Forbidden>;
    const guard: AssertNever<Q8Leak> = true;
    expect(guard).toBe(true);
  });

  it("a canonical instance exposes none of the forbidden keys at runtime", () => {
    const record: CapabilityMeasurementRecord = {
      measurementId: "m-1",
      capabilityId: "cap-1",
      outcome: "effective",
      recordedAt: "2026-08-14T00:00:00.000Z",
      eventId: "1",
    };
    const keys = Object.keys(record);
    for (const key of FORBIDDEN_KEYS) {
      expect(keys).not.toContain(key);
      expect((record as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
    // The record still exposes the canonical measurement information.
    expect(record.measurementId).toBe("m-1");
    expect(record.capabilityId).toBe("cap-1");
    expect(record.outcome).toBe("effective");
  });
});

// ---------------------------------------------------------------------------
// Phase 1 — version constants
// ---------------------------------------------------------------------------

describe("A9 version constants", () => {
  it("exposes forecast/correlation/generator versions and horizon", () => {
    expect(A9_FORECAST_VERSION).toBe("1.0.0");
    expect(A9_CORRELATION_VERSION).toBe("1.0.0");
    expect(A9_GENERATOR_VERSION).toBe("1.0.0");
    expect(A9_FORECAST_HORIZON_DAYS).toBeGreaterThan(0);
  });
});
