/**
 * A9 — CorrelationsStore (Slice 4, Phase 13).
 *
 * Append-only JSONL persistence for A9Correlation artifacts.
 *
 * Storage: .alix/governance/correlations.jsonl
 *
 * Implementation is the shared generic append-only JSONL store
 * (`jsonl-store.ts`, extracted from this store + ForecastsStore — the two were
 * near-identical, code-review Std #1). The type-specific bits here are the
 * store file name, the `correlationId` accessor, the canonical-content
 * accessor, and the two query/index operations `findByForecastId` /
 * `findByMeasurementId` (plain queries over the single JSONL structure — NOT
 * additional persistence structures).
 *
 * @module evolution/a9/correlations-store
 */

import { join } from "node:path";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { A9Correlation, CorrelationId } from "./contracts/a9-contract.js";
import { JsonlStore } from "./jsonl-store.js";

const STORE_DIR = join(".alix", "governance");
const STORE_FILE = "correlations.jsonl";

export class CorrelationsStore extends JsonlStore<A9Correlation, CorrelationId> {
  /** @param storeDir directory holding correlations.jsonl (defaults to
   *  `process.cwd()/.alix/governance`, mirroring ForecastsStore). */
  constructor(storeDir: string = join(process.cwd(), STORE_DIR)) {
    super(storeDir, {
      storeFile: STORE_FILE,
      idOf: (c) => c.correlationId,
      contentOf: correlationContentOf,
      label: "CorrelationsStore",
      idLabel: "correlationId",
    });
  }

  /**
   * Query: all stored correlations for a forecast (append order).
   * Index operation over the single JSONL structure — NOT a new store.
   */
  async findByForecastId(forecastId: string): Promise<ReadonlyArray<A9Correlation>> {
    const all = await this.list();
    return all.filter((c) => c.forecastId === forecastId);
  }

  /**
   * Query: all stored correlations for a given measurement (append order).
   * Index operation over the single JSONL structure — NOT a new store.
   */
  async findByMeasurementId(measurementId: string): Promise<ReadonlyArray<A9Correlation>> {
    const all = await this.list();
    return all.filter((c) => c.measurementId === measurementId);
  }
}

/**
 * Canonical content of a correlation record (everything except its
 * content-addressed id), serialized with the SAME canonical stringify the
 * identity uses (identity.ts → canonicalStringify: recursively sorted keys).
 * Two records with the SAME id must have the SAME canonical content — if they
 * differ, a fatal identity collision occurred. Canonical serialization makes
 * the comparison key-order-independent, so it matches the content-addressed
 * id (same content in a different key order is the same artifact, not a
 * false collision).
 */
export function correlationContentOf(correlation: A9Correlation): string {
  const { correlationId: _id, ...content } = correlation;
  return canonicalStringify(content);
}
