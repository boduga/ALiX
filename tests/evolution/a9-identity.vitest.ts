import { describe, it, expect } from "vitest";
import type { A9ForecastContent, A9CorrelationContent } from "../../src/evolution/a9/contracts/a9-contract.js";
import {
  canonicalizeForecast,
  forecastIdFor,
  canonicalizeCorrelation,
  correlationIdFor,
} from "../../src/evolution/a9/identity.js";
import { buildForecast } from "../../src/evolution/a9/forecast-builder.js";
import type { DetectorFinding } from "../../src/evolution/a9/contracts/a9-contract.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TIMESTAMP = "2026-08-14T00:00:00.000Z";

function makeContent(overrides: Partial<A9ForecastContent> = {}): A9ForecastContent {
  return {
    forecastVersion: "1.0.0",
    subject: "prop-1",
    subjectCapability: "cap-1",
    prediction: { kind: "trust-velocity", band: "high", internalScore: 0.7 },
    horizon: { from: TIMESTAMP, to: "2026-09-13T00:00:00.000Z" },
    confidence: 0.8,
    provenance: {
      generatedAt: TIMESTAMP,
      generatorVersion: "1.0.0",
      evidenceRefs: ["ev-1", "ev-2"],
    },
    ...overrides,
  };
}

function makeFinding(overrides: Partial<DetectorFinding> = {}): DetectorFinding {
  return {
    subject: "prop-1",
    subjectCapability: "cap-1",
    kind: "trust-velocity",
    internalScore: 0.7,
    confidence: 0.8,
    evidenceRefs: ["ev-1", "ev-2"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// canonicalizeForecast / forecastIdFor
// ---------------------------------------------------------------------------

describe("forecastIdFor — canonical forecast identity", () => {
  it("same content → same ID", () => {
    expect(forecastIdFor(makeContent())).toBe(forecastIdFor(makeContent()));
  });

  it("changed substantive content → different ID", () => {
    const base = makeContent();
    const changedCapability = makeContent({ subjectCapability: "cap-2" });
    const changedScore = makeContent({ prediction: { ...base.prediction, internalScore: 0.8 } });
    const changedConfidence = makeContent({ confidence: 0.6 });
    expect(forecastIdFor(base)).not.toBe(forecastIdFor(changedCapability));
    expect(forecastIdFor(base)).not.toBe(forecastIdFor(changedScore));
    expect(forecastIdFor(base)).not.toBe(forecastIdFor(changedConfidence));
  });

  it("property insertion order does not change the ID (canonical key sorting)", () => {
    const a = makeContent();
    // Rebuild the same content with keys inserted in a different order.
    const b: A9ForecastContent = {
      provenance: { ...a.provenance },
      confidence: a.confidence,
      horizon: { ...a.horizon },
      prediction: { ...a.prediction },
      subjectCapability: a.subjectCapability,
      subject: a.subject,
      forecastVersion: a.forecastVersion,
    };
    expect(canonicalizeForecast(a)).toBe(canonicalizeForecast(b));
    expect(forecastIdFor(a)).toBe(forecastIdFor(b));
  });

  it("repeated construction produces identical IDs", () => {
    const first = buildForecast([makeFinding()], "prop-1", "cap-1", TIMESTAMP);
    const second = buildForecast([makeFinding()], "prop-1", "cap-1", TIMESTAMP);
    expect(first.forecastId).toBe(second.forecastId);
  });

  it("forecastId is excluded from its own canonical content (content-addressed)", () => {
    const forecast = buildForecast([makeFinding()], "prop-1", "cap-1", TIMESTAMP);
    // Rebuild the content (all fields except forecastId) and re-hash — the id
    // must not be part of its own canonical form.
    const content: A9ForecastContent = {
      forecastVersion: forecast.forecastVersion,
      subject: forecast.subject,
      subjectCapability: forecast.subjectCapability,
      prediction: forecast.prediction,
      horizon: forecast.horizon,
      confidence: forecast.confidence,
      provenance: forecast.provenance,
    };
    expect(forecastIdFor(content)).toBe(forecast.forecastId);
  });

  it("generatedAt is identity-bearing (provenance content, documented decision)", () => {
    // generatedAt IS part of the artifact content (provenance), so it is
    // identity-bearing: the same forecast generated at a different time is a
    // distinct artifact with a distinct ID. This prevents ID collisions in the
    // later persistence slice (same evidence at different times = two runs).
    const atT0 = makeContent();
    const atT1 = makeContent({ provenance: { ...atT0.provenance, generatedAt: "2026-08-15T00:00:00.000Z" } });
    expect(forecastIdFor(atT0)).not.toBe(forecastIdFor(atT1));
  });

  it("storage order / JSONL sequence are not identity inputs (no such fields on content)", () => {
    // A9ForecastContent has no seq / position / storage fields by construction;
    // the type-level contract excludes them. Behaviorally, two content objects
    // that differ only in hypothetical storage metadata do not exist — but the
    // canonical form never mentions one, so identity is position-independent.
    const content = makeContent();
    expect(canonicalizeForecast(content)).not.toContain("seq");
    expect(canonicalizeForecast(content)).not.toContain("position");
  });

  it("produces a 64-char lowercase hex SHA-256 digest", () => {
    const id = forecastIdFor(makeContent());
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// canonicalizeCorrelation / correlationIdFor
// ---------------------------------------------------------------------------

describe("correlationIdFor — canonical correlation identity", () => {
  function makeCorrelation(overrides: Partial<A9CorrelationContent> = {}): A9CorrelationContent {
    return {
      correlationVersion: "1.0.0",
      forecastId: "f-1",
      measurementId: "m-1",
      foreignProvenance: { proposalId: "p-1", notes: "n-1" },
      resolution: { band: "high", forecastBand: "high", delta: "match" },
      ...overrides,
    };
  }

  it("same content → same ID", () => {
    expect(correlationIdFor(makeCorrelation())).toBe(correlationIdFor(makeCorrelation()));
  });

  it("changed content → different ID (not JSONL position)", () => {
    const base = makeCorrelation();
    const other = makeCorrelation({ measurementId: "m-2" });
    expect(correlationIdFor(base)).not.toBe(correlationIdFor(other));
  });

  it("correlationId is excluded from its own canonical content", () => {
    const content = makeCorrelation();
    // A9CorrelationContent structurally lacks correlationId; canonicalization
    // cannot include it.
    expect(canonicalizeCorrelation(content)).not.toContain("correlationId");
    expect(canonicalizeCorrelation(content)).not.toContain("seq");
    expect(correlationIdFor(content)).toMatch(/^[0-9a-f]{64}$/);
  });
});
