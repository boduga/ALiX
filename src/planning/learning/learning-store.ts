/**
 * P8.0b — Append-only LearningStore backed by JSONL.
 *
 * Stores LearningSignal, CalibrationProfile, and LearningReport artifacts
 * in separate JSONL files. Append-only — no update, delete, clear, or truncate.
 *
 * Core invariant: Learning ≠ Mutation. The store is write-only for learning
 * artifacts; it cannot import appliers, proposal stores, or mutation paths.
 *
 * @module
 */

import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CalibrationProfile, LearningReport, LearningSignal } from "./learning-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNALS_FILE = "signals.jsonl";
const PROFILES_FILE = "profiles.jsonl";
const REPORTS_FILE = "reports.jsonl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function shortId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}:${rand}`;
}

/** Filter JSONL lines, skipping corrupt entries. */
function parseLines(raw: string): unknown[] {
  const results: unknown[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // skip corrupt lines — store doesn't crash on bad data
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// LearningStore
// ---------------------------------------------------------------------------

export class LearningStore {
  constructor(private readonly storeDir: string) {}

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private ensureStoreDir(): void {
    if (!existsSync(this.storeDir)) {
      mkdirSync(this.storeDir, { recursive: true });
    }
  }

  private filePath(name: string): string {
    return join(this.storeDir, name);
  }

  // ---------------------------------------------------------------------------
  // Append
  // ---------------------------------------------------------------------------

  /**
   * Append a learning signal. Generates an ID if not provided.
   */
  async appendSignal(signal: LearningSignal): Promise<LearningSignal> {
    this.ensureStoreDir();
    const record = { ...signal };
    if (!record.id) record.id = shortId("ls");
    if (!record.generatedAt) record.generatedAt = now();
    const line = JSON.stringify(record) + "\n";
    await appendFile(this.filePath(SIGNALS_FILE), line, "utf-8");
    return record;
  }

  /**
   * Append a calibration profile. Generates an ID if not provided.
   */
  async appendProfile(profile: CalibrationProfile): Promise<CalibrationProfile> {
    this.ensureStoreDir();
    const record = { ...profile };
    if (!record.id) record.id = shortId("cp");
    if (!record.generatedAt) record.generatedAt = now();
    const line = JSON.stringify(record) + "\n";
    await appendFile(this.filePath(PROFILES_FILE), line, "utf-8");
    return record;
  }

  /**
   * Append a learning report. Generates an ID if not provided.
   */
  async appendReport(report: LearningReport): Promise<LearningReport> {
    this.ensureStoreDir();
    const record = { ...report };
    if (!record.id) record.id = shortId("lr");
    if (!record.generatedAt) record.generatedAt = now();
    const line = JSON.stringify(record) + "\n";
    await appendFile(this.filePath(REPORTS_FILE), line, "utf-8");
    return record;
  }

  // ---------------------------------------------------------------------------
  // Query — signals
  // ---------------------------------------------------------------------------

  /**
   * Query learning signals, optionally filtered by type and time window.
   */
  async querySignals(opts?: {
    signalTypes?: string[];
    windowDays?: number;
    limit?: number;
    /** Override the wall-clock "now" used by the window filter. Tests with
     * fixed historical fixtures otherwise silently miss every record as the
     * real clock drifts past the test's "now". Defaults to `Date.now()`. */
    now?: string;
  }): Promise<LearningSignal[]> {
    const raw = await this.readFile(SIGNALS_FILE);
    if (!raw) return [];
    const refMs = opts?.now ? Date.parse(opts.now) : Date.now();
    const cutoff = opts?.windowDays
      ? refMs - opts.windowDays * 86_400_000
      : 0;
    const typeSet = opts?.signalTypes
      ? new Set(opts.signalTypes)
      : null;

    const all = parseLines(raw).filter((r): r is LearningSignal => {
      const s = r as LearningSignal;
      if (!s.generatedAt) return false;
      if (typeSet && !typeSet.has(s.signalType)) return false;
      if (cutoff && new Date(s.generatedAt).getTime() < cutoff) return false;
      return true;
    });

    // Sort most recent first
    all.sort(
      (a, b) =>
        new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );

    return opts?.limit ? all.slice(0, opts.limit) : all;
  }

  /**
   * Query calibration profiles, optionally filtered by target and time window.
   */
  async queryProfiles(opts?: {
    targets?: string[];
    windowDays?: number;
    /** Override the wall-clock "now" used by the window filter. See
     * `querySignals` for the determinism rationale. */
    now?: string;
  }): Promise<CalibrationProfile[]> {
    const raw = await this.readFile(PROFILES_FILE);
    if (!raw) return [];
    const refMs = opts?.now ? Date.parse(opts.now) : Date.now();
    const cutoff = opts?.windowDays
      ? refMs - opts.windowDays * 86_400_000
      : 0;
    const targetSet = opts?.targets
      ? new Set(opts.targets)
      : null;

    const all = parseLines(raw).filter((r): r is CalibrationProfile => {
      const p = r as CalibrationProfile;
      if (!p.generatedAt) return false;
      if (targetSet && !targetSet.has(p.target)) return false;
      if (cutoff && new Date(p.generatedAt).getTime() < cutoff) return false;
      return true;
    });

    all.sort(
      (a, b) =>
        new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
    );

    return all;
  }

  // ---------------------------------------------------------------------------
  // Internal — read
  // ---------------------------------------------------------------------------

  private async readFile(name: string): Promise<string | null> {
    const path = this.filePath(name);
    if (!existsSync(path)) return null;
    try {
      return await readFile(path, "utf-8");
    } catch {
      return null;
    }
  }
}
