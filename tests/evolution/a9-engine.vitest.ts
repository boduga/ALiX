import { describe, it, expect, vi } from "vitest";
import type {
  ForecastAdapter,
  EnrichedProposalRecord,
  ProposalEventRecord,
} from "../../src/evolution/forecast/contracts/contract.js";
import { ForecastEngine, type ForecastEngineAdapters } from "../../src/evolution/forecast/forecast-engine.js";
import { buildForecast } from "../../src/evolution/forecast/forecast-builder.js";
import type { DetectorFinding } from "../../src/evolution/forecast/contracts/contract.js";
import { GENERATOR_VERSION, FORECAST_VERSION } from "../../src/evolution/forecast/contracts/contract.js";

const NOW = "2026-08-14T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Type-level guard helpers
// ---------------------------------------------------------------------------

type AssertNever<T> = [T] extends [never] ? true : false;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function submittedRecord(
  proposalId: string,
  capabilityId: string,
  candidateOverrides: Record<string, unknown> = {},
): ProposalEventRecord {
  return {
    proposalId,
    capabilityId,
    kind: "proposal.submitted",
    payload: {
      candidate: {
        candidateId: `c-${proposalId}`,
        sourcePatternId: "gap",
        confidence: 0.8,
        target: { kind: "capability", id: capabilityId },
        description: "d",
        expectedEffect: "e",
        riskClass: "high",
        evidenceIds: ["ev-1"],
        ...candidateOverrides,
      },
      signalIds: [],
      sourceVersion: null,
    },
    recordedAt: "2026-08-10T00:00:00.000Z",
    eventId: `evt-${proposalId}`,
  };
}

function enrichedRecord(overrides: Partial<EnrichedProposalRecord> = {}): EnrichedProposalRecord {
  return {
    proposalId: "prop-1",
    capabilityId: "cap-1",
    enrichedFields: ["proposal", "effectivenessReport", "outcome"],
    recordedAt: NOW,
    sourceConfidence: 0.8,
    evidenceFingerprints: ["fp-1", "fp-2", "fp-3"],
    assessment: {
      hasEffectivenessReport: false,
      hasRevertDecision: false,
      hasTimeToApproval: false,
      hasTimeToApply: false,
    },
    ...overrides,
  };
}

function fakeAdapter<T>(records: ReadonlyArray<T>): ForecastAdapter<T> {
  return { name: "fake", list: vi.fn(async () => records) };
}

function failedRecord(
  proposalId: string,
  error: string,
  overrides: Partial<ProposalEventRecord> = {},
): ProposalEventRecord {
  return {
    proposalId,
    capabilityId: "",
    kind: "proposal.execution_failed",
    payload: { error, partialState: "not_committed" },
    recordedAt: "2026-08-10T00:00:00.000Z",
    eventId: `evt-${proposalId}`,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ForecastEngine — no-trigger rule
// ---------------------------------------------------------------------------

describe("ForecastEngine — no-trigger rule", () => {
  it("returns [] when adapters expose no evidence", async () => {
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([]),
    });
    const forecasts = await engine.forecast(NOW);
    expect(forecasts).toEqual([]);
  });

  it("returns [] when every detector is below its trigger (no detection-worthy finding)", async () => {
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([
        submittedRecord("prop-1", "cap-1", { riskClass: "low" }), // trust below trigger
      ]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([
        enrichedRecord({
          assessment: {
            hasEffectivenessReport: true,
            hasRevertDecision: true,
            hasTimeToApproval: true,
            hasTimeToApply: true,
          },
        }), // completeness 0 → below trigger
      ]),
    });
    const forecasts = await engine.forecast(NOW);
    expect(forecasts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ForecastEngine — multi-detector aggregation
// ---------------------------------------------------------------------------

describe("ForecastEngine — aggregation by subject", () => {
  it("aggregates findings from multiple detectors for the same subject into one forecast", async () => {
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([submittedRecord("prop-1", "cap-1")]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([enrichedRecord()]),
    });

    const forecasts = await engine.forecast(NOW);
    expect(forecasts).toHaveLength(1);

    const forecast = forecasts[0]!;
    expect(forecast.subject).toBe("prop-1");
    expect(forecast.subjectCapability).toBe("cap-1");
    // Band + kind from the max-scoring finding (trust-velocity 0.7 > completeness 0.5).
    expect(forecast.prediction).toEqual({
      kind: "trust-velocity",
      band: "high",
      internalScore: 0.7,
    });
    // Weighted confidence = (0.7*0.8 + 0.5*1.0) / (0.7 + 0.5) = 1.06 / 1.2.
    expect(forecast.confidence).toBeCloseTo(1.06 / 1.2, 10);
    // Evidence references preserved across detectors (detector order: trust, completeness, fingerprint).
    expect(forecast.provenance.evidenceRefs).toEqual(["ev-1", "fp-1", "fp-2", "fp-3"]);
    expect(forecast.provenance.generatedAt).toBe(NOW);
    expect(forecast.provenance.generatorVersion).toBe(GENERATOR_VERSION);
    expect(forecast.forecastVersion).toBe(FORECAST_VERSION);
    expect(forecast.horizon.from).toBe(NOW);
    expect(forecast.forecastId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("emits one forecast per subject, sorted by subject", async () => {
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([
        submittedRecord("prop-z", "cap-Z"),
        submittedRecord("prop-a", "cap-A"),
      ]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([]),
    });
    const forecasts = await engine.forecast(NOW);
    expect(forecasts.map((f) => f.subject)).toEqual(["prop-a", "prop-z"]);
  });

  it("is deterministic — identical result for same evidence, timestamp, generator version", async () => {
    const adapters = {
      proposalEvents: fakeAdapter<ProposalEventRecord>([submittedRecord("prop-1", "cap-1")]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([enrichedRecord()]),
    };
    const first = await new ForecastEngine(adapters).forecast(NOW);
    const second = await new ForecastEngine(adapters).forecast(NOW);
    expect(first).toEqual(second);
    expect(first[0]!.forecastId).toBe(second[0]!.forecastId);
  });
});

// ---------------------------------------------------------------------------
// ForecastEngine — fingerprint-coincidence flow with colon-bearing errors
// ---------------------------------------------------------------------------

describe("ForecastEngine — fingerprint-coincidence with colon-bearing error fingerprints", () => {
  it("forecasts the exact subjectCapability (never a colon-truncated value)", async () => {
    // Regression: "TypeError: …" contains a colon. The capabilityId must flow
    // through the detector as a first-class value, so the forecast's
    // subjectCapability (and therefore the content-addressed forecastId) is exact.
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([
        submittedRecord("f1", "cap-1", { riskClass: "low" }),
        submittedRecord("f2", "cap-1", { riskClass: "low" }),
        failedRecord("f1", "TypeError: Cannot read properties of undefined", {
          recordedAt: "2026-08-10T00:00:00.000Z",
        }),
        failedRecord("f2", "TypeError: Cannot read properties of undefined", {
          recordedAt: "2026-08-11T00:00:00.000Z",
        }),
      ]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([]),
    });
    const forecasts = await engine.forecast(NOW);
    expect(forecasts).toHaveLength(1);
    const forecast = forecasts[0]!;
    expect(forecast.prediction.kind).toBe("fingerprint-coincidence");
    expect(forecast.subjectCapability).toBe("cap-1");
    expect(forecast.subject).toBe("f2");
    // Sanity: forecastId is a 64-hex content address of the exact content.
    expect(forecast.forecastId).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// ForecastEngine — no measurement consumption (Slice 4 concern)
// ---------------------------------------------------------------------------

describe("ForecastEngine — does NOT consume measurement events", () => {
  it("constructor accepts exactly the two forecast adapters (no measurement adapter)", () => {
    // Compile-time: ForecastEngineAdapters has exactly proposalEvents + enrichedProposals.
    type Extra = Exclude<keyof ForecastEngineAdapters, "proposalEvents" | "enrichedProposals">;
    const guard: AssertNever<Extra> = true;
    expect(guard).toBe(true);
  });

  it("calls only the proposal and enriched adapters, never a measurement adapter", async () => {
    const proposalSpy = vi.fn(async () => [submittedRecord("prop-1", "cap-1")] as ReadonlyArray<ProposalEventRecord>);
    const enrichedSpy = vi.fn(async () => [] as ReadonlyArray<EnrichedProposalRecord>);
    const engine = new ForecastEngine({
      proposalEvents: { name: "a9-proposal-events", list: proposalSpy },
      enrichedProposals: { name: "a9-enriched-proposals", list: enrichedSpy },
    });

    await engine.forecast(NOW);

    expect(proposalSpy).toHaveBeenCalledTimes(1);
    expect(enrichedSpy).toHaveBeenCalledTimes(1);
    // No measurement adapter exists on the engine to be called.
    expect((engine as unknown as Record<string, unknown>)["measurementEvents"]).toBeUndefined();
    expect((engine as unknown as Record<string, unknown>)["measurementAdapter"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 21 — aggregation: the max internal score determines the band and is
// never diluted (low + high → high; medium + critical → critical).
// ---------------------------------------------------------------------------

describe("ForecastEngine — aggregation rules (max score never diluted)", () => {
  const SUBJECT = "prop-1";
  function finding(score: number, kind: DetectorFinding["kind"] = "trust-velocity"): DetectorFinding {
    return {
      subject: SUBJECT,
      subjectCapability: "cap-1",
      kind,
      internalScore: score,
      confidence: 0.8,
      evidenceRefs: [`ev-${score}`],
    };
  }

  it("low + high → band high (max determines band)", () => {
    const forecast = buildForecast([finding(0.1), finding(0.7)], SUBJECT, "cap-1", NOW);
    expect(forecast.prediction.band).toBe("high");
    expect(forecast.prediction.internalScore).toBe(0.7);
    expect(forecast.prediction.kind).toBe("trust-velocity");
  });

  it("medium + critical → band critical (max determines band)", () => {
    const forecast = buildForecast(
      [finding(0.4, "evidence-completeness"), finding(0.9, "fingerprint-coincidence")],
      SUBJECT,
      "cap-1",
      NOW,
    );
    expect(forecast.prediction.band).toBe("critical");
    expect(forecast.prediction.internalScore).toBe(0.9);
    expect(forecast.prediction.kind).toBe("fingerprint-coincidence");
  });

  it("the maximum score is never diluted (not an average)", () => {
    const forecast = buildForecast(
      [finding(0.1), finding(0.2), finding(0.85)],
      SUBJECT,
      "cap-1",
      NOW,
    );
    expect(forecast.prediction.internalScore).toBe(0.85);
    // The weighted-confidence mean of (0.1,0.2,0.85) is far below 0.85 —
    // proving internalScore is the max, not an average.
    expect(forecast.confidence).toBeLessThan(0.85);
  });
});

// ---------------------------------------------------------------------------
// Phase 20 — detector failure isolation: a throwing detector is SURFACED
// (never silently success) while the other detectors continue.
// ---------------------------------------------------------------------------

describe("ForecastEngine — detector failure isolation (forecastDetailed)", () => {
  it("isolates a throwing detector, surfaces it, and still produces other forecasts", async () => {
    // A malformed enriched record (assessment undefined) makes the
    // evidence-completeness detector throw; trust-velocity still fires.
    const malformed = enrichedRecord({
      assessment: undefined as never,
    });
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([submittedRecord("prop-1", "cap-1")]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([malformed]),
    });

    const detail = await engine.forecastDetailed(NOW);
    // The trust-velocity detector still ran and produced a forecast.
    expect(detail.forecasts).toHaveLength(1);
    expect(detail.forecasts[0]!.subject).toBe("prop-1");
    // The failing detector is surfaced, not silently dropped.
    expect(detail.detectorFailures).toHaveLength(1);
    expect(detail.detectorFailures[0]!.detector).toBe("evidence-completeness");
    expect(detail.detectorFailures[0]!.error).toContain("hasEffectivenessReport");
  });

  it("forecast() stays LOUD — a detector failure never becomes silent success", async () => {
    const malformed = enrichedRecord({ assessment: undefined as never });
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([submittedRecord("prop-1", "cap-1")]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([malformed]),
    });
    await expect(engine.forecast(NOW)).rejects.toThrow(/detector failure/i);
  });

  it("a detector failure with no other findings yields no forecasts but a surfaced failure", async () => {
    const malformed = enrichedRecord({ assessment: undefined as never });
    const engine = new ForecastEngine({
      proposalEvents: fakeAdapter<ProposalEventRecord>([]),
      enrichedProposals: fakeAdapter<EnrichedProposalRecord>([malformed]),
    });
    const detail = await engine.forecastDetailed(NOW);
    expect(detail.forecasts).toEqual([]);
    expect(detail.detectorFailures).toHaveLength(1);
  });
});
