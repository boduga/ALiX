/**
 * P10.0 — Tool Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the tools subsystem by scanning
 * recent proposal / recommendation files in `.alix/` for high-confidence
 * secret patterns via the Sa1 `SecretDetector` (P4.3-Sa1 redaction
 * foundation).
 *
 * Defensive: any failure falls back to score 0 with a clear summary,
 * so the aggregator degrades gracefully.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SecretDetector } from "../../security/redaction/secret-detector.js";

export interface ToolHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface ToolHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

const SCAN_DIRS = ["proposals", "recommendations", "outcomes", "evidence"];
const MAX_FILES = 50;
const MAX_FILE_BYTES = 65536;

export async function buildToolHealth(opts: ToolHealthOptions): Promise<ToolHealthReport> {
  try {
    const detector = new SecretDetector();
    const alixDir = join(opts.cwd, ".alix");
    if (!existsSync(alixDir)) {
      return { score: 100, summary: "no tool artifacts", topIssues: [] };
    }
    let scanned = 0;
    let highConfidence = 0;
    let total = 0;
    for (const sub of SCAN_DIRS) {
      const dir = join(alixDir, sub);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".json") || f.endsWith(".jsonl"))
        .slice(0, MAX_FILES);
      for (const f of files) {
        try {
          const content = readFileSync(join(dir, f));
          scanned += 1;
          const slice = content.length > MAX_FILE_BYTES ? content.subarray(0, MAX_FILE_BYTES) : content;
          const spans = detector.detect(slice.toString("utf-8"));
          for (const s of spans) {
            total += 1;
            if (s.confidence === "high") highConfidence += 1;
          }
        } catch {
          // skip unreadable file
        }
      }
    }
    if (scanned === 0) {
      return { score: 100, summary: "no tool artifacts", topIssues: [] };
    }
    // Penalise by high-confidence secrets: 5 high-confidence = -50 score.
    const penalty = Math.min(100, highConfidence * 10);
    const score = clampScore(100 - penalty);
    const issues: string[] = [];
    if (highConfidence > 0) issues.push(`${highConfidence} high-confidence secret span(s)`);
    return {
      score,
      summary:
        total === 0
          ? `${scanned} file(s) scanned, no findings`
          : `${scanned} file(s) scanned, ${total} span(s) (${highConfidence} high)`,
      topIssues: issues,
    };
  } catch {
    return {
      score: 0,
      summary: "tool health builder failed",
      topIssues: ["tool health builder failed"],
    };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}