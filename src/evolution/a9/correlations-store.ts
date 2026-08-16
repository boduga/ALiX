/**
 * A9 — CorrelationsStore (Slice 4, Phase 13).
 *
 * Append-only JSONL persistence for A9Correlation artifacts.
 *
 * Storage: .alix/governance/correlations.jsonl
 *
 * Invariants (locked by the A9 plan, Phase 13 — mirrors the Slice 2
 * ForecastsStore):
 *   - append-only: a stored correlation is never modified or deleted after it
 *     is appended. No mutation methods are exposed.
 *   - one JSON object per line (JSONL).
 *   - atomic record-level writes: every append rewrites the whole file through
 *     the tmp-then-rename pattern — write a `.tmp` file, fsync it, then
 *     `rename()` into place. POSIX rename is atomic, so a crash mid-append
 *     leaves either the prior file fully intact or the new record fully
 *     written — never a half-written line.
 *   - corrupt lines are skipped on read (`list()` / `getById()` /
 *     `findByForecastId()` / `findByMeasurementId()` never throw on a
 *     malformed line; they ignore it). The raw bytes of the file are preserved
 *     across appends, so a corrupt line already present is never rewritten away
 *     by a later append.
 *   - duplicate-identity policy (deterministic): because `correlationId` is
 *     content-addressed (SHA-256 of the FULL canonical correlation content —
 *     forecastId + measurementId + foreignProvenance + resolution — see
 *     identity.ts), two identical `A9Correlation` objects always carry the same
 *     `correlationId`. Appending an identical `correlationId` a second time is
 *     a NO-OP (skipped): the store keeps exactly one record per distinct
 *     correlation artifact. The decision is driven solely by the
 *     content-addressed identity — no wall clock, no append position, and no
 *     dedupe sidecar participate. Distinct content → distinct id → both stored.
 *
 * `findByForecastId` / `findByMeasurementId` are QUERY/INDEX operations over
 * the single JSONL structure — they are NOT additional persistence structures.
 *
 * @module evolution/a9/correlations-store
 */

import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { canonicalStringify } from "../../security/audit/canonical-json.js";
import type { A9Correlation, CorrelationId } from "./contracts/a9-contract.js";

const STORE_DIR = join(".alix", "governance");
const STORE_FILE = "correlations.jsonl";
const TMP_SUFFIX = ".tmp";

export class CorrelationsStore {
  private readonly storeDir: string;
  private readonly filePath: string;

  /** @param storeDir directory holding correlations.jsonl (defaults to
   *  `process.cwd()/.alix/governance`, mirroring ForecastsStore). */
  constructor(storeDir: string = join(process.cwd(), STORE_DIR)) {
    this.storeDir = storeDir;
    this.filePath = join(storeDir, STORE_FILE);
  }

  private async ensureStoreDir(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
  }

  /**
   * Append one correlation to the store, stored verbatim (the content-addressed
   * `correlationId` is preserved exactly as given — never recomputed or altered).
   *
   * Duplicate-identity policy (deterministic): if a stored correlation has the
   * SAME `correlationId` AND the SAME content, the append is a NO-OP and
   * `false` is returned (no bytes written). If DIFFERENT content maps to the
   * SAME `correlationId`, the append THROWS — a deterministic identity
   * collision is FATAL: no overwrite, no merge, no silent continue (Phase 20
   * locked). An existing correlation is never mutated.
   *
   * @returns true when the correlation was written; false when an identical
   *          correlation was already present (dedupe no-op).
   * @throws {Error} when different content maps to an already-present
   *          `correlationId` (fatal identity collision).
   */
  async append(correlation: A9Correlation): Promise<boolean> {
    await this.ensureStoreDir();
    const raw = existsSync(this.filePath)
      ? await readFile(this.filePath, "utf-8")
      : "";

    // Duplicate-identity policy: scan the existing records for the same
    // content-addressed id. Corrupt lines cannot participate in identity
    // dedupe and are skipped (they are also never rewritten away).
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let stored: A9Correlation | undefined;
      try {
        stored = JSON.parse(trimmed) as A9Correlation;
      } catch {
        // Skip corrupt line — it carries no usable identity.
      }
      if (!stored || typeof stored.correlationId !== "string") continue;
      if (stored.correlationId === correlation.correlationId) {
        if (correlationContentOf(stored) === correlationContentOf(correlation)) {
          // Identical content → deterministic dedupe no-op (never rewritten).
          return false;
        }
        // Deterministic identity collision: DIFFERENT content maps to the SAME
        // content-addressed id. Fatal — no overwrite, no merge, no silent continue.
        throw new Error(
          `CorrelationsStore: identity collision — different content maps to correlationId '${correlation.correlationId}' (fatal: no overwrite, no merge)`,
        );
      }
    }

    // Guard against an externally-tampered tail line lacking a newline, which
    // would otherwise merge the new record onto it (Slice-2 review minor).
    const separator = raw && !raw.endsWith("\n") ? "\n" : "";
    const line = JSON.stringify(correlation) + "\n";
    const tmpPath = this.filePath + TMP_SUFFIX;
    // Atomic write: tmp-then-rename with fsync before the rename. A crash
    // between write and rename leaves the prior file intact; after the rename
    // the new record is fully durable.
    const handle = await open(tmpPath, "w");
    try {
      await handle.writeFile(raw + separator + line, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, this.filePath);
    return true;
  }

  /**
   * Look up a stored correlation by its content-addressed id.
   * @returns the stored correlation, or null when no record matches.
   */
  async getById(correlationId: CorrelationId): Promise<A9Correlation | null> {
    const all = await this.list();
    return all.find((c) => c.correlationId === correlationId) ?? null;
  }

  /**
   * Read all stored correlations in append order (oldest first), skipping
   * corrupt lines. Returns [] when the file does not exist.
   */
  async list(): Promise<ReadonlyArray<A9Correlation>> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf-8");
    const out: A9Correlation[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as A9Correlation);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }

  /**
   * Query: all stored correlations for a given forecast (append order).
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
function correlationContentOf(correlation: A9Correlation): string {
  const { correlationId: _id, ...content } = correlation;
  return canonicalStringify(content);
}
