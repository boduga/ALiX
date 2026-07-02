// src/reasoning/root-cause-store.ts
//
// P11.2 — Append-only JSONL persistence store for RootCauseAnalysis results.
//
// Follows the same JSONL append-only pattern as ExecutiveTrendStore.
// Stored at `<dir>/root-causes.jsonl`, one RootCauseAnalysis JSON object per line.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RootCauseAnalysis, AnalysisStatus } from "./reasoning-types.js";
import { RootCauseAnalysisError } from "./reasoning-types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RootCauseAnalysisMeta {
  analysisId: string;
  status: AnalysisStatus;
  generatedAt: string;
  findings: number; // count of findings
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const ROOT_CAUSES_FILE = "root-causes.jsonl";

function validateAnalysis(raw: unknown): RootCauseAnalysis {
  const obj = raw as Record<string, unknown>;

  if (typeof obj !== "object" || obj === null) {
    throw new RootCauseAnalysisError("Invalid root cause analysis: expected a non-null object");
  }

  if (obj.schemaVersion !== "p11.2.0") {
    throw new RootCauseAnalysisError(
      `Invalid root cause analysis: expected schemaVersion "p11.2.0", got ${JSON.stringify(obj.schemaVersion)}`,
    );
  }

  if (!Array.isArray(obj.findings)) {
    throw new RootCauseAnalysisError(
      `Invalid root cause analysis: expected "findings" to be an array, got ${typeof obj.findings}`,
    );
  }

  return raw as RootCauseAnalysis;
}

export class RootCauseStore {
  constructor(private readonly dir: string) {}

  /**
   * Append a new RootCauseAnalysis to the JSONL store.
   * Creates the directory if it does not exist.
   */
  async save(analysis: RootCauseAnalysis): Promise<void> {
    validateAnalysis(analysis);

    const dirPath = this.dir;
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    const path = join(dirPath, ROOT_CAUSES_FILE);
    appendFileSync(path, JSON.stringify(analysis) + "\n", "utf-8");
  }

  /**
   * Load the most recent RootCauseAnalysis from the JSONL store.
   * Returns null if the file does not exist or is empty.
   * Throws RootCauseAnalysisError if the last line contains invalid data.
   */
  async loadLatest(): Promise<RootCauseAnalysis | null> {
    const path = join(this.dir, ROOT_CAUSES_FILE);
    if (!existsSync(path)) return null;

    const content = readFileSync(path, "utf-8").trim();
    if (!content) return null;

    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;

    const lastLine = lines[lines.length - 1];
    let parsed: unknown;
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      throw new RootCauseAnalysisError("Failed to parse root cause analysis JSONL entry");
    }

    return validateAnalysis(parsed);
  }

  /**
   * Load a RootCauseAnalysis by its analysisId.
   * Scans the entire JSONL file and returns the first matching entry.
   * Returns null if not found or the file does not exist.
   * Throws RootCauseAnalysisError on invalid data for the matching line.
   */
  async loadById(id: string): Promise<RootCauseAnalysis | null> {
    const path = join(this.dir, ROOT_CAUSES_FILE);
    if (!existsSync(path)) return null;

    const content = readFileSync(path, "utf-8").trim();
    if (!content) return null;

    const lines = content.split("\n").filter((l) => l.trim());

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const obj = parsed as Record<string, unknown>;
        if (obj.analysisId !== id) continue;
        return validateAnalysis(parsed);
      } catch (e) {
        if (e instanceof RootCauseAnalysisError) throw e;
        // syntax error — skip malformed line
      }
    }

    return null;
  }

  /**
   * List all RootCauseAnalysis entries as metadata summaries.
   * Scans the entire JSONL file and extracts { analysisId, status, generatedAt, findings: count }.
   * Malformed lines are silently skipped.
   * Returns an empty array if the file does not exist or is empty.
   */
  async list(): Promise<RootCauseAnalysisMeta[]> {
    const path = join(this.dir, ROOT_CAUSES_FILE);
    if (!existsSync(path)) return [];

    const content = readFileSync(path, "utf-8").trim();
    if (!content) return [];

    const lines = content.split("\n").filter((l) => l.trim());
    const results: RootCauseAnalysisMeta[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const obj = parsed as Record<string, unknown>;
        if (obj.schemaVersion !== "p11.2.0") continue;
        if (!Array.isArray(obj.findings)) continue;

        const analysis = parsed as RootCauseAnalysis;
        results.push({
          analysisId: analysis.analysisId,
          status: analysis.status,
          generatedAt: analysis.generatedAt,
          findings: analysis.findings.length,
        });
      } catch {
        // malformed line — skip silently
      }
    }

    return results;
  }
}
