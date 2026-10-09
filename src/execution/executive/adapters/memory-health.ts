/**
 * P10.0 — Memory Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the memory subsystem by inspecting
 * the `.alix/memory/` directory (kernel/memory util layer). Missing
 * directory is healthy (no signals to report). Present directory with
 * files is healthy (substrate exists). An exception indicates the
 * store is broken — surface as critical.
 *
 * Defensive: any failure falls back to score 0 with a clear summary,
 * so the aggregator degrades gracefully.
 *
 * @module
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface MemoryHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface MemoryHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildMemoryHealth(opts: MemoryHealthOptions): Promise<MemoryHealthReport> {
  try {
    const memDir = join(opts.cwd, ".alix", "memory");
    if (!existsSync(memDir)) {
      return { score: 100, summary: "no memory store", topIssues: [] };
    }
    const files = readdirSync(memDir);
    return {
      score: 100,
      summary: files.length === 0 ? "empty memory store" : `${files.length} memory file(s)`,
      topIssues: [],
    };
  } catch {
    return {
      score: 0,
      summary: "memory health builder failed",
      topIssues: ["memory health builder failed"],
    };
  }
}