/**
 * P7a — Append-only OutcomeStore backed by JSONL.
 *
 * One JSON object per line. No update-in-place. No delete. No compaction.
 * Corrupt lines are skipped with a warning — the store doesn't crash on bad data.
 *
 * @module
 */

import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OutcomeRecord } from "./outcome-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTFILE = "outcomes.jsonl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function dateKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// OutcomeStore
// ---------------------------------------------------------------------------

export class OutcomeStore {
  constructor(private readonly storeDir: string) {}

  // ---------------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------------

  /**
   * Append an outcome record to the store.
   *
   * Generates an ID if the record doesn't already have one (format:
   * `outcome:YYYY-MM-DD-<random>`). Sets `generatedAt` to the current
   * timestamp if not already provided.
   *
   * Appends are always additive — even if a record with the same `id`
   * already exists, this writes a new line. Callers own deduplication.
   */
  async append(record: OutcomeRecord): Promise<void> {
    this.ensureStoreDir();

    if (!record.id) {
      record.id = `outcome:${dateKey()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    if (!record.generatedAt) {
      record.generatedAt = now();
    }

    const line = JSON.stringify(record) + "\n";
    await appendFile(this.filePath(), line, "utf-8");
  }

  // ---------------------------------------------------------------------------
  // Read — single
  // ---------------------------------------------------------------------------

  /**
   * Return the first record with the given `id`, or `null` if not found.
   */
  async get(id: string): Promise<OutcomeRecord | null> {
    const records = await this.list();
    return records.find((r) => r.id === id) ?? null;
  }

  // ---------------------------------------------------------------------------
  // Read — bulk
  // ---------------------------------------------------------------------------

  /**
   * Return every record in the store.
   *
   * Missing file is treated as an empty store. Corrupt lines are skipped
   * with a console warning.
   */
  async list(): Promise<OutcomeRecord[]> {
    if (!existsSync(this.filePath())) {
      return [];
    }
    return this.readAll();
  }

  /**
   * Return all records whose `subjectId` matches the given value.
   */
  async queryBySubject(subjectId: string): Promise<OutcomeRecord[]> {
    const all = await this.list();
    return all.filter((r) => r.subjectId === subjectId);
  }

  /**
   * Return all records whose `generatedAt` falls within the last N days.
   *
   * `now` is optional and defaults to the wall clock — pass it explicitly
   * when you need determinism (adapters thread their run-shared
   * `generatedAt` through). Acceptable inputs are any `Date.parse`-able
   * string (typically an ISO-8601 timestamp). Mistype-prone on purpose:
   * tests with fixed historical timestamps would silently miss every
   * record as the wall clock drifts past the test's "now".
   */
  async queryByWindow(windowDays: number, now?: string): Promise<OutcomeRecord[]> {
    const refStr = now ?? new Date().toISOString();
    const refMs = Date.parse(refStr);
    if (!Number.isFinite(refMs)) {
      throw new Error(`queryByWindow: now=${JSON.stringify(now)} is not parseable`);
    }
    const cutoffMs = refMs - windowDays * 86_400_000;
    const cutoffStr = new Date(cutoffMs).toISOString();

    const all = await this.list();
    return all.filter((r) => r.generatedAt >= cutoffStr);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private filePath(): string {
    return join(this.storeDir, OUTFILE);
  }

  private ensureStoreDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true, mode: 0o755 });
    }
  }

  private async readAll(): Promise<OutcomeRecord[]> {
    const raw = await readFile(this.filePath(), "utf-8");
    const records: OutcomeRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as OutcomeRecord);
      } catch {
        console.warn(
          `OutcomeStore: skipping corrupt line: ${trimmed.slice(0, 80)}...`,
        );
      }
    }
    return records;
  }
}
