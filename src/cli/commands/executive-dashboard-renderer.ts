/**
 * P10.0 — Executive Dashboard renderer.
 *
 * Pure formatter. Consumes ExecutiveHealthReport. No data access.
 * Mirrors P9.5's renderGovernanceDashboard pattern with 2 panels.
 *
 * @module
 */

import type {
  ExecutiveHealthReport,
  ExecutiveSubsystemHealth,
  ExecutiveStatus,
} from "../../executive/executive-health.js";
import type { ExecutiveObjectiveReport } from "../../executive/objective-engine.js";
import type { ExecutivePriorityReport } from "../../executive/priority-engine.js";
import type {
  ExecutionPlan,
  ExecutionStep,
} from "../../executive/planning-engine.js";
import {
  groupStepsBySubsystem,
  buildStepNumberIndex,
} from "../../executive/planning-engine.js";

export interface RenderOptions {
  jsonMode?: boolean;
}

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

const STATUS_EMOJI: Record<ExecutiveStatus, string> = {
  healthy: "🟢",
  warning: "🟡",
  critical: "🔴",
};

const STATUS_LABEL: Record<ExecutiveStatus, string> = {
  healthy: "healthy",
  warning: "warning",
  critical: "critical",
};

export function renderExecutiveDashboard(
  report: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
  objectiveReport: ExecutiveObjectiveReport,
  plan: ExecutionPlan,
  opts: RenderOptions = {},
): void {
  if (opts.jsonMode) {
    console.log(JSON.stringify({
      health: report,
      priority: priorityReport,
      objectives: objectiveReport,
      plan,
    }, null, 2));
    return;
  }

  console.log("=".repeat(78));
  console.log("EXECUTIVE DASHBOARD");
  console.log(`Schema: ${report.schemaVersion}    Generated: ${report.generatedAt}    Window: ${report.windowDays}d`);
  console.log("=".repeat(78));

  renderHealthSummary(report, priorityReport);
  console.log("");
  renderPriorities(priorityReport);
  console.log("");
  renderObjectives(objectiveReport);
  console.log("");
  renderPlan(plan);
  console.log("=".repeat(78));
}

function renderHealthSummary(
  healthReport: ExecutiveHealthReport,
  priorityReport: ExecutivePriorityReport,
): void {
  console.log("\n[0] EXECUTIVE HEALTH SUMMARY");
  console.log(`Overall Score: ${healthReport.overallScore}\n`);
  console.log("  Subsystem      Score   Trend   Blast   Pri      Status");
  console.log("  -------------  -----   -----   -----   ------   --------------");
  for (const entry of priorityReport.priorities) {
    const status = healthReport.rankedSubsystems.find(
      (s) => s.subsystem === entry.subsystem,
    )?.status ?? "unknown";
    const emoji = STATUS_EMOJI[status as ExecutiveStatus] ?? "-";
    console.log(
      `  ${pad(entry.subsystem, 13)}  ${pad(String(entry.healthScore), 5)}  ${pad(String(entry.trendScore), 5)}  ${pad(String(entry.blastRadius), 5)}  ${pad(entry.priorityScore.toFixed(1), 6)}   ${emoji} ${status}`,
    );
  }
}

function renderPriorities(priorityReport: ExecutivePriorityReport): void {
  const top3 = priorityReport.priorities.slice(0, 3);
  console.log(`\n[1] EXECUTIVE PRIORITIES (top ${top3.length})`);
  if (top3.length === 0) {
    console.log("  (none)");
    return;
  }
  top3.forEach((entry, i) => {
    console.log(`\n  ${i + 1}. ${capitalize(entry.subsystem)}`);
    console.log(`     Score: ${entry.healthScore} | Trend: ${entry.trendScore} | Blast: ${entry.blastRadius} | Pri: ${entry.priorityScore.toFixed(1)}`);
  });
}

function renderObjectives(objectiveReport: ExecutiveObjectiveReport): void {
  console.log(`\n[2] EXECUTIVE OBJECTIVES (${objectiveReport.objectives.length})`);
  if (objectiveReport.objectives.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const obj of objectiveReport.objectives) {
    const typeColor = obj.objectiveType === "stabilize" ? RED
      : obj.objectiveType === "investigate" ? YELLOW
      : obj.objectiveType === "improve" ? CYAN
      : GREEN;
    const typeIcon = obj.objectiveType === "stabilize" ? "🔴"
      : obj.objectiveType === "investigate" ? "🟡"
      : obj.objectiveType === "improve" ? "🔵"
      : "🟢";
    console.log(
      `\n  ${typeIcon} ${typeColor}${capitalize(obj.objectiveType)}${RESET}: ${obj.title}`,
    );
    console.log(`     Score: ${obj.objectiveScore} | Priority: ${obj.priorityScore} | Target: ${obj.targetSubsystems.join(", ")}`);
    if (obj.supportingInvestigations.length > 0) {
      console.log(`     Investigations: ${obj.supportingInvestigations.length} open`);
    }
  }
}

function renderPlan(plan: ExecutionPlan): void {
  console.log(`\n[3] EXECUTIVE PLAN`);
  console.log(`\n  Plan ID: ${plan.id}`);

  // Empty plan
  if (plan.steps.length === 0) {
    console.log(`  Status: ${plan.planStatus}`);
    if (plan.rationale) console.log(`  ${plan.rationale}`);
    return;
  }

  console.log(`  Plan Status: ${plan.planStatus}`);

  // Group steps by subsystem and build ID-to-stepNumber index
  const bySubsystem = groupStepsBySubsystem(plan.steps);
  const idToStepNum = buildStepNumberIndex(plan.steps);

  for (const [subsystem, steps] of bySubsystem) {
    console.log(`\n  ${capitalize(subsystem)}: (${steps.length} steps)`);
    for (const step of steps) {
      const depText = step.dependsOn.length > 0
        ? ` [blocked by ${step.dependsOn.map(d => idToStepNum.get(d)).join(", ")}]`
        : "";
      const blockerText = plan.steps.some(s =>
        s.targetSubsystem === step.targetSubsystem && s.dependsOn.includes(step.id)
      ) ? ` [blocks ${plan.steps.filter(s => s.dependsOn.includes(step.id)).map(s => s.stepNumber).join(", ")}]`
        : "";
      const annot = depText || blockerText || "";
      console.log(`    ${step.stepNumber}. ${step.title.padEnd(40)} ${pad(step.riskLevel.toUpperCase(), 6)}${annot}`);
    }
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
