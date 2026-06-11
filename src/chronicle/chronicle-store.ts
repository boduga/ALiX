/**
 * chronicle-store.ts — Structured case memory store for SignalFrame outcomes.
 *
 * Records what happened, what was diagnosed, what offering was prescribed,
 * and what actually occurred.  Follows the same storage pattern as
 * {@link ReplayStatusIndex}.
 *
 * Storage Layout:
 *   .alix/chronicle/index.json           — array of entry summaries
 *   .alix/chronicle/entries/<entryId>.json — full ChronicleEntry
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SignalDomain, SignalPolarity } from "../runtime/signal-frame.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ChronicleOutcome = "success" | "failure" | "partial" | "unknown";

export type ChronicleEntry = {
  entryId: string;
  signalCode: string;
  domain: SignalDomain;
  polarity: SignalPolarity;
  problem: string;
  diagnosis: string;
  actionTaken: string;
  outcome: ChronicleOutcome;
  lesson: string;
  taboosObserved: string[];
  offeringsUsed: string[];
  traceRefs: string[];
  replayRefs: string[];
  rollbackRefs: string[];
  createdAt: string;
};

/** The subset of entry fields held in the index file for fast searching. */
type ChronicleIndexEntry = {
  entryId: string;
  domain: SignalDomain;
  polarity: SignalPolarity;
  outcome: ChronicleOutcome;
  createdAt: string;
  problem: string;
  actionTaken: string;
  lesson: string;
};

/* ------------------------------------------------------------------ */
/*  Store                                                              */
/* ------------------------------------------------------------------ */

export class ChronicleStore {
  constructor(private rootDir: string) {}

  private chronicleDir(): string {
    return join(this.rootDir, ".alix", "chronicle");
  }

  private indexFile(): string {
    return join(this.chronicleDir(), "index.json");
  }

  private entryFile(entryId: string): string {
    return join(this.chronicleDir(), "entries", `${entryId}.json`);
  }

  /**
   * Append a new entry.  `entryId` and `createdAt` are auto-generated.
   * Stores the full entry in entries/<entryId>.json.
   * Appends a summary entry to index.json.
   * Returns the complete ChronicleEntry.
   */
  async append(
    entry: Omit<ChronicleEntry, "entryId" | "createdAt">,
  ): Promise<ChronicleEntry> {
    const entryId = randomUUID();
    const createdAt = new Date().toISOString();

    const full: ChronicleEntry = { ...entry, entryId, createdAt };

    // Ensure the entries subdirectory exists
    const dir = this.chronicleDir();
    const entriesDir = join(dir, "entries");
    mkdirSync(dir, { recursive: true });
    mkdirSync(entriesDir, { recursive: true });

    // Write the full entry
    writeFileSync(this.entryFile(entryId), JSON.stringify(full, null, 2), "utf-8");

    // Update the index
    const index = await this.loadIndex();
    index.push({
      entryId,
      domain: entry.domain,
      polarity: entry.polarity,
      outcome: entry.outcome,
      createdAt,
      problem: entry.problem,
      actionTaken: entry.actionTaken,
      lesson: entry.lesson,
    });
    writeFileSync(this.indexFile(), JSON.stringify(index, null, 2), "utf-8");

    return full;
  }

  /**
   * Retrieve a full entry by ID.  Returns undefined if not found.
   */
  async get(entryId: string): Promise<ChronicleEntry | undefined> {
    const path = this.entryFile(entryId);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ChronicleEntry;
    } catch {
      return undefined;
    }
  }

  /**
   * Search entries by matching criteria.  Returns index entries that match
   * ALL provided filters (AND logic).  Each filter is optional.
   */
  async search(query: {
    signalCode?: string;
    domain?: SignalDomain;
    polarity?: SignalPolarity;
    outcome?: ChronicleOutcome;
  }): Promise<ChronicleEntry[]> {
    const index = await this.loadIndex();

    const filtered = index.filter((ix) => {
      if (query.domain !== undefined && ix.domain !== query.domain) return false;
      if (query.polarity !== undefined && ix.polarity !== query.polarity) return false;
      if (query.outcome !== undefined && ix.outcome !== query.outcome) return false;
      return true;
    });

    const results: ChronicleEntry[] = [];

    for (const ix of filtered) {
      const full = await this.get(ix.entryId);
      if (full === undefined) continue; // skip missing entry files

      // signalCode is only in the full entry, so apply that filter here
      if (query.signalCode !== undefined && full.signalCode !== query.signalCode) continue;

      results.push(full);
    }

    return results;
  }

  /**
   * Load the index array from disk.  Returns an empty array if the file
   * does not exist or fails to parse.
   */
  private async loadIndex(): Promise<ChronicleIndexEntry[]> {
    const path = this.indexFile();
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as ChronicleIndexEntry[];
    } catch {
      return [];
    }
  }
}
