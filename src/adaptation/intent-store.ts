/**
 * P7.5b — Append-only IntentStore backed by JSONL.
 *
 * One JSON object per line.  No update-in-place.  No delete.  No compaction.
 * Corrupt lines are skipped with a warning — the store doesn't crash on
 * bad data.
 *
 * Same pattern as OutcomeStore (P7a).
 *
 * @module
 */

import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExecutionIntent, IntentStatus } from "./execution-intent-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OUTFILE = "intents.jsonl";

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
// IntentStore
// ---------------------------------------------------------------------------

export class IntentStore {
  constructor(private readonly storeDir: string) {}

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Append an execution intent to the store.
   *
   * Generates an ID if the record doesn't already have one (format:
   * `intent:YYYY-MM-DD-<random>`).  Sets `generatedAt` to the current
   * timestamp if not already provided.
   *
   * Append is always additive — even when a record with the same `id`
   * already exists, a new line is written.  Callers own deduplication.
   */
  async append(intent: ExecutionIntent): Promise<void> {
    this.ensureStoreDir();

    if (!intent.id) {
      intent.id = `intent:${dateKey()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    if (!intent.generatedAt) {
      intent.generatedAt = now();
    }

    await appendFile(this.filePath(), JSON.stringify(intent) + "\n", "utf-8");
  }

  // -------------------------------------------------------------------------
  // Read — single
  // -------------------------------------------------------------------------

  /**
   * Return the first intent matching the given ID, or `null`.
   */
  async get(id: string): Promise<ExecutionIntent | null> {
    const records = await this.list();
    return records.find((r) => r.id === id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Read — bulk
  // -------------------------------------------------------------------------

  /**
   * Return every intent in the store.
   *
   * Missing file is treated as an empty store.  Corrupt lines are skipped
   * with a console warning.
   */
  async list(): Promise<ExecutionIntent[]> {
    if (!existsSync(this.filePath())) {
      return [];
    }
    return this.readAll();
  }

  /**
   * Return all intents whose `status` matches the given value.
   */
  async queryByStatus(status: IntentStatus): Promise<ExecutionIntent[]> {
    const all = await this.list();
    return all.filter((r) => r.status === status);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private filePath(): string {
    return join(this.storeDir, OUTFILE);
  }

  private ensureStoreDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true, mode: 0o755 });
    }
  }

  private async readAll(): Promise<ExecutionIntent[]> {
    const raw = await readFile(this.filePath(), "utf-8");
    const records: ExecutionIntent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed) as ExecutionIntent);
      } catch {
        console.warn(
          `IntentStore: skipping corrupt line: ${trimmed.slice(0, 80)}...`,
        );
      }
    }
    return records;
  }
}
