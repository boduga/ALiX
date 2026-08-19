/**
 * A9 — canonical identity utilities (Slice 1, Phase 2).
 *
 * Forecast/correlation identities are content-addressed: SHA-256 hex of the
 * canonical JSON form of the artifact's CONTENT. Canonicalization is
 * deterministic (recursively sorted keys, arrays in order) via the generic
 * `canonicalStringify` serializer in `security/audit/canonical-json.ts` —
 * the suitable existing generic canonicalization helper (the brief's Phase 2
 * "if no suitable existing generic canonicalization helper already exists"
 * is satisfied by reuse rather than an A9-local serializer).
 *
 * Identity exclusions (locked):
 *   - `forecastId` is excluded — the identity functions operate on
 *     `ForecastContent` / `CorrelationContent`, which structurally lack
 *     the content-addressed id field, so it can never leak into the hash.
 *   - Storage / JSONL position / append order are excluded — those fields do
 *     not exist on the content types, so position is never an identity input.
 *   - `generatedAt` IS identity-bearing: it is part of the artifact content
 *     (provenance), not incidental metadata. Same evidence generated at a
 *     different time is a distinct artifact with a distinct id. This prevents
 *     id collisions in the later persistence slice (two runs = two artifacts).
 *
 * Same content → same id; changed content → different id; storage order never
 * changes id; repeated construction → identical ids.
 *
 * @module evolution/forecast/identity
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type {
  CorrelationContent,
  ForecastContent,
  CorrelationId,
  ForecastId,
} from "./contracts/contract.js";

/** Hex SHA-256 of a UTF-8 string. */
function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Deterministic canonical JSON of forecast CONTENT (forecastId excluded by
 *  the content type). Throws on non-serializable values (e.g. non-finite
 *  numbers) — loud failure is deterministic and preferred to silent drift. */
export function canonicalizeForecast(forecast: ForecastContent): string {
  return canonicalStringify(forecast);
}

/** Content-addressed forecast id: SHA-256 hex of the canonical content. */
export function forecastIdFor(forecast: ForecastContent): ForecastId {
  return sha256Hex(canonicalizeForecast(forecast));
}

/** Deterministic canonical JSON of correlation CONTENT (correlationId excluded
 *  by the content type). Identity derives from content, never JSONL position. */
export function canonicalizeCorrelation(correlation: CorrelationContent): string {
  return canonicalStringify(correlation);
}

/** Content-addressed correlation id: SHA-256 hex of the canonical content. */
export function correlationIdFor(correlation: CorrelationContent): CorrelationId {
  return sha256Hex(canonicalizeCorrelation(correlation));
}
