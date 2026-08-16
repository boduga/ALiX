/**
 * A9 — ForecastsStore (Slice 2, Phase 9).
 *
 * Append-only JSONL persistence for A9Forecast artifacts.
 *
 * Storage: .alix/governance/forecasts.jsonl
 *
 * Implementation is the shared generic append-only JSONL store
 * (`jsonl-store.ts`, extracted from this store + CorrelationsStore — the two
 * were near-identical, code-review Std #1). The type-specific bits here are
 * the store file name, the `forecastId` accessor, and the canonical-content
 * accessor used by the duplicate-identity policy.
 *
 * @module evolution/a9/forecasts-store
 */

import { join } from "node:path";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { A9Forecast, ForecastId } from "./contracts/a9-contract.js";
import { JsonlStore } from "./jsonl-store.js";

const STORE_DIR = join(".alix", "governance");
const STORE_FILE = "forecasts.jsonl";

export class ForecastsStore extends JsonlStore<A9Forecast, ForecastId> {
  /** @param storeDir directory holding forecasts.jsonl (defaults to
   *  `process.cwd()/.alix/governance`, mirroring GovernanceReviewStore). */
  constructor(storeDir: string = join(process.cwd(), STORE_DIR)) {
    super(storeDir, {
      storeFile: STORE_FILE,
      idOf: (f) => f.forecastId,
      contentOf: forecastContentOf,
      label: "ForecastsStore",
      idLabel: "forecastId",
    });
  }
}

/**
 * Canonical content of a forecast record (everything except its
 * content-addressed id), serialized with the SAME canonical stringify the
 * identity uses (identity.ts → canonicalStringify: recursively sorted keys).
 * Two records with the SAME id must have the SAME canonical content — if they
 * differ, a fatal identity collision occurred. Canonical serialization makes
 * the comparison key-order-independent, so it matches the content-addressed
 * id (same content in a different key order is the same artifact, not a
 * false collision).
 */
export function forecastContentOf(forecast: A9Forecast): string {
  const { forecastId: _id, ...content } = forecast;
  return canonicalStringify(content);
}
