/**
 * A9 — generic append-only JSONL store (extracted from ForecastsStore +
 * CorrelationsStore, which were near-identical — code-review Std #1).
 *
 * Append-only JSONL persistence for a content-addressed record type.
 *
 * Invariants (locked by the A9 plan — Phase 9/13):
 *   - append-only: a stored record is never modified or deleted after it is
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
 *   - duplicate-identity policy (deterministic): because the record id is
 *     content-addressed (SHA-256 of canonical content — see identity.ts), two
 *     identical records always carry the same id. Appending an identical id a
 *     second time is a NO-OP (skipped): the store keeps exactly one record per
 *     distinct artifact. The decision is driven solely by the content-addressed
 *     identity — no wall clock, no append position, no dedupe sidecar
 *     participate. Distinct content → distinct id → both stored (a re-run at a
 *     different `generatedAt` is a distinct artifact and is stored as such).
 *
 * The id/content extraction is injected (`idOf`/`contentOf`) so the two A9
 * store types share this single implementation.
 *
 * @module evolution/forecast/jsonl-store
 */

import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

const TMP_SUFFIX = ".tmp";

export interface JsonlStoreConfig<TRecord, TId extends string = string> {
  /** JSONL file name within the store dir (e.g. "forecasts.jsonl"). */
  readonly storeFile: string;
  /** Extract the content-addressed id from a record. */
  readonly idOf: (record: TRecord) => TId;
  /** Canonical content of a record, EXCLUDING its content-addressed id,
   *  serialized with the SAME canonical stringify the identity uses
   *  (identity.ts → canonicalStringify: recursively sorted keys). Two records
   *  with the SAME id must have the SAME canonical content — if they differ, a
   *  fatal identity collision occurred. Canonical serialization makes the
   *  comparison key-order-independent, so it matches the content-addressed id
   *  (same content in a different key order is the same artifact, not a false
   *  collision). */
  readonly contentOf: (record: TRecord) => string;
  /** Store label used in fatal collision messages (e.g. "ForecastsStore"). */
  readonly label: string;
  /** Id-field label used in fatal collision messages (e.g. "forecastId"). */
  readonly idLabel: string;
}

export class JsonlStore<TRecord, TId extends string = string> {
  private readonly storeDir: string;
  /** Full path to the JSONL file (exposed for inspection). */
  readonly filePath: string;
  private readonly config: JsonlStoreConfig<TRecord, TId>;

  /** @param storeDir directory holding the JSONL file.
   *  @param config type-specific id/content extraction + labels. */
  constructor(storeDir: string, config: JsonlStoreConfig<TRecord, TId>) {
    this.storeDir = storeDir;
    this.config = config;
    this.filePath = join(storeDir, config.storeFile);
  }

  private async ensureStoreDir(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });
  }

  /**
   * Append one record to the store, stored verbatim (the content-addressed id
   * is preserved exactly as given — never recomputed or altered).
   *
   * Duplicate-identity policy (deterministic): if a stored record has the SAME
   * id AND the SAME content, the append is a NO-OP and `false` is returned (no
   * bytes written). If DIFFERENT content maps to the SAME id, the append
   * THROWS — a deterministic identity collision is FATAL: no overwrite, no
   * merge, no silent continue (Phase 20 locked).
   *
   * @returns true when the record was written; false when an identical record
   *          was already present (dedupe no-op).
   * @throws {Error} when different content maps to an already-present id
   *          (fatal identity collision).
   */
  async append(record: TRecord): Promise<boolean> {
    await this.ensureStoreDir();
    const raw = existsSync(this.filePath)
      ? await readFile(this.filePath, "utf-8")
      : "";

    const id = this.config.idOf(record);

    // Duplicate-identity policy: scan the existing records for the same
    // content-addressed id. Corrupt lines cannot participate in identity
    // dedupe and are skipped (they are also never rewritten away).
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let stored: TRecord | undefined;
      try {
        stored = JSON.parse(trimmed) as TRecord;
      } catch {
        // Skip corrupt line — it carries no usable identity.
      }
      if (!stored) continue;
      const storedId = this.config.idOf(stored);
      if (typeof storedId !== "string") continue;
      if (storedId === id) {
        if (this.config.contentOf(stored) === this.config.contentOf(record)) {
          // Identical content → deterministic dedupe no-op (never rewritten).
          return false;
        }
        // Deterministic identity collision: DIFFERENT content maps to the SAME
        // content-addressed id. Fatal — no overwrite, no merge, no silent continue.
        throw new Error(
          `${this.config.label}: identity collision — different content maps to ${this.config.idLabel} '${id}' (fatal: no overwrite, no merge)`,
        );
      }
    }

    // Guard against an externally-tampered tail line lacking a newline, which
    // would otherwise merge the new record onto it (Slice-2 review minor).
    const separator = raw && !raw.endsWith("\n") ? "\n" : "";
    const line = JSON.stringify(record) + "\n";
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
   * Look up a stored record by its content-addressed id.
   * @returns the stored record, or null when no record matches.
   */
  async getById(id: TId): Promise<TRecord | null> {
    const all = await this.list();
    return all.find((r) => this.config.idOf(r) === id) ?? null;
  }

  /**
   * Read all stored records in append order (oldest first), skipping corrupt
   * lines. Returns [] when the file does not exist.
   */
  async list(): Promise<ReadonlyArray<TRecord>> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf-8");
    const out: TRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as TRecord);
      } catch {
        // Skip corrupt lines.
      }
    }
    return out;
  }
}
