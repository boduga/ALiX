/**
 * P10.0 — Adaptation Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the adaptation subsystem by
 * sampling the latest CapabilityEvolutionReport (P5.5). The report
 * carries a lifecycle distribution across emerging / active / mature /
 * stagnant / declining / deprecated — a high share of `active`+`mature`
 * indicates a healthy adaptation layer. We also factor in the share of
 * capabilities with high `driftMagnitude` (signals that the capability
 * model is straining the current proposal flow).
 *
 * Defensive: any failure falls back to score 0 with a clear summary,
 * so the aggregator degrades gracefully.
 *
 * @module
 */

import { join } from "node:path";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";

export interface AdaptationHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface AdaptationHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildAdaptationHealth(opts: AdaptationHealthOptions): Promise<AdaptationHealthReport> {
  try {
    const store = new CapabilityEvolutionStore(
      join(opts.cwd, ".alix", "capability-evolution"),
    );
    const report = await store.loadLatest();
    if (!report) {
      return { score: 100, summary: "no adaptation reports", topIssues: [] };
    }
    const dist = report.lifecycleDistribution ?? {};
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    if (total === 0) {
      return { score: 100, summary: "no capability lifecycle data", topIssues: [] };
    }
    const healthyShare = (dist.active ?? 0) + (dist.mature ?? 0);
    const healthyRatio = healthyShare / total;
    const drift = report.driftAnalysis ?? [];
    const splitCandidates = drift.filter((d) => d.splitCandidate).length;
    const gaps = report.gapAnalysis ?? [];
    // Penalise: 1 split candidate = -5, 1 gap = -2 (capped at 40).
    const driftPenalty = Math.min(40, splitCandidates * 5 + gaps.length * 2);
    const score = clampScore(healthyRatio * 100 - driftPenalty);
    const issues: string[] = [];
    if (healthyRatio < 0.4) issues.push("low share of active/mature capabilities");
    if (splitCandidates > 0) issues.push(`${splitCandidates} split-candidate drift(s)`);
    return {
      score,
      summary: `${healthyShare}/${total} active+mature, ${drift.length} drift entries`,
      topIssues: issues,
    };
  } catch {
    return {
      score: 0,
      summary: "adaptation health builder failed",
      topIssues: ["adaptation health builder failed"],
    };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}