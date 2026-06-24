/**
 * P10.0 — Security Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the security subsystem by
 * inspecting the `.alix/credentials/` directory. Missing directory is
 * healthy (no stored credentials to leak). Present directory with files
 * is healthy (substrate exists). An exception indicates the store is
 * broken — surface as critical.
 *
 * Defensive: any failure falls back to score 0 with a clear summary,
 * so the aggregator degrades gracefully.
 *
 * @module
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface SecurityHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface SecurityHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildSecurityHealth(opts: SecurityHealthOptions): Promise<SecurityHealthReport> {
  try {
    const credDir = join(opts.cwd, ".alix", "credentials");
    if (!existsSync(credDir)) {
      return { score: 100, summary: "no credentials store", topIssues: [] };
    }
    const files = readdirSync(credDir);
    return {
      score: 100,
      summary: files.length === 0 ? "empty credentials store" : `${files.length} credential file(s)`,
      topIssues: [],
    };
  } catch {
    return {
      score: 0,
      summary: "security health builder failed",
      topIssues: ["security health builder failed"],
    };
  }
}