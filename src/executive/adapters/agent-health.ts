/**
 * P10.0 — Agent Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the agents subsystem by sampling
 * the latest CapabilityEvolutionReport (P5.5). Each capability in the
 * report carries an `agentCount` and a `keepRate` / `revertRate` pair;
 * we surface the share of capabilities with non-zero agent adoption
 * (a proxy for fleet coverage) and the average keep rate.
 *
 * Defensive: any failure falls back to score 0 with a clear summary,
 * so the aggregator degrades gracefully.
 *
 * @module
 */

import { join } from "node:path";
import { CapabilityEvolutionStore } from "../../adaptation/capability-evolution-store.js";

export interface AgentHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface AgentHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

export async function buildAgentHealth(opts: AgentHealthOptions): Promise<AgentHealthReport> {
  try {
    const store = new CapabilityEvolutionStore(
      join(opts.cwd, ".alix", "capability-evolution"),
    );
    const report = await store.loadLatest();
    if (!report) {
      return { score: 100, summary: "no agent capability reports", topIssues: [] };
    }
    const healths = report.healthAnalysis ?? [];
    if (healths.length === 0) {
      return { score: 100, summary: "no capability health entries", topIssues: [] };
    }
    const adopted = healths.filter((h) => (h.agentCount ?? 0) > 0).length;
    const coverage = adopted / healths.length;
    const keeps = healths
      .map((h) => h.keepRate)
      .filter((k): k is number => typeof k === "number" && Number.isFinite(k));
    const avgKeep =
      keeps.length === 0
        ? 1
        : keeps.reduce((a, b) => a + b, 0) / keeps.length;
    // Weight: 60% coverage, 40% average keep rate.
    const score = clampScore(coverage * 60 + avgKeep * 40);
    const issues: string[] = [];
    if (coverage < 0.5) issues.push("low capability adoption");
    if (avgKeep < 0.6) issues.push("low average keep rate");
    return {
      score,
      summary: `${adopted}/${healths.length} capabilities adopted, keep ${Math.round(avgKeep * 100)}%`,
      topIssues: issues,
    };
  } catch {
    return {
      score: 0,
      summary: "agent health builder failed",
      topIssues: ["agent health builder failed"],
    };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}