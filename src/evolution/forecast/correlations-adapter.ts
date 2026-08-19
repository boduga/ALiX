/**
 * A9 — CorrelationsAdapter (Slice 4, Phase 14).
 *
 * Read-only query projection over the correlations store. It answers the Q6
 * many-to-many query path:
 *
 *   "all forecasts sharing measurement M"  →  `byMeasurement(M)`
 *   "all measurements sharing forecast F"  →  `byForecast(F)`
 *
 * It NEVER mutates stored records and exposes no write surface. No new
 * measurement-group artifact is introduced — `byMeasurement` is a plain query
 * over the single correlations.jsonl structure.
 *
 * @module evolution/forecast/correlations-adapter
 */

import type { Correlation } from "./contracts/contract.js";
import type { CorrelationsStore } from "./correlations-store.js";

export class CorrelationsAdapter {
  constructor(private readonly store: CorrelationsStore) {}

  /**
   * All stored correlations, in append order (oldest first).
   */
  async list(): Promise<ReadonlyArray<Correlation>> {
    return this.store.list();
  }

  /**
   * All correlations whose `forecastId` is the given forecast (append order).
   * Answers "all measurements correlated with forecast F".
   */
  async byForecast(forecastId: string): Promise<ReadonlyArray<Correlation>> {
    return this.store.findByForecastId(forecastId);
  }

  /**
   * All correlations whose `measurementId` is the given measurement (append
   * order). Answers the Q6 many-to-many query "all forecasts sharing
   * measurement M".
   */
  async byMeasurement(measurementId: string): Promise<ReadonlyArray<Correlation>> {
    return this.store.findByMeasurementId(measurementId);
  }
}
