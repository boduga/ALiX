import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  A9Forecast,
  A9ForecastContent,
} from "../../src/evolution/a9/contracts/a9-contract.js";
import {
  A9_FORECAST_VERSION,
  A9_GENERATOR_VERSION,
} from "../../src/evolution/a9/contracts/a9-contract.js";
import { forecastIdFor } from "../../src/evolution/a9/identity.js";
import { ForecastsStore } from "../../src/evolution/a9/forecasts-store.js";
import { ForecastsAdapter } from "../../src/evolution/a9/forecasts-adapter.js";
import { CorrelationsStore } from "../../src/evolution/a9/correlations-store.js";
import { buildCorrelation } from "../../src/evolution/a9/correlation-builder.js";
import type { CapabilityMeasurementRecord } from "../../src/evolution/a9/contracts/a9-contract.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a valid A9Forecast whose forecastId is the content-addressed id of its
 * canonical content — same content always yields the same forecastId, so the
 * duplicate-identity policy is exercised against the REAL identity function.
 */
function makeForecast(
  overrides: {
    subject?: string;
    subjectCapability?: string;
    from?: string;
    to?: string;
    generatedAt?: string;
  } = {},
): A9Forecast {
  const content: A9ForecastContent = {
    forecastVersion: A9_FORECAST_VERSION,
    subject: overrides.subject ?? "prop-1",
    subjectCapability: overrides.subjectCapability ?? "cap-1",
    prediction: { kind: "trust-velocity", band: "high", internalScore: 0.7 },
    horizon: {
      from: overrides.from ?? "2026-08-01T00:00:00.000Z",
      to: overrides.to ?? "2026-08-31T00:00:00.000Z",
    },
    confidence: 0.8,
    provenance: {
      generatedAt: overrides.generatedAt ?? "2026-08-01T00:00:00.000Z",
      generatorVersion: A9_GENERATOR_VERSION,
      evidenceRefs: ["ev-1"],
    },
  };
  return { forecastId: forecastIdFor(content), ...content };
}

// ---------------------------------------------------------------------------
// Harness — temp store dir per test (never touches real .alix/governance/)
// ---------------------------------------------------------------------------

describe("A9 forecast persistence", () => {
  let dir: string;
  let store: ForecastsStore;
  let adapter: ForecastsAdapter;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "a9-forecasts-"));
    store = new ForecastsStore(dir);
    adapter = new ForecastsAdapter(store);
  });

  afterEach(async () => {
    // Temp dirs are cleaned by the OS; nothing is written outside them.
  });

  // -------------------------------------------------------------------------
  // Store — append / list / getById round-trip
  // -------------------------------------------------------------------------

  describe("ForecastsStore — append/list/getById", () => {
    it("defaults to .alix/governance/forecasts.jsonl relative to cwd", () => {
      const defaultStore = new ForecastsStore();
      const filePath = (defaultStore as unknown as { filePath: string }).filePath;
      expect(filePath).toBe(
        join(process.cwd(), ".alix", "governance", "forecasts.jsonl"),
      );
    });

    it("append → list round-trips the forecast with forecastId intact", async () => {
      const forecast = makeForecast();
      const written = await store.append(forecast);
      expect(written).toBe(true);

      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(all[0]).toEqual(forecast);
      // Content-addressed id preserved verbatim (never recomputed by the store).
      expect(all[0]!.forecastId).toBe(forecast.forecastId);
      expect(all[0]!.forecastId).toMatch(/^[0-9a-f]{64}$/);
    });

    it("getById returns the stored forecast; missing id → null", async () => {
      const forecast = makeForecast();
      await store.append(forecast);
      expect(await store.getById(forecast.forecastId)).toEqual(forecast);
      expect(await store.getById("definitely-not-a-stored-id")).toBeNull();
    });

    it("stores distinct forecasts (different content → different forecastId)", async () => {
      await store.append(makeForecast({ subject: "prop-1" }));
      await store.append(makeForecast({ subject: "prop-2" }));
      const all = await store.list();
      expect(all).toHaveLength(2);
      expect(new Set(all.map((f) => f.forecastId)).size).toBe(2);
    });

    it("empty store → list() is [] and getById returns null", async () => {
      expect(await store.list()).toEqual([]);
      expect(await store.getById("any")).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Store — duplicate-identity policy
  // -------------------------------------------------------------------------

  describe("ForecastsStore — duplicate-identity policy", () => {
    it("appending an identical forecastId twice is a deterministic no-op", async () => {
      const forecast = makeForecast();
      const first = await store.append(forecast);
      const second = await store.append(forecast);
      // Content-addressed identity: same content → same id → second append skipped.
      expect(first).toBe(true);
      expect(second).toBe(false);

      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.forecastId).toBe(forecast.forecastId);
    });

    it("the dedupe decision is driven solely by content-addressed identity", async () => {
      // Two distinct artifacts that share a subject but differ in content
      // (different evidence refs → different content → different id) are BOTH
      // stored. The policy never collapses distinct artifacts.
      const a = makeForecast({
        subject: "prop-1",
        generatedAt: "2026-08-01T00:00:00.000Z",
      });
      const b = makeForecast({
        subject: "prop-1",
        generatedAt: "2026-08-02T00:00:00.000Z",
      });
      expect(a.forecastId).not.toBe(b.forecastId);
      await store.append(a);
      await store.append(b);
      expect(await store.list()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Store — corrupt-line tolerance + atomic write
  // -------------------------------------------------------------------------

  describe("ForecastsStore — corruption tolerance + atomic writes", () => {
    it("skips corrupt lines on read", async () => {
      const forecast = makeForecast();
      await store.append(forecast);
      // Graft a non-JSON line onto the tail of the JSONL file.
      await writeFile(join(dir, "forecasts.jsonl"), "this-is-not-json\n", {
        flag: "a",
      });

      const all = await store.list();
      expect(all).toHaveLength(1);
      expect(all[0]!.forecastId).toBe(forecast.forecastId);
      // getById still resolves against the valid records.
      expect(await store.getById(forecast.forecastId)).toEqual(forecast);
    });

    it("appending still works after a corrupt line exists (raw bytes preserved)", async () => {
      const forecast = makeForecast();
      await store.append(forecast);
      await writeFile(join(dir, "forecasts.jsonl"), "not-json\n", { flag: "a" });

      const second = makeForecast({ subject: "prop-2" });
      await store.append(second);

      const all = await store.list();
      // Corrupt line still skipped; both valid records present.
      expect(all).toHaveLength(2);
      expect(all.map((f) => f.subject).sort()).toEqual(["prop-1", "prop-2"]);
    });

    it("tmp-then-rename atomic append leaves a valid file and no .tmp leftover", async () => {
      await store.append(makeForecast());
      await store.append(makeForecast({ subject: "prop-2" }));

      const entries = await readdir(dir);
      expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
      expect(entries).toContain("forecasts.jsonl");

      const all = await store.list();
      expect(all).toHaveLength(2);
      // Re-open through a fresh store instance to prove the file is stable JSONL.
      const fresh = new ForecastsStore(dir);
      expect(await fresh.list()).toEqual(all);
    });
  });

  // -------------------------------------------------------------------------
  // Adapter — read-only query surface
  // -------------------------------------------------------------------------

  describe("ForecastsAdapter — correlation lookup surface", () => {
    it("empty store → every lookup is empty", async () => {
      expect(await adapter.list()).toEqual([]);
      expect(await adapter.findByProposalId("prop-1")).toEqual([]);
      expect(await adapter.findByCapability("cap-1")).toEqual([]);
      expect(await adapter.findValidAt("2026-08-15T00:00:00.000Z")).toEqual([]);
    });

    it("findByProposalId matches on subject", async () => {
      await store.append(makeForecast({ subject: "prop-1" }));
      await store.append(makeForecast({ subject: "prop-2" }));

      const hits = await adapter.findByProposalId("prop-1");
      expect(hits.map((f) => f.subject)).toEqual(["prop-1"]);
      expect(await adapter.findByProposalId("prop-absent")).toEqual([]);
    });

    it("findByCapability matches on subjectCapability", async () => {
      await store.append(makeForecast({ subjectCapability: "cap-1" }));
      await store.append(makeForecast({ subjectCapability: "cap-2" }));

      const hits = await adapter.findByCapability("cap-2");
      expect(hits.map((f) => f.subjectCapability)).toEqual(["cap-2"]);
      expect(await adapter.findByCapability("cap-absent")).toEqual([]);
    });

    it("findValidAt window semantics — within included, boundaries inclusive", async () => {
      // horizon = [2026-08-01, 2026-08-31]
      await store.append(makeForecast({ subject: "prop-1" }));

      // strictly inside → included
      const inside = await adapter.findValidAt("2026-08-15T00:00:00.000Z");
      expect(inside.map((f) => f.subject)).toEqual(["prop-1"]);

      // lower boundary inclusive → included
      expect(
        (await adapter.findValidAt("2026-08-01T00:00:00.000Z")).map((f) => f.subject),
      ).toEqual(["prop-1"]);

      // upper boundary inclusive → included
      expect(
        (await adapter.findValidAt("2026-08-31T00:00:00.000Z")).map((f) => f.subject),
      ).toEqual(["prop-1"]);
    });

    it("findValidAt window semantics — before/after excluded", async () => {
      // horizon = [2026-08-01, 2026-08-31]
      await store.append(makeForecast({ subject: "prop-1" }));

      expect(await adapter.findValidAt("2026-07-31T23:59:59.999Z")).toEqual([]);
      expect(await adapter.findValidAt("2026-09-01T00:00:00.000Z")).toEqual([]);
    });

    it("findValidAt throws on an unparseable query timestamp", async () => {
      await store.append(makeForecast());
      await expect(adapter.findValidAt("not-a-timestamp")).rejects.toThrow(
        /not parseable/,
      );
    });

    it("does not invent correlation semantics — lookups are plain filters", async () => {
      await store.append(makeForecast({ subject: "prop-1", subjectCapability: "cap-1" }));
      await store.append(makeForecast({ subject: "prop-2", subjectCapability: "cap-1" }));
      await store.append(makeForecast({ subject: "prop-3", subjectCapability: "cap-2" }));

      // Each lookup is an independent projection over stored forecasts; no
      // cross-forecast grouping, no ranking, no primary/derived status.
      expect((await adapter.findByProposalId("prop-1")).map((f) => f.subject)).toEqual([
        "prop-1",
      ]);
      const cap1 = await adapter.findByCapability("cap-1");
      expect(cap1.map((f) => f.subject).sort()).toEqual(["prop-1", "prop-2"]);
      // Results are in append order (no ranking).
      expect(cap1[0]!.subject).toBe("prop-1");
    });
  });

  // -------------------------------------------------------------------------
  // No mutation surface
  // -------------------------------------------------------------------------

  describe("No mutation surface", () => {
    it("the store exposes only append/list/getById — no update/delete/remove", () => {
      const proto = Object.getOwnPropertyNames(ForecastsStore.prototype);
      expect(proto).toContain("append");
      expect(proto).toContain("list");
      expect(proto).toContain("getById");
      for (const mutation of ["update", "delete", "remove", "upsert", "replace"]) {
        expect(proto).not.toContain(mutation);
      }
    });

    it("the adapter exposes only list/findByProposalId/findByCapability/findValidAt — no write surface", () => {
      const proto = Object.getOwnPropertyNames(ForecastsAdapter.prototype);
      expect(proto).toContain("list");
      expect(proto).toContain("findByProposalId");
      expect(proto).toContain("findByCapability");
      expect(proto).toContain("findValidAt");
      for (const mutation of ["append", "update", "delete", "remove", "upsert"]) {
        expect(proto).not.toContain(mutation);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 23/32 — restart / persistence verification (Q4)
//
// Simulates: process 1 writes a forecast + correlation → shutdown → process 2
// clears memory, reloads BOTH JSONL stores, queries by forecastId and
// measurementId. The forecast → correlation → measurement reference must
// reconstruct ENTIRELY from A9-owned persistence (forecasts.jsonl +
// correlations.jsonl) — no foreign A9-relationship record is required.
// ---------------------------------------------------------------------------

describe("A9 restart verification — forecast → correlation → measurement reference reconstructs from A9-owned persistence", () => {
  const TS = "2026-08-15T00:00:00.000Z";

  /** Content-addressed forecast (process-1 artifact). */
  function makeForecast(): A9Forecast {
    const content: A9ForecastContent = {
      forecastVersion: A9_FORECAST_VERSION,
      subject: "prop-1",
      subjectCapability: "cap-1",
      prediction: { kind: "trust-velocity", band: "high", internalScore: 0.7 },
      horizon: { from: "2026-08-01T00:00:00.000Z", to: "2026-08-31T00:00:00.000Z" },
      confidence: 0.8,
      provenance: {
        generatedAt: "2026-08-01T00:00:00.000Z",
        generatorVersion: A9_GENERATOR_VERSION,
        evidenceRefs: ["ev-1"],
      },
    };
    return { forecastId: forecastIdFor(content), ...content };
  }

  function makeMeasurement(overrides: Partial<CapabilityMeasurementRecord> = {}): CapabilityMeasurementRecord {
    return {
      measurementId: "m-1",
      capabilityId: "cap-1",
      outcome: "effective",
      recordedAt: "2026-08-15T00:00:00.000Z",
      eventId: "10",
      ...overrides,
    };
  }

  it("process-2 rebuilds the reference from only the two A9 JSONL stores", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-restart-"));

    // ---- process 1: write forecast + correlation, then "shutdown" ----
    const forecast = makeForecast();
    const correlation = buildCorrelation(forecast, makeMeasurement(), forecast.subject, TS);
    const p1ForecastStore = new ForecastsStore(dir);
    const p1CorrelationStore = new CorrelationsStore(dir);
    expect(await p1ForecastStore.append(forecast)).toBe(true);
    expect(await p1CorrelationStore.append(correlation)).toBe(true);
    // (no in-memory references survive — the next block constructs fresh stores)

    // ---- process 2: memory cleared, both stores reloaded from disk ----
    const p2ForecastStore = new ForecastsStore(dir);
    const p2CorrelationStore = new CorrelationsStore(dir);

    // Query by forecastId.
    const reloadedForecast = await p2ForecastStore.getById(forecast.forecastId);
    expect(reloadedForecast).not.toBeNull();
    expect(reloadedForecast!.forecastId).toBe(forecast.forecastId);
    expect(reloadedForecast!.subject).toBe("prop-1");

    // Query by measurementId → the correlation carrying forecast + measurement refs.
    const byMeasurement = await p2CorrelationStore.findByMeasurementId("m-1");
    expect(byMeasurement).toHaveLength(1);
    expect(byMeasurement[0]!.correlationId).toBe(correlation.correlationId);

    // The full reference chain reconstructs entirely from A9-owned records:
    // forecast(forecastId) → correlation(forecastId + measurementId) → measurement ref.
    const byForecast = await p2CorrelationStore.findByForecastId(forecast.forecastId);
    expect(byForecast).toHaveLength(1);
    expect(byForecast[0]!.measurementId).toBe("m-1");
    // The correlation references the forecast by its content-addressed id.
    expect(byForecast[0]!.forecastId).toBe(reloadedForecast!.forecastId);

    // Only the two A9-owned JSONL files exist — no foreign relationship record.
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    expect(files.sort()).toEqual(["correlations.jsonl", "forecasts.jsonl"]);
  });

  it("same data reconstructs the SAME A9 artifacts (deterministic identity, no mutation)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-restart2-"));
    const forecast = makeForecast();
    const correlation = buildCorrelation(forecast, makeMeasurement(), forecast.subject, TS);
    await new ForecastsStore(dir).append(forecast);
    await new CorrelationsStore(dir).append(correlation);

    // Re-construct the artifacts from scratch and compare — identical content
    // yields identical ids (content addressing), so the "reconstructed" and
    // "stored" artifacts are byte-identical.
    const forecast2 = makeForecast();
    const correlation2 = buildCorrelation(forecast2, makeMeasurement(), forecast.subject, TS);
    expect(forecast2.forecastId).toBe(forecast.forecastId);
    expect(correlation2.correlationId).toBe(correlation.correlationId);
    expect(await new ForecastsStore(dir).list()).toEqual([forecast]);
    expect(await new CorrelationsStore(dir).list()).toEqual([correlation]);
  });

  it("a forecast identity collision (different content, same id) is FATAL — throws, no silent continue", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a9-collision-"));
    const store = new ForecastsStore(dir);
    const forecast = makeForecast();
    await store.append(forecast);

    // Craft an explicit same-id different-content collision (impossible via the
    // canonical hash, but the store must not silently dedupe/merge it).
    const tampered: A9Forecast = {
      ...forecast,
      confidence: 0.99,
      forecastId: forecast.forecastId, // alias the content-addressed id
    };
    await expect(store.append(tampered)).rejects.toThrow(/identity collision/i);
    // The original artifact is untouched — no overwrite, no merge.
    expect(await store.list()).toEqual([forecast]);
  });
});
