import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  A9Adapter,
  A9Correlation,
  A9CorrelationContent,
  A9Forecast,
  A9ForecastContent,
  CapabilityMeasurementRecord,
  ProposalEventRecord,
} from "../../src/evolution/a9/contracts/a9-contract.js";
import {
  A9_CORRELATION_VERSION,
  A9_FORECAST_VERSION,
  A9_GENERATOR_VERSION,
} from "../../src/evolution/a9/contracts/a9-contract.js";
import { canonicalizeCorrelation, correlationIdFor, forecastIdFor } from "../../src/evolution/a9/identity.js";
import { ForecastsStore } from "../../src/evolution/a9/forecasts-store.js";
import { ForecastsAdapter } from "../../src/evolution/a9/forecasts-adapter.js";
import { CorrelationEngine } from "../../src/evolution/a9/correlation-engine.js";
import {
  buildCorrelation,
  measurementOutcomeToBand,
} from "../../src/evolution/a9/correlation-builder.js";
import { CorrelationsStore } from "../../src/evolution/a9/correlations-store.js";
import { CorrelationsAdapter } from "../../src/evolution/a9/correlations-adapter.js";
// Phase 27 — post-execution integration fixture uses the REAL adapters over
// EventLog-shaped events (not adapter stubs).
import { ProposalEventsAdapter } from "../../src/evolution/a9/adapters/proposal-events-adapter.js";
import { MeasurementEventsAdapter } from "../../src/evolution/a9/adapters/measurement-events-adapter.js";
import type { EventLog } from "../../src/events/event-log.js";
import type { AlixEvent } from "../../src/events/types.js";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TS = "2026-08-15T00:00:00.000Z";

/** Content-addressed A9Forecast — same content always yields the same forecastId. */
function makeForecast(
  overrides: Partial<A9ForecastContent> = {},
): A9Forecast {
  const content: A9ForecastContent = {
    forecastVersion: A9_FORECAST_VERSION,
    subject: "prop-1",
    subjectCapability: "cap-1",
    prediction: { kind: "trust-velocity", band: "high", internalScore: 0.7 },
    horizon: {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-31T00:00:00.000Z",
    },
    confidence: 0.8,
    provenance: {
      generatedAt: "2026-08-01T00:00:00.000Z",
      generatorVersion: A9_GENERATOR_VERSION,
      evidenceRefs: ["ev-1"],
    },
    ...overrides,
  };
  return { forecastId: forecastIdFor(content), ...content };
}

/** Canonical measurement record — Q8: capability-targeted, NO proposal linkage. */
function makeMeasurement(
  overrides: Partial<CapabilityMeasurementRecord> = {},
): CapabilityMeasurementRecord {
  return {
    measurementId: "m-1",
    capabilityId: "cap-1",
    outcome: "effective",
    recordedAt: "2026-08-15T00:00:00.000Z",
    eventId: "10",
    ...overrides,
  };
}

/** Raw proposal.submitted payload carrying the bridge anchor candidate.target.id. */
function submittedPayload(targetId: string): Record<string, unknown> {
  return {
    candidate: { target: { kind: "capability", id: targetId } },
    signalIds: [],
    sourceVersion: null,
  };
}

/** RAW proposal event record (adapter output shape). */
function makeProposal(
  overrides: Partial<ProposalEventRecord> & { payload?: Record<string, unknown> } = {},
): ProposalEventRecord {
  const kind = overrides.kind ?? "proposal.submitted";
  const proposalId = overrides.proposalId ?? "prop-1";
  const payload =
    overrides.payload ??
    (kind === "proposal.submitted"
      ? { proposalId, ...submittedPayload("cap-1") }
      : { proposalId });
  return {
    proposalId,
    capabilityId:
      overrides.capabilityId ??
      (kind === "proposal.submitted" ? "cap-1" : ""),
    kind,
    payload,
    recordedAt: overrides.recordedAt ?? "2026-08-01T00:00:00.000Z",
    eventId: overrides.eventId ?? "1",
  };
}

function fakeProposalAdapter(
  records: ReadonlyArray<ProposalEventRecord>,
): A9Adapter<ProposalEventRecord> {
  return { name: "test-proposal-events", list: async () => records };
}

function fakeMeasurementAdapter(
  records: ReadonlyArray<CapabilityMeasurementRecord>,
): A9Adapter<CapabilityMeasurementRecord> {
  return { name: "test-measurement-events", list: async () => records };
}

// ---------------------------------------------------------------------------
// Harness — temp store dir per test (never touches real .alix/governance/)
// ---------------------------------------------------------------------------

describe("A9 correlation layer", () => {
  let dir: string;
  let store: ForecastsStore;
  let forecasts: ForecastsAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "a9-correlation-"));
    store = new ForecastsStore(dir);
    forecasts = new ForecastsAdapter(store);
  });

  afterEach(async () => {
    // Temp dirs are cleaned by the OS; nothing is written outside them.
  });

  function engine(proposals: ReadonlyArray<ProposalEventRecord>): CorrelationEngine {
    return new CorrelationEngine({
      forecasts,
      proposalEvents: fakeProposalAdapter(proposals),
      measurements: fakeMeasurementAdapter([]),
    });
  }

  // -------------------------------------------------------------------------
  // measurementOutcomeToBand — locked A9 v1 interpretation metadata
  // -------------------------------------------------------------------------

  describe("measurementOutcomeToBand — observed band from measurement outcome", () => {
    it("maps each outcome deterministically (effective→low, inconclusive→medium, ineffective→critical)", () => {
      expect(measurementOutcomeToBand("effective")).toBe("low");
      expect(measurementOutcomeToBand("inconclusive")).toBe("medium");
      expect(measurementOutcomeToBand("ineffective")).toBe("critical");
    });

    it("is exhaustive over the outcome union", () => {
      const outcomes: CapabilityMeasurementRecord["outcome"][] = [
        "effective",
        "ineffective",
        "inconclusive",
      ];
      for (const o of outcomes) {
        expect(["low", "medium", "high", "critical"]).toContain(
          measurementOutcomeToBand(o),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // buildCorrelation — pure positive-evidence construction + full-content identity
  // -------------------------------------------------------------------------

  describe("buildCorrelation — pure builder", () => {
    it("constructs one positive-evidence correlation with the locked shape", () => {
      const forecast = makeForecast();
      const measurement = makeMeasurement();
      const c = buildCorrelation(forecast, measurement, forecast.subject, TS);

      expect(c.correlationId).toMatch(/^[0-9a-f]{64}$/);
      expect(c.correlationVersion).toBe(A9_CORRELATION_VERSION);
      expect(c.forecastId).toBe(forecast.forecastId);
      expect(c.measurementId).toBe(measurement.measurementId);
      // foreignProvenance carries the bridge-authorized proposal id.
      expect(c.foreignProvenance.proposalId).toBe("prop-1");
      // resolution: forecastBand mirrors the forecast; band from the outcome.
      expect(c.resolution.forecastBand).toBe(forecast.prediction.band);
      expect(c.resolution.band).toBe("low"); // effective → low
    });

    it("delta — match when observed equals forecast band", () => {
      const forecast = makeForecast({
        prediction: { kind: "trust-velocity", band: "low", internalScore: 0.1 },
      });
      const c = buildCorrelation(forecast, makeMeasurement({ outcome: "effective" }), "prop-1", TS);
      expect(c.resolution.band).toBe("low");
      expect(c.resolution.forecastBand).toBe("low");
      expect(c.resolution.delta).toBe("match");
    });

    it("delta — under-forecast when observed risk EXCEEDS the forecast band", () => {
      const forecast = makeForecast(); // band high
      const c = buildCorrelation(
        forecast,
        makeMeasurement({ outcome: "ineffective" }), // band critical
        "prop-1",
        TS,
      );
      expect(c.resolution.band).toBe("critical");
      expect(c.resolution.forecastBand).toBe("high");
      expect(c.resolution.delta).toBe("under-forecast");
    });

    it("delta — over-forecast when observed risk is BELOW the forecast band", () => {
      const forecast = makeForecast(); // band high
      const c = buildCorrelation(
        forecast,
        makeMeasurement({ outcome: "effective" }), // band low
        "prop-1",
        TS,
      );
      expect(c.resolution.band).toBe("low");
      expect(c.resolution.forecastBand).toBe("high");
      expect(c.resolution.delta).toBe("over-forecast");
    });

    it("does not add primary / terminal / resolved / attempted / correlationStatus", () => {
      const c = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      const keys = Object.keys(c);
      for (const forbidden of [
        "primary",
        "terminal",
        "resolved",
        "attempted",
        "correlationStatus",
      ]) {
        expect(keys).not.toContain(forbidden);
      }
    });

    it("correlationId is content-addressed over the FULL content (not forecastId-only)", () => {
      const forecast = makeForecast();
      const measurement = makeMeasurement();
      const base = buildCorrelation(forecast, measurement, "prop-1", TS);

      // measurementId is identity-bearing.
      const otherM = buildCorrelation(
        forecast,
        makeMeasurement({ measurementId: "m-other" }),
        "prop-1",
        TS,
      );
      expect(otherM.correlationId).not.toBe(base.correlationId);

      // foreignProvenance.proposalId is identity-bearing.
      const otherP = buildCorrelation(forecast, measurement, "prop-other", TS);
      expect(otherP.correlationId).not.toBe(base.correlationId);

      // resolution (the observed band derived from outcome) is identity-bearing.
      const otherOutcome = buildCorrelation(
        forecast,
        makeMeasurement({ outcome: "ineffective" }),
        "prop-1",
        TS,
      );
      expect(otherOutcome.correlationId).not.toBe(base.correlationId);

      // Same content → same id.
      expect(buildCorrelation(forecast, measurement, "prop-1", TS).correlationId).toBe(
        base.correlationId,
      );
    });

    it("built correlationId equals correlationIdFor(content) — the canonical id", () => {
      const c = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      const content: A9CorrelationContent = {
        correlationVersion: c.correlationVersion,
        forecastId: c.forecastId,
        measurementId: c.measurementId,
        foreignProvenance: c.foreignProvenance,
        resolution: c.resolution,
      };
      expect(c.correlationId).toBe(correlationIdFor(content));
    });

    it("correlationId excludes storage/position — canonical content never mentions them", () => {
      const c = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      const content: A9CorrelationContent = {
        correlationVersion: c.correlationVersion,
        forecastId: c.forecastId,
        measurementId: c.measurementId,
        foreignProvenance: c.foreignProvenance,
        resolution: c.resolution,
      };
      const canonical = canonicalizeCorrelation(content);
      expect(canonical).not.toContain("seq");
      expect(canonical).not.toContain("position");
      expect(canonical).not.toContain("correlationId");
    });

    it("timestamp is event-context, NOT identity-bearing (not in content)", () => {
      const a = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", "2026-08-01T00:00:00.000Z");
      const b = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", "2026-08-20T00:00:00.000Z");
      // The correlation artifact has no timestamp field; identity is unchanged.
      expect(a.correlationId).toBe(b.correlationId);
    });
  });

  // -------------------------------------------------------------------------
  // CorrelationEngine — measurement-arrival-driven, canonical two-hop bridge
  // -------------------------------------------------------------------------

  describe("CorrelationEngine — valid path through the two-hop bridge", () => {
    it("emits one correlation when submitted(target matches) + executed + in-horizon", async () => {
      await store.append(makeForecast());
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      const out = await e.correlateMeasurement(makeMeasurement(), TS);
      expect(out).toHaveLength(1);
      expect(out[0]!.forecastId).toBe((await store.list())[0]!.forecastId);
      expect(out[0]!.measurementId).toBe("m-1");
      expect(out[0]!.foreignProvenance.proposalId).toBe("prop-1");
      expect(out[0]!.resolution.forecastBand).toBe("high");
      expect(out[0]!.resolution.band).toBe("low");
      expect(out[0]!.resolution.delta).toBe("over-forecast");
    });
  });

  describe("CorrelationEngine — bridge failure produces NO correlation", () => {
    it("no proposal.submitted event → no correlation", async () => {
      await store.append(makeForecast());
      const e = engine([
        makeProposal({ kind: "proposal.executed" }),
      ]);
      expect(await e.correlateMeasurement(makeMeasurement(), TS)).toEqual([]);
    });

    it("submitted event target.id mismatch → no correlation (no repair/infer)", async () => {
      await store.append(makeForecast()); // subjectCapability cap-1
      const e = engine([
        // submitted target.id = cap-9 ≠ cap-1
        makeProposal({
          kind: "proposal.submitted",
          capabilityId: "cap-9",
          payload: { proposalId: "prop-1", ...submittedPayload("cap-9") },
        }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      expect(await e.correlateMeasurement(makeMeasurement(), TS)).toEqual([]);
    });

    it("no proposal.executed event → no correlation (execution did not occur)", async () => {
      await store.append(makeForecast());
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.approved" }),
      ]);
      expect(await e.correlateMeasurement(makeMeasurement(), TS)).toEqual([]);
    });

    it("rejected proposal (rejected event, no executed) → no correlation", async () => {
      await store.append(makeForecast());
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.rejected" }),
      ]);
      expect(await e.correlateMeasurement(makeMeasurement(), TS)).toEqual([]);
    });

    it("a rejected event is never correlated even when executed also present", async () => {
      await store.append(makeForecast());
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
        makeProposal({ kind: "proposal.rejected" }),
      ]);
      expect(await e.correlateMeasurement(makeMeasurement(), TS)).toEqual([]);
    });

    it("wrong capability — no forecast for the measurement's capability → no correlation", async () => {
      await store.append(makeForecast({ subjectCapability: "cap-1" }));
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      const out = await e.correlateMeasurement(
        makeMeasurement({ capabilityId: "cap-9" }),
        TS,
      );
      expect(out).toEqual([]);
    });

    it("outside horizon — recordedAt before horizon.from → no correlation", async () => {
      await store.append(makeForecast()); // horizon [2026-08-01, 2026-08-31]
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      const out = await e.correlateMeasurement(
        makeMeasurement({ recordedAt: "2026-07-31T23:59:59.999Z" }),
        TS,
      );
      expect(out).toEqual([]);
    });

    it("outside horizon — recordedAt after horizon.to → no correlation", async () => {
      await store.append(makeForecast()); // horizon [2026-08-01, 2026-08-31]
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      const out = await e.correlateMeasurement(
        makeMeasurement({ recordedAt: "2026-09-01T00:00:00.000Z" }),
        TS,
      );
      expect(out).toEqual([]);
    });

    it("horizon boundaries are inclusive (recordedAt == from / == to correlate)", async () => {
      await store.append(makeForecast()); // horizon [2026-08-01, 2026-08-31]
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      expect(
        await e.correlateMeasurement(makeMeasurement({ recordedAt: "2026-08-01T00:00:00.000Z" }), TS),
      ).toHaveLength(1);
      expect(
        await e.correlateMeasurement(makeMeasurement({ recordedAt: "2026-08-31T00:00:00.000Z" }), TS),
      ).toHaveLength(1);
    });

    it("an unparseable forecast horizon is fail-closed (no correlation, no throw)", async () => {
      await store.append(makeForecast({ horizon: { from: "garbage", to: "2026-08-31T00:00:00.000Z" } }));
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      expect(await e.correlateMeasurement(makeMeasurement(), TS)).toEqual([]);
    });
  });

  describe("CorrelationEngine — many-to-many emission, no heuristics, no primary", () => {
    it("multiple measurements in window → one independent correlation per pair (F1→M1, F1→M2)", async () => {
      await store.append(makeForecast()); // F1
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      const out = await e.correlateMeasurement(
        makeMeasurement({ measurementId: "m-1", recordedAt: "2026-08-10T00:00:00.000Z" }),
        TS,
      );
      const out2 = await e.correlateMeasurement(
        makeMeasurement({ measurementId: "m-2", recordedAt: "2026-08-20T00:00:00.000Z" }),
        TS,
      );
      const all = [...out, ...out2];
      expect(all).toHaveLength(2);
      expect(new Set(all.map((c) => c.measurementId))).toEqual(new Set(["m-1", "m-2"]));
      expect(new Set(all.map((c) => c.correlationId)).size).toBe(2);
      // No primary designation on either.
      for (const c of all) {
        expect(Object.keys(c)).not.toContain("primary");
      }
    });

    it("shared measurement — F1→M1 AND F2→M1 both emitted (many-to-many, no primary)", async () => {
      await store.append(makeForecast({ subject: "prop-1", subjectCapability: "cap-1" })); // F1
      await store.append(makeForecast({ subject: "prop-2", subjectCapability: "cap-1" })); // F2
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1", proposalId: "prop-1" }),
        makeProposal({ kind: "proposal.executed", proposalId: "prop-1" }),
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1", proposalId: "prop-2" }),
        makeProposal({ kind: "proposal.executed", proposalId: "prop-2" }),
      ]);
      const out = await e.correlateMeasurement(makeMeasurement({ measurementId: "m-1" }), TS);
      expect(out).toHaveLength(2);
      const forecastIds = out.map((c) => c.forecastId).sort();
      const stored = (await store.list()).map((f) => f.forecastId).sort();
      expect(forecastIds).toEqual(stored);
      expect(out.every((c) => c.measurementId === "m-1")).toBe(true);
      expect(new Set(out.map((c) => c.correlationId)).size).toBe(2);
    });

    it("no temporal heuristic — both in-window measurements correlated, neither preferred", async () => {
      await store.append(makeForecast()); // F1, horizon [08-01, 08-31]
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      const early = makeMeasurement({ measurementId: "m-early", recordedAt: "2026-08-02T00:00:00.000Z" });
      const late = makeMeasurement({ measurementId: "m-late", recordedAt: "2026-08-30T00:00:00.000Z" });
      const out = await e.correlateMeasurement(early, TS);
      const out2 = await e.correlateMeasurement(late, TS);
      const ids = [...out, ...out2].map((c) => c.measurementId).sort();
      // No "latest"/"nearest"/"first" selection — BOTH are independently correlated.
      expect(ids).toEqual(["m-early", "m-late"]);
    });

    it("no payload heuristic — measurements with identical payload content both correlated independently", async () => {
      await store.append(makeForecast());
      const e = engine([
        makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
        makeProposal({ kind: "proposal.executed" }),
      ]);
      // Identical canonical content (same capabilityId/outcome/recordedAt), distinct ids.
      const a = makeMeasurement({ measurementId: "m-a" });
      const b = makeMeasurement({ measurementId: "m-b" });
      const out = await e.correlateMeasurement(a, TS);
      const out2 = await e.correlateMeasurement(b, TS);
      expect([...out, ...out2]).toHaveLength(2);
      expect(out[0]!.correlationId).not.toBe(out2[0]!.correlationId);
    });
  });

  describe("CorrelationEngine — correlate(timestamp) drains the measurement adapter", () => {
    it("lists all measurements from the adapter and emits per-pair correlations", async () => {
      await store.append(makeForecast()); // F1
      const measurements = [
        makeMeasurement({ measurementId: "m-1", recordedAt: "2026-08-10T00:00:00.000Z" }),
        makeMeasurement({ measurementId: "m-2", recordedAt: "2026-08-20T00:00:00.000Z" }),
      ];
      const e = new CorrelationEngine({
        forecasts,
        proposalEvents: fakeProposalAdapter([
          makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
          makeProposal({ kind: "proposal.executed" }),
        ]),
        measurements: fakeMeasurementAdapter(measurements),
      });
      const out = await e.correlate(TS);
      expect(out).toHaveLength(2);
      // Deterministic order: sorted by forecastId then measurementId.
      expect(out.map((c) => c.measurementId)).toEqual(["m-1", "m-2"]);
    });

    it("emits nothing when the adapter has no measurements", async () => {
      await store.append(makeForecast());
      const e = new CorrelationEngine({
        forecasts,
        proposalEvents: fakeProposalAdapter([
          makeProposal({ kind: "proposal.submitted", capabilityId: "cap-1" }),
          makeProposal({ kind: "proposal.executed" }),
        ]),
        measurements: fakeMeasurementAdapter([]),
      });
      expect(await e.correlate(TS)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // CorrelationsStore — append-only JSONL + dedupe-on-append
  // -------------------------------------------------------------------------

  describe("CorrelationsStore — append/list/getById round-trip", () => {
    let cstore: CorrelationsStore;
    let correlations: A9Correlation[];

    beforeEach(() => {
      cstore = new CorrelationsStore(dir);
      correlations = [
        buildCorrelation(
          makeForecast({ subject: "prop-1" }),
          makeMeasurement({ measurementId: "m-1" }),
          "prop-1",
          TS,
        ),
        buildCorrelation(
          makeForecast({ subject: "prop-2" }),
          makeMeasurement({ measurementId: "m-2" }),
          "prop-2",
          TS,
        ),
      ];
    });

    it("defaults to .alix/governance/correlations.jsonl relative to cwd", () => {
      const defaultStore = new CorrelationsStore();
      const filePath = (defaultStore as unknown as { filePath: string }).filePath;
      expect(filePath).toBe(
        join(process.cwd(), ".alix", "governance", "correlations.jsonl"),
      );
    });

    it("append → list round-trips the correlation with correlationId intact", async () => {
      expect(await cstore.append(correlations[0]!)).toBe(true);
      const all = await cstore.list();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(correlations[0]);
      expect(all[0]!.correlationId).toMatch(/^[0-9a-f]{64}$/);
    });

    it("getById returns the stored correlation; missing id → null", async () => {
      await cstore.append(correlations[0]!);
      expect(await cstore.getById(correlations[0]!.correlationId)).toEqual(correlations[0]);
      expect(await cstore.getById("not-a-stored-id")).toBeNull();
    });

    it("empty store → list() is [] and getById returns null", async () => {
      expect(await cstore.list()).toEqual([]);
      expect(await cstore.getById("any")).toBeNull();
    });

    it("stores distinct correlations (different content → different correlationId)", async () => {
      await cstore.append(correlations[0]!);
      await cstore.append(correlations[1]!);
      const all = await cstore.list();
      expect(all).toHaveLength(2);
      expect(new Set(all.map((c) => c.correlationId)).size).toBe(2);
    });
  });

  describe("CorrelationsStore — findByForecastId / findByMeasurementId query projections", () => {
    let cstore: CorrelationsStore;
    let f1: A9Forecast;
    let f2: A9Forecast;

    beforeEach(async () => {
      cstore = new CorrelationsStore(dir);
      f1 = makeForecast({ subject: "prop-1" });
      f2 = makeForecast({ subject: "prop-2" });
      // F1 → M1, F1 → M2, F2 → M1  (many-to-many)
      await cstore.append(buildCorrelation(f1, makeMeasurement({ measurementId: "m-1" }), "prop-1", TS));
      await cstore.append(buildCorrelation(f1, makeMeasurement({ measurementId: "m-2" }), "prop-1", TS));
      await cstore.append(buildCorrelation(f2, makeMeasurement({ measurementId: "m-1" }), "prop-2", TS));
    });

    it("findByForecastId returns only that forecast's correlations (append order)", async () => {
      const hits = await cstore.findByForecastId(f1.forecastId);
      expect(hits).toHaveLength(2);
      expect(hits.map((c) => c.measurementId).sort()).toEqual(["m-1", "m-2"]);
      expect(await cstore.findByForecastId("no-such-forecast")).toEqual([]);
    });

    it("findByMeasurementId returns only that measurement's correlations (many-to-many)", async () => {
      const hits = await cstore.findByMeasurementId("m-1");
      expect(hits).toHaveLength(2);
      expect(hits.map((c) => c.forecastId).sort()).toEqual(
        [f1.forecastId, f2.forecastId].sort(),
      );
      expect(await cstore.findByMeasurementId("no-such-measurement")).toEqual([]);
    });
  });

  describe("CorrelationsStore — duplicate-identity policy (deterministic, no mutation)", () => {
    it("appending an identical correlationId twice is a deterministic no-op", async () => {
      const cstore = new CorrelationsStore(dir);
      const c = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      expect(await cstore.append(c)).toBe(true);
      expect(await cstore.append(c)).toBe(false);
      const all = await cstore.list();
      expect(all).toHaveLength(1);
      // The stored record is byte-identical to the original — never mutated.
      expect(all[0]).toEqual(c);
    });

    it("same canonical content → same correlationId → dedupe even across construction", async () => {
      const cstore = new CorrelationsStore(dir);
      const a = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      const b = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      expect(a.correlationId).toBe(b.correlationId);
      expect(await cstore.append(a)).toBe(true);
      expect(await cstore.append(b)).toBe(false);
      expect(await cstore.list()).toHaveLength(1);
    });

    it("distinct content (different measurement) → distinct id → both stored", async () => {
      const cstore = new CorrelationsStore(dir);
      const a = buildCorrelation(makeForecast(), makeMeasurement({ measurementId: "m-1" }), "prop-1", TS);
      const b = buildCorrelation(makeForecast(), makeMeasurement({ measurementId: "m-2" }), "prop-1", TS);
      await cstore.append(a);
      await cstore.append(b);
      expect(await cstore.list()).toHaveLength(2);
    });

    it("identical content with keys in a different order is deduped, not a false FATAL collision", async () => {
      const cstore = new CorrelationsStore(dir);
      const c = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      expect(await cstore.append(c)).toBe(true);

      // The SAME content serialized with keys in a different order. The
      // content-addressed correlationId is unchanged (identity canonicalizes
      // keys), so the store's collision check must use the SAME canonical
      // stringify and recognize this as the SAME artifact — dedupe no-op
      // (returns false), never a false FATAL identity collision.
      const reordered: A9Correlation = {
        correlationId: c.correlationId,
        resolution: {
          forecastBand: c.resolution.forecastBand,
          delta: c.resolution.delta,
          band: c.resolution.band,
        },
        foreignProvenance: { proposalId: c.foreignProvenance.proposalId },
        measurementId: c.measurementId,
        forecastId: c.forecastId,
        correlationVersion: c.correlationVersion,
      };
      // Insertion-order stringify would treat these as DIFFERENT content and
      // throw a false collision; canonical comparison dedupes.
      expect(await cstore.append(reordered)).toBe(false);

      const all = await cstore.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.correlationId).toBe(c.correlationId);
    });
  });

  describe("CorrelationsStore — corruption tolerance + atomic writes", () => {
    it("skips corrupt lines on read", async () => {
      const cstore = new CorrelationsStore(dir);
      const c = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      await cstore.append(c);
      await writeFile(join(dir, "correlations.jsonl"), "this-is-not-json\n", { flag: "a" });

      const all = await cstore.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.correlationId).toBe(c.correlationId);
      expect(await cstore.getById(c.correlationId)).toEqual(c);
    });

    it("appending still works after a corrupt line exists (raw bytes preserved)", async () => {
      const cstore = new CorrelationsStore(dir);
      await cstore.append(
        buildCorrelation(makeForecast({ subject: "prop-1" }), makeMeasurement(), "prop-1", TS),
      );
      await writeFile(join(dir, "correlations.jsonl"), "not-json\n", { flag: "a" });

      await cstore.append(
        buildCorrelation(makeForecast({ subject: "prop-2" }), makeMeasurement(), "prop-2", TS),
      );
      const all = await cstore.list();
      expect(all).toHaveLength(2);
    });

    it("tmp-then-rename atomic append leaves a valid file and no .tmp leftover", async () => {
      const cstore = new CorrelationsStore(dir);
      await cstore.append(
        buildCorrelation(makeForecast({ subject: "prop-1" }), makeMeasurement(), "prop-1", TS),
      );
      await cstore.append(
        buildCorrelation(makeForecast({ subject: "prop-2" }), makeMeasurement(), "prop-2", TS),
      );

      const entries = await readdir(dir);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
      expect(entries).toContain("correlations.jsonl");

      const fresh = new CorrelationsStore(dir);
      expect(await fresh.list()).toEqual(await cstore.list());
    });
  });

  describe("CorrelationsStore — no mutation surface", () => {
    it("exposes only append/list/getById/findByForecastId/findByMeasurementId", () => {
      // append/list/getById live on the shared JsonlStore base (Std #1
      // extraction); walk the prototype chain so inherited methods count.
      const methodNames = (() => {
        const names = new Set<string>();
        let proto = CorrelationsStore.prototype;
        while (proto && proto !== Object.prototype) {
          for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
          proto = Object.getPrototypeOf(proto);
        }
        return [...names];
      })();
      expect(methodNames).toContain("append");
      expect(methodNames).toContain("list");
      expect(methodNames).toContain("getById");
      expect(methodNames).toContain("findByForecastId");
      expect(methodNames).toContain("findByMeasurementId");
      for (const mutation of ["update", "delete", "remove", "upsert", "replace"]) {
        expect(methodNames).not.toContain(mutation);
      }
    });
  });

  // -------------------------------------------------------------------------
  // CorrelationsAdapter — read-only Q6 many-to-many query path
  // -------------------------------------------------------------------------

  describe("CorrelationsAdapter — byForecast / byMeasurement", () => {
    let cstore: CorrelationsStore;
    let cadapter: CorrelationsAdapter;
    let f1: A9Forecast;
    let f2: A9Forecast;

    beforeEach(async () => {
      cstore = new CorrelationsStore(dir);
      cadapter = new CorrelationsAdapter(cstore);
      f1 = makeForecast({ subject: "prop-1" });
      f2 = makeForecast({ subject: "prop-2" });
      await cstore.append(buildCorrelation(f1, makeMeasurement({ measurementId: "m-1" }), "prop-1", TS));
      await cstore.append(buildCorrelation(f1, makeMeasurement({ measurementId: "m-2" }), "prop-1", TS));
      await cstore.append(buildCorrelation(f2, makeMeasurement({ measurementId: "m-1" }), "prop-2", TS));
    });

    it("byForecast returns all correlations for a forecast", async () => {
      const hits = await cadapter.byForecast(f1.forecastId);
      expect(hits).toHaveLength(2);
      expect(hits.map((c) => c.measurementId).sort()).toEqual(["m-1", "m-2"]);
      expect(await cadapter.byForecast("no-such")).toEqual([]);
    });

    it("byMeasurement answers 'all forecasts sharing measurement M' (Q6 many-to-many)", async () => {
      const hits = await cadapter.byMeasurement("m-1");
      expect(hits).toHaveLength(2);
      // F1→M1 AND F2→M1 — no primary designation, both forecasts returned.
      expect(hits.map((c) => c.forecastId).sort()).toEqual(
        [f1.forecastId, f2.forecastId].sort(),
      );
      expect(await cadapter.byMeasurement("no-such")).toEqual([]);
    });

    it("empty store → every lookup is empty", async () => {
      const empty = new CorrelationsAdapter(new CorrelationsStore(dir));
      expect(await empty.byForecast("f")).toEqual([]);
      expect(await empty.byMeasurement("m")).toEqual([]);
    });

    it("exposes only list/byForecast/byMeasurement — no write surface", () => {
      const proto = Object.getOwnPropertyNames(CorrelationsAdapter.prototype);
      expect(proto).toContain("byForecast");
      expect(proto).toContain("byMeasurement");
      for (const mutation of ["append", "update", "delete", "remove", "upsert"]) {
        expect(proto).not.toContain(mutation);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Phase 27 — post-execution correlation INTEGRATION fixture (real adapters
  // over EventLog-shaped events): proposalId → submitted.target.id →
  // measurement.capabilityId → exactly one A9Correlation.
  // -------------------------------------------------------------------------

  describe("Phase 27 — post-execution correlation integration (real adapters)", () => {
    function fakeEventLog(events: ReadonlyArray<AlixEvent>): EventLog {
      return { readAll: vi.fn(async () => events) } as unknown as EventLog;
    }

    function submittedEvt(
      proposalId: string,
      targetId: string,
      seq: number,
      timestamp = "2026-08-01T00:00:00.000Z",
    ): AlixEvent {
      return {
        id: `sub-${proposalId}`,
        seq,
        version: 1,
        sessionId: "s1",
        timestamp,
        type: "capability.governance.proposal.submitted",
        actor: "system",
        payload: {
          proposalId,
          candidate: { target: { kind: "capability", id: targetId } },
          signalIds: [],
          sourceVersion: null,
        },
      } as AlixEvent;
    }

    function executedEvt(proposalId: string, seq: number, timestamp = "2026-08-02T00:00:00.000Z"): AlixEvent {
      return {
        id: `exe-${proposalId}`,
        seq,
        version: 1,
        sessionId: "s1",
        timestamp,
        type: "capability.governance.proposal.executed",
        actor: "system",
        payload: { proposalId },
      } as AlixEvent;
    }

    function measuredEvt(
      measurementId: string,
      capabilityId: string,
      seq: number,
      timestamp = "2026-08-15T00:00:00.000Z",
    ): AlixEvent {
      return {
        id: measurementId,
        seq,
        version: 1,
        sessionId: "s1",
        timestamp,
        type: "capability.governance.measurement.measured",
        actor: "system",
        payload: {
          measurement: { capabilityId, version: "v1" },
          post: { observationId: "obs-1", takenAt: timestamp, status: "complete", confidence: 0.9 },
          outcome: { kind: "effective", evidenceRefs: [], confidence: 0.9, summary: "ok", signals: [] },
        },
      } as AlixEvent;
    }

    async function setup(dir: string, events: ReadonlyArray<AlixEvent>): Promise<CorrelationEngine> {
      const forecastStore = new ForecastsStore(dir);
      const forecasts = new ForecastsAdapter(forecastStore);
      return new CorrelationEngine({
        forecasts,
        proposalEvents: new ProposalEventsAdapter(fakeEventLog(events)),
        measurements: new MeasurementEventsAdapter(fakeEventLog(events)),
      });
    }

    it("proposalId → submitted.target.id → measurement.capabilityId yields exactly one correlation", async () => {
      const dir = await mkdtemp(join(tmpdir(), "a9-phase27-one-"));
      const f1 = makeForecast(); // subject prop-1, capability cap-1, horizon covers 08-15
      await new ForecastsStore(dir).append(f1);

      const engine = await setup(dir, [
        submittedEvt("prop-1", "cap-1", 1),
        executedEvt("prop-1", 2),
        measuredEvt("m-1", "cap-1", 3),
      ]);
      const correlations = await engine.correlate(TS);
      expect(correlations).toHaveLength(1);
      expect(correlations[0]!.forecastId).toBe(f1.forecastId);
      expect(correlations[0]!.measurementId).toBe("m-1");
      // foreignProvenance carries the proposal reference (foreign, not A9-owned).
      expect(correlations[0]!.foreignProvenance.proposalId).toBe("prop-1");
    });

    it("two forecasts sharing one measurement → two independent correlations (many-to-many)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "a9-phase27-2f-"));
      const f1 = makeForecast(); // prop-1/cap-1
      const f2 = makeForecast({ subject: "prop-2", subjectCapability: "cap-1" });
      await new ForecastsStore(dir).append(f1);
      await new ForecastsStore(dir).append(f2);

      const engine = await setup(dir, [
        submittedEvt("prop-1", "cap-1", 1),
        executedEvt("prop-1", 2),
        submittedEvt("prop-2", "cap-1", 3),
        executedEvt("prop-2", 4),
        measuredEvt("m-1", "cap-1", 5),
      ]);
      const correlations = await engine.correlate(TS);
      expect(correlations).toHaveLength(2);
      const fids = correlations.map((c) => c.forecastId).sort();
      expect(fids).toEqual([f1.forecastId, f2.forecastId].sort());
      for (const c of correlations) expect(c.measurementId).toBe("m-1");
    });

    it("one forecast with two measurements → two independent correlations (many-to-many)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "a9-phase27-2m-"));
      const f1 = makeForecast();
      await new ForecastsStore(dir).append(f1);

      const engine = await setup(dir, [
        submittedEvt("prop-1", "cap-1", 1),
        executedEvt("prop-1", 2),
        measuredEvt("m-1", "cap-1", 3),
        measuredEvt("m-2", "cap-1", 4),
      ]);
      const correlations = await engine.correlate(TS);
      expect(correlations).toHaveLength(2);
      const mids = correlations.map((c) => c.measurementId).sort();
      expect(mids).toEqual(["m-1", "m-2"]);
      for (const c of correlations) expect(c.forecastId).toBe(f1.forecastId);
    });

    it("identical correlation re-append is a deterministic no-op, NOT a collision", async () => {
      const dir = await mkdtemp(join(tmpdir(), "a9-phase27-dedupe-"));
      const store = new CorrelationsStore(dir);
      const f1 = makeForecast();
      await new ForecastsStore(dir).append(f1);
      const engine = await setup(dir, [
        submittedEvt("prop-1", "cap-1", 1),
        executedEvt("prop-1", 2),
        measuredEvt("m-1", "cap-1", 3),
      ]);
      const correlations = await engine.correlate(TS);
      expect(correlations).toHaveLength(1);
      expect(await store.append(correlations[0]!)).toBe(true);
      expect(await store.append(correlations[0]!)).toBe(false);
      expect(await store.list()).toHaveLength(1);
    });

    it("DIFFERENT content mapping to the same correlationId is FATAL (no overwrite/merge)", async () => {
      const dir = await mkdtemp(join(tmpdir(), "a9-phase27-collision-"));
      const store = new CorrelationsStore(dir);
      const base = buildCorrelation(makeForecast(), makeMeasurement(), "prop-1", TS);
      await store.append(base);
      // Same correlationId but different resolution content → different content
      // mapping to the same id is impossible via canonical hashing, but the
      // store must not silently dedupe such a record — it must throw.
      const tampered: A9Correlation = {
        ...base,
        resolution: { band: "critical", forecastBand: "high", delta: "match" },
      };
      // Craft an explicit same-id collision by aliasing the id.
      const sameIdDifferentContent: A9Correlation = { ...tampered, correlationId: base.correlationId };
      await expect(store.append(sameIdDifferentContent)).rejects.toThrow(/identity collision/i);
    });
  });
});
