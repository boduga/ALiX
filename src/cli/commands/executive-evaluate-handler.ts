/**
 * P10.5a — Executive evaluate CLI handler.
 *
 * Handles `alix executive evaluate <planId> [--json]`.
 * Wires PlanStore, StateStore, TrendStore together, calls pure
 * evaluatePlanOutcome, renders result as terminal table or JSON.
 *
 * All loading errors produce a structured ExecutiveOutcomeEvaluationReport
 * so that --json consumers always get machine-readable output.
 *
 * @module
 */

import { join } from "node:path";
import { PlanStore } from "../../executive/plan-store.js";
import { ExecutionStateStore } from "../../executive/execution-state-store.js";
import { ExecutiveTrendStore } from "../../executive/trend-store.js";
import { evaluatePlanOutcome } from "../../executive/outcome-evaluator.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import type { PlanStatus } from "../../executive/executive-plan-types.js";

const PLANS_DIR = join(".alix", "executive", "plans");
const EXECUTIVE_DIR = join(".alix", "executive");

// ---------------------------------------------------------------------------
// Error-report builder (no plan or state could be loaded)
// ---------------------------------------------------------------------------

function errorReport(planId: string, warnings: string[]): ExecutiveOutcomeEvaluationReport {
  return {
    schemaVersion: "p10.5.0",
    generatedAt: new Date().toISOString(),
    planId,
    planStatus: "draft" as PlanStatus,
    evaluationStatus: "plan_not_found",
    evaluatedSubsystems: [],
    objectives: [],
    overallDelta: 0,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function handleEvaluate(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const planId = args.find(a => !a.startsWith("--"));

  if (!planId) {
    console.error("Usage: alix executive evaluate <planId> [--json]");
    process.exit(1);
  }

  const cwd = process.cwd();
  const plansDir = join(cwd, PLANS_DIR);
  const execDir = join(cwd, EXECUTIVE_DIR);

  // ── Load plan ─────────────────────────────────────────────────────
  let plan;
  try {
    plan = new PlanStore(plansDir).load(planId);
  } catch (e: any) {
    const msg = e.message ?? `Failed to load plan: ${planId}`;
    const report = errorReport(planId, [msg]);
    if (jsonMode) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(msg);
    }
    return;
  }

  // ── Load execution state ──────────────────────────────────────────
  const state = new ExecutionStateStore(plansDir).load(planId);
  if (!state) {
    const msg = `Execution state not found for plan: ${planId}`;
    const report = errorReport(planId, [msg]);
    if (jsonMode) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(msg);
    }
    return;
  }

  // ── Load trend snapshots ──────────────────────────────────────────
  const trendStore = new ExecutiveTrendStore(execDir);
  const [baseline, current] = await Promise.all([
    trendStore.findBaseline(plan.generatedAt),
    trendStore.loadLatest(),
  ]);

  // ── Evaluate ──────────────────────────────────────────────────────
  const report = evaluatePlanOutcome(plan, state, baseline, current);

  // ── Render ────────────────────────────────────────────────────────
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderEvaluationTable(report);
  }
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

function renderEvaluationTable(report: ExecutiveOutcomeEvaluationReport): void {
  console.log(`Plan: ${report.planId}`);
  console.log(`Status: ${report.planStatus}`);
  console.log(`Evaluation: ${report.evaluationStatus}`);
  console.log(`Baseline: ${report.baselineGeneratedAt ?? "—"}`);
  console.log(`Current: ${report.currentGeneratedAt ?? "—"}`);
  console.log("");

  if (report.evaluationStatus !== "completed") {
    for (const w of report.warnings) {
      console.log(`  Warning: ${w}`);
    }
    return;
  }

  const header =
    "Objective".padEnd(24) +
    "| Type".padEnd(16) +
    "| Subsystem".padEnd(14) +
    "| Before".padEnd(8) +
    "| After".padEnd(7) +
    "| Δ".padEnd(5) +
    "| Outcome";
  console.log(header);
  console.log("─".repeat(header.length));

  for (const obj of report.objectives) {
    for (let i = 0; i < obj.subsystemDeltas.length; i++) {
      const d = obj.subsystemDeltas[i];
      const label = i === 0 ? obj.objectiveId.slice(0, 23) : "";
      const typeLabel = i === 0 ? obj.objectiveType.slice(0, 14) : "";
      const deltaStr = d.delta >= 0 ? `+${d.delta}` : `${d.delta}`;
      console.log(
        `${label.padEnd(24)}| ${typeLabel.padEnd(14)}| ${d.subsystem.padEnd(12)}| ${String(d.baselineScore).padEnd(6)}| ${String(d.currentScore).padEnd(5)}| ${deltaStr.padEnd(3)}| ${obj.outcome}`,
      );
    }
  }

  console.log("");
  console.log(
    `Overall Δ: ${report.overallDelta >= 0 ? "+" : ""}${report.overallDelta} ` +
    `(${report.objectives.length} objectives, ` +
    `${report.evaluatedSubsystems.length} subsystems evaluated)`,
  );
}
