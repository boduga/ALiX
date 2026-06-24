/**
 * P10.0 — Workflow Health (Tier-2 adapter).
 *
 * Pure read. Computes 0-100 score for the workflow subsystem by running
 * the P6.6a `PipelineHealthBuilder` against a minimal synthetic input
 * populated from the `.alix/` directory's presence/absence of the
 * expected stores. The builder emits a `health` status; we map it to
 * 0-100 via healthy=100, degraded=70, attention_needed=40, then refine
 * with the report confidence.
 *
 * Defensive: any failure falls back to score 0 with a clear summary,
 * so the aggregator degrades gracefully.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PipelineHealthBuilder } from "../../adaptation/pipeline-health-builder.js";
import type { PipelineHealthStatus } from "../../adaptation/pipeline-health-types.js";

export interface WorkflowHealthReport {
  score: number;
  summary: string;
  topIssues: string[];
}

export interface WorkflowHealthOptions {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}

const STATUS_SCORE: Record<PipelineHealthStatus, number> = {
  healthy: 100,
  degraded: 70,
  attention_needed: 40,
};

export async function buildWorkflowHealth(opts: WorkflowHealthOptions): Promise<WorkflowHealthReport> {
  try {
    const alixDir = join(opts.cwd, ".alix");
    const proposalStore = existsSync(join(alixDir, "proposals"));
    const evidenceStore = existsSync(join(alixDir, "evidence"));
    const effectivenessStore = existsSync(join(alixDir, "effectiveness"));
    const intelligenceStore = existsSync(join(alixDir, "intelligence"));

    const builder = new PipelineHealthBuilder();
    const report = builder.build(
      {
        proposalCounts: {
          total: 0,
          pending: 0,
          approved: 0,
          applied: 0,
          rejected: 0,
          failed: 0,
        },
        scopedProposalInputs: [],
        effectivenessReports: 0,
        intelligenceReports: 0,
        lifecycleEvents: { total: 0, inWindow: 0 },
        strategicBrief: { available: false, confidence: null, findings: 0 },
        storeAvailability: {
          proposalStore,
          evidenceStore,
          effectivenessStore,
          intelligenceStore,
        },
      },
      {
        windowDays: opts.windowDays ?? 90,
        generatedAt: opts.generatedAt ?? new Date().toISOString(),
      },
    );

    const base = STATUS_SCORE[report.health] ?? 100;
    // Refine with confidence (0-1) when sample data exists.
    const confidence = typeof report.confidence === "number" ? report.confidence : 1;
    const refined = base * (0.7 + 0.3 * Math.max(0, Math.min(1, confidence)));
    const score = clampScore(refined);
    const issues: string[] = [];
    if (report.health !== "healthy") issues.push(`pipeline status ${report.health}`);
    return {
      score,
      summary: `pipeline ${report.health}`,
      topIssues: issues,
    };
  } catch {
    return {
      score: 0,
      summary: "workflow health builder failed",
      topIssues: ["workflow health builder failed"],
    };
  }
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}