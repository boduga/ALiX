// tests/forecasting/health-forecast-store.vitest.ts
//
// P11.5 — HealthForecastStore tests.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { HealthForecastStore, validateForecast } from "../../src/forecasting/health-forecast-store.js";
import type { HealthForecast } from "../../src/forecasting/forecasting-types.js";
import { ForecasterError } from "../../src/forecasting/forecasting-types.js";

function makeForecast(overrides?: Partial<HealthForecast>): HealthForecast {
  return {
    schemaVersion: "p11.5.0",
    forecastId: "forecast-test-1",
    generatedAt: "2026-07-03T12:00:00.000Z",
    sourceConfidenceModelId: "lrn-test-1",
    sourcePlanId: "strat-test-1",
    rootCauseAnalysisId: "reason-anl-1",
    correlationGraphId: "abc123",
    projections: [],
    forecastWindows: 3,
    windowDurationMs: 604800000,
    meta: {
      subsystemsForecast: 0,
      highConfidenceForecasts: 0,
      mediumConfidenceForecasts: 0,
      lowConfidenceForecasts: 0,
      trendWindow: 5,
    },
    ...overrides,
  };
}

function makeDir(): string {
  return mkdtempSync(join(tmpdir(), "p11-5-store-test-"));
}

function cleanDir(dir: string): void {
  try {
    const f = join(dir, "health-forecasts.jsonl");
    if (existsSync(f)) unlinkSync(f);
    rmdirSync(dir);
  } catch { /* ok */ }
}

describe("HealthForecastStore", () => {
  let dir: string;
  let store: HealthForecastStore;

  beforeEach(() => {
    dir = makeDir();
    store = new HealthForecastStore(dir);
  });

  afterEach(() => cleanDir(dir));

  // T11: save + loadLatest round-trip
  it("round-trips a forecast through save and loadLatest", async () => {
    const forecast = makeForecast({ forecastId: "forecast-t11" });
    await store.save(forecast);
    const loaded = await store.loadLatest();
    expect(loaded).not.toBeNull();
    expect(loaded!.forecastId).toBe("forecast-t11");
    expect(loaded!.sourcePlanId).toBe("strat-test-1");
  });

  // T12: loadLatest returns last of two saves
  it("returns the most recently saved forecast", async () => {
    await store.save(makeForecast({ forecastId: "first" }));
    await store.save(makeForecast({ forecastId: "second" }));
    const loaded = await store.loadLatest();
    expect(loaded!.forecastId).toBe("second");
  });

  // T13: loadLatest from non-existent file returns null
  it("returns null when no file exists", async () => {
    expect(await store.loadLatest()).toBeNull();
  });

  // T14: invalid schema version throws
  it("throws ForecasterError on invalid schema version", () => {
    expect(() => validateForecast({ schemaVersion: "p11.4.0" })).toThrow(ForecasterError);
  });
});
