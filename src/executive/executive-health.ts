/**
 * P10.0 — Executive Intelligence Foundation.
 *
 * Pure read-only aggregation. Fans out subsystem health sources,
 * normalizes into 8 scores, sorts worst-first. Mirrors P9.5's
 * Governance Dashboard aggregator pattern higher level.
 *
 * @module
 */

import { buildGovernanceHealth } from "../governance/governance-health-builder.js";
import { buildGovernanceAssessment } from "../governance/governance-assessment.js";
import { buildDashboardReport } from "../learning/learning-dashboard.js";
import { buildAgentHealth } from "./adapters/agent-health.js";
import { buildToolHealth } from "./adapters/tool-health.js";
import { buildWorkflowHealth } from "./adapters/workflow-health.js";
import { buildMemoryHealth } from "./adapters/memory-health.js";
import { buildSecurityHealth } from "./adapters/security-health.js";
import { buildAdaptationHealth } from "./adapters/adaptation-health.js";
import type { GovernanceHealthReport } from "../governance/governance-types.js";
import type { GovernanceAssessment } from "../governance/governance-types.js";
import type { DashboardReport } from "../learning/learning-dashboard.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExecutiveSubsystemName =
  | "governance"
  | "learning"
  | "adaptation"
  | "agents"
  | "tools"
  | "workflow"
  | "memory"
  | "security";

export type ExecutiveStatus = "healthy" | "warning" | "critical";

export interface ExecutiveSubsystemHealth {
  /** Subsystem identifier. */
  subsystem: ExecutiveSubsystemName;
  /** Integer 0-100, higher is better. */
  score: number;
  /** One-sentence human-readable summary of the current health state. */
  summary: string;
  /** Health status derived from score. */
  status: ExecutiveStatus;
  /** Top issues to surface to the executive. */
  topIssues: string[];
}

export interface ExecutiveDashboardOptions {
  /** Working directory for the alix project root. */
  cwd: string;
  /** Rolling window in days for all health sources. */
  windowDays: number;
  /** Optional override for `generatedAt` (for deterministic tests). */
  generatedAt?: string;
}

export interface ExecutiveHealthReport {
  schemaVersion: "p10.0.0";
  generatedAt: string;
  windowDays: number;
  /** Unweighted mean subsystem scores, rounded integer. */
  overallScore: number;
  /** Worst-first sorted, 8 entries. */
  rankedSubsystems: ExecutiveSubsystemHealth[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 90;
const STATUS_BOUNDARY_CRITICAL = 60;
const STATUS_BOUNDARY_WARNING = 80;

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

/**
 * Build ExecutiveHealthReport. Pure read-only. Only public
 * runtime export of the module. Fans out 9 health sources in parallel
 * (governance uses 2; learning uses 1; 6 Tier-2 adapters) normalizes
 * into 8 subsystem scores, sorted worst-first.
 */
export async function buildExecutiveHealthReport(
  opts: ExecutiveDashboardOptions,
): Promise<ExecutiveHealthReport> {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;

  // ---- 1. Fan out all health sources in parallel --------------------
  // NOTE: buildGovernanceAssessment is intentionally NOT fanned out here.
  // It needs the real govHealth (from buildGovernanceHealth) to produce a
  // meaningful assessment, so we run it sequentially after the batch.
  const [govHealth, learnReport, adaptation, agents, tools, workflow, memory, security] =
    await Promise.all([
      buildGovernanceHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildDashboardReport({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildAdaptationHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildAgentHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildToolHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildWorkflowHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildMemoryHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
      buildSecurityHealth({ cwd: opts.cwd, windowDays, generatedAt }).catch(() => null),
    ]);

  // ---- 2. Compute governance assessment from real govHealth ---------
  let govAssessment: GovernanceAssessment | null = null;
  if (govHealth) {
    try {
      govAssessment = buildGovernanceAssessment(govHealth);
    } catch {
      govAssessment = null;
    }
  }

  // ---- 3. Build the 8 subsystem entries -----------------------------
  const subsystems: ExecutiveSubsystemHealth[] = [
    buildGovernanceEntry(govHealth, govAssessment),
    buildLearningEntry(learnReport),
    buildAdapterEntry("adaptation", adaptation),
    buildAdapterEntry("agents", agents),
    buildAdapterEntry("tools", tools),
    buildAdapterEntry("workflow", workflow),
    buildAdapterEntry("memory", memory),
    buildAdapterEntry("security", security),
  ];

  // ---- 3. Sort worst-first (ascending) -------------------------------
  subsystems.sort((a, b) => a.score - b.score);

  // ---- 4. Compute overall score (unweighted mean) -------------------
  const overallScore = Math.round(
    subsystems.reduce((sum, s) => sum + s.score, 0) / subsystems.length,
  );

  return {
    schemaVersion: "p10.0.0",
    generatedAt,
    windowDays,
    overallScore,
    rankedSubsystems: subsystems,
  };
}

// ---------------------------------------------------------------------------
// Score-to-status mapping
// ---------------------------------------------------------------------------

function scoreToStatus(score: number): ExecutiveStatus {
  if (score < STATUS_BOUNDARY_CRITICAL) return "critical";
  if (score < STATUS_BOUNDARY_WARNING) return "warning";
  return "healthy";
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Subsystem entry builders
// ---------------------------------------------------------------------------

function buildGovernanceEntry(
  health: GovernanceHealthReport | null,
  assessment: GovernanceAssessment | null,
): ExecutiveSubsystemHealth {
  if (!health && !assessment) {
    return {
      subsystem: "governance",
      score: 0,
      status: "critical",
      summary: "governance unavailable",
      topIssues: ["health and assessment both failed"],
    };
  }
  // Prefer assessment.governanceConfidence (0..1, multiply 100).
  // Fallback: scale sourceMetrics.dashboardIntegrityScore (0..100).
  const score = assessment
    ? clampScore(assessment.governanceConfidence * 100)
    : clampScore(health?.sourceMetrics.dashboardIntegrityScore ?? 0);
  const topIssues: string[] = [];
  if (assessment && assessment.unresolvedGovernanceIssues > 0) {
    topIssues.push(`${assessment.unresolvedGovernanceIssues} unresolved governance issues`);
  }
  return {
    subsystem: "governance",
    score,
    status: scoreToStatus(score),
    summary: `governance confidence ${(score).toFixed(0)}`,
    topIssues,
  };
}

function buildLearningEntry(
  report: DashboardReport | null,
): ExecutiveSubsystemHealth {
  if (!report) {
    return {
      subsystem: "learning",
      score: 0,
      status: "critical",
      summary: "learning unavailable",
      topIssues: ["learning dashboard report failed"],
    };
  }
  const score = clampScore(report.dashboardIntegrityScore);
  return {
    subsystem: "learning",
    score,
    status: scoreToStatus(score),
    summary: `dashboard integrity ${score}`,
    topIssues: [],
  };
}

function buildAdapterEntry(
  subsystem: ExecutiveSubsystemName,
  report: { score: number; summary: string; topIssues: string[] } | null,
): ExecutiveSubsystemHealth {
  if (!report) {
    return {
      subsystem,
      score: 0,
      status: "critical",
      summary: `${subsystem} unavailable`,
      topIssues: [`${subsystem} health builder failed`],
    };
  }
  const score = clampScore(report.score);
  return {
    subsystem,
    score,
    status: scoreToStatus(score),
    summary: report.summary,
    topIssues: report.topIssues,
  };
}
