/**
 * A9 — ForecastsStore (Slice 2, Phase 9).
 *
 * Append-only JSONL persistence for A9Forecast artifacts.
 *
 * Storage: .alix/governance/forecasts.jsonl
 *
 * Invariants (locked by the A9 plan, Phase 9):
 *   - append-only: a stored forecast is never modified or deleted after it is
 *     appended. No mutation methods are exposed.
 *   - one JSON object per line (JSONL).
 *   - atomic record-level writes: every append rewrites the whole file through
 *     the tmp-then-rename pattern — write a `.tmp` file, fsync it, then
 *     `rename()` into place. POSIX rename is atomic, so a crash mid-append
 *     leaves either the prior file fully intact or the new record fully
 *     written — never a half-written line.
 *   - corrupt lines are skipped on read (`list()`/`getById()` never throw on a
 *     malformed line; they ignore it). The raw bytes of the file are preserved
 *     across appends, so a corrupt line already present is never rewritten away
 *     by a later append.
 *   - duplicate-identity policy (deterministic): because `forecastId` is
 *     content-addressed (SHA-256 of canonical content — see identity.ts), two
 *     identical `A9Forecast` objects always carry the same `forecastId`.
 *     Appending an identical `forecastId` a second time is a NO-OP (skipped):
 *     the store keeps exactly one record per distinct forecast artifact.
 *     The decision is driven solely by the content-addressed identity — no wall
 *     clock, no append position, and no dedupe sidecar participate. Distinct
 *     content → distinct id → both stored (a re-run at a different
 *     `generatedAt` is a distinct artifact and is stored as such).
 *
 * @module evolution/a9/forecasts-store
 */

import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { A9Forecast, ForecastId } from "./contracts/a9-contract.js";

const STORE_DIR = join(".alix", "governance");
const STORE_FILE = "forecasts.jsonl";
const TMP_SUFFIX = ".tmp";

export class ForecastsStore {
  private readonly storeDir: string;
  private readonly filePath: string;

  /** @param storeDir directory holding forecasts.jsonl (defaults to
   *  `process.cwd()/.alix/governance`, mirroring GovernanceReviewStore). */
  constructor(storeDir: string = join(process.cwd(), STORE_DIR)) {
    this.storeDir = storeDir;
    this.filePath = join(storeDir, STORE_FILE);
  }

  private async ensureStoreDir(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
  }

  /**
   * Append one forecast to the store, stored verbatim (the content-addressed
   * `forecastId` is preserved exactly as given — never recomputed or altered).
   *
   * Duplicate-identity policy (deterministic): if a stored forecast has the
   * SAME `forecastId` AND the SAME content, the append is a NO-OP and `false`
   * is returned (no bytes written). If DIFFERENT content maps to the SAME
   * `forecastId`, the append THROWS — a deterministic identity collision is
   * FATAL: no overwrite, no merge, no silent continue (Phase 20 locked).
   *
   * @returns true when the forecast was written; false when an identical
   *          forecast was already present (dedupe no-op).
   * @throws {Error} when different content maps to an already-present
   *          `forecastId` (fatal identity collision).
   */
  async append(forecast: A9Forecast): Promise<boolean> {
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
      let stored: A9Forecast | undefined;
      try {
        stored = JSON.parse(trimmed) as A9Forecast;
      } catch {
        // Skip corrupt line — it carries no usable identity.
      }
      if (!stored || typeof stored.forecastId !== "string") continue;
      if (stored.forecastId === forecast.forecastId) {
        if (forecastContentOf(stored) === forecastContentOf(forecast)) {
          // Identical content → deterministic dedupe no-op (never rewritten).
          return false;
        }
        // Deterministic identity collision: DIFFERENT content maps to the SAME
        // content-addressed id. Fatal — no overwrite, no merge, no silent continue.
        throw new Error(
          `ForecastsStore: identity collision — different content maps to forecastId '${forecast.forecastId}' (fatal: no overwrite, no merge)`,
        );
      }
    }

    const line = JSON.stringify(forecast) + "\n";
    const tmpPath = this.filePath + TMP_SUFFIX;
    // Atomic write: tmp-then-rename with fsync before the rename. A crash
    // between write and rename leaves the prior file intact; after the rename
    // the new record is fully durable.
    const handle = await open(tmpPath, "w");
    try {
      await handle.writeFile(raw + line, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, this.filePath);
    return true;
  }

  /**
   * Look up a stored forecast by its content-addressed id.
   * @returns the stored forecast, or null when no record matches.
   */
  async getById(forecastId: ForecastId): Promise<A9Forecast | null> {
    const all = await this.list();
    return all.find((f) => f.forecastId === forecastId) ?? null;
  }

  /**
   * Read all stored forecasts in append order (oldest first), skipping corrupt
   * lines. Returns [] when the file does not exist.
   */
  async list(): Promise<ReadonlyArray<A9Forecast>> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf-8");
    const out: A9Forecast[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as A9Forecast);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }
}

/**
 * Canonical content of a forecast record (everything except its
 * content-addressed id). Two records with the SAME id must have the SAME
 * canonical content — if they differ, a fatal identity collision occurred.
 * Round-tripped JSONL preserves key order, so this comparison is stable for
 * stored records.
 */
function forecastContentOf(forecast: A9Forecast): string {
  const { forecastId: _id, ...content } = forecast;
  return JSON.stringify(content);
}
