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

export interface ExecutiveSubsystemHealth {
  name: ExecutiveSubsystemName;
  /** Integer 0-100, higher is better. */
  score: number;
  /** One-sentence human-readable summary of the current health state. */
  summary: string;
}

export interface ExecutiveDashboardOptions {
  windowDays: number;
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
