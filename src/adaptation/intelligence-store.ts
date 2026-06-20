/**
 * P5.3.2 — IntelligenceStore.
 *
 * Append-only JSON persistence for IntelligenceReports under
 * `.alix/adaptation/intelligence/`.  Each report is keyed by its `generatedAt`
 * timestamp (with `:` replaced by `-` for filesystem compatibility).
 *
 * Pure persistence layer — no analytics, no mutations beyond saving files.
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { IntelligenceReport } from "./intelligence-types.js";

/**
 * Persists intelligence reports as standalone JSON files.
 *
 * Reports are immutable on disk — each run of the intelligence pipeline produces
 * a new file keyed by its generation timestamp.  This enables future comparative
 * analysis (Report N vs Report N-1) without coupling to the evidence chain.
 */
export class IntelligenceStore {
  constructor(private readonly dir: string) {}

  /**
   * Save a report to disk.
   *
   * Creates the target directory if it does not already exist.  The filename is
   * derived from `report.generatedAt` by replacing all `:` with `-`.
   */
  async save(report: IntelligenceReport): Promise<void> {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    const filename = this.#filenameFor(report.generatedAt);
    writeFileSync(join(this.dir, filename), JSON.stringify(report, null, 2), "utf-8");
  }

  /**
   * Load a specific report by filename (e.g. `2026-06-19T23-30-00.000Z.json`).
   *
   * Returns `null` when the file does not exist.
   */
  async load(filename: string): Promise<IntelligenceReport | null> {
    const path = join(this.dir, filename);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as IntelligenceReport;
  }

  /**
   * List all report filenames, sorted newest-first.
   *
   * Returns an empty array when the directory does not exist.
   */
  async list(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
  }

  /**
   * Load the most recent report (by filename sort — newest-first from `list()`).
   *
   * Returns `null` when no reports have been saved yet.
   */
  async loadLatest(): Promise<IntelligenceReport | null> {
    const files = await this.list();
    if (files.length === 0) return null;
    return this.load(files[0]);
  }

  // ---- private helpers ------------------------------------------------

  /** Derive a safe filename from a `generatedAt` ISO 8601 timestamp. */
  #filenameFor(generatedAt: string): string {
    // Replace `:` with `-` so the timestamp is filesystem-safe on all platforms.
    const safeTimestamp = generatedAt.replace(/:/g, "-");
    return `${safeTimestamp}.json`;
  }
}
