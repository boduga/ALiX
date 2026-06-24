/**
 * P10.1 — Executive Trend Store.
 *
 * Append-only snapshot store for subsystem health scores over time.
 * TrendStore is DERIVED STATE (cache). If trends.jsonl is missing or
 * deleted, the priority engine defaults to trendScore=25 and the
 * system continues without correctness loss.
 *
 * @module
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ExecutiveHealthReport, ExecutiveSubsystemName } from "./executive-health.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ExecutiveTrendSnapshot {
  id: string;
  generatedAt: string;
  windowDays: number;
  subsystemScores: Record<ExecutiveSubsystemName, number>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const TRENDS_FILE = "trends.jsonl";

export class ExecutiveTrendStore {
  constructor(private readonly dir: string) {}

  /**
   * Load the most recent trend snapshot. Returns null if no snapshots exist
   * (first run, or trends.jsonl was deleted/recreated).
   */
  async loadLatest(): Promise<ExecutiveTrendSnapshot | null> {
    const path = join(this.dir, TRENDS_FILE);
    if (!existsSync(path)) return null;

    const content = readFileSync(path, "utf-8").trim();
    if (!content) return null;

    // JSONL: one JSON object per line. The last non-empty line is the most recent.
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;

    const lastLine = lines[lines.length - 1];
    try {
      return JSON.parse(lastLine) as ExecutiveTrendSnapshot;
    } catch {
      return null;
    }
  }

  /**
   * Append a new trend snapshot derived from the current health report.
   * The snapshot captures each subsystem's current score for future trend
   * comparisons.
   */
  async save(report: ExecutiveHealthReport): Promise<ExecutiveTrendSnapshot> {
    const dirPath = this.dir;
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    const snapshot: ExecutiveTrendSnapshot = {
      id: `exec-trend-${report.generatedAt}`,
      generatedAt: report.generatedAt,
      windowDays: report.windowDays,
      subsystemScores: {} as Record<ExecutiveSubsystemName, number>,
    };

    for (const sub of report.rankedSubsystems) {
      snapshot.subsystemScores[sub.subsystem] = sub.score;
    }

    const path = join(dirPath, TRENDS_FILE);
    appendFileSync(path, JSON.stringify(snapshot) + "\n", "utf-8");
    return snapshot;
  }
}
