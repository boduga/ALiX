/**
 * P10.5b — Executive outcomes CLI handler.
 * Handles `alix executive outcomes list [--json]` and
 * `alix executive outcomes show <reportId> [--json]`.
 * @module
 */

import { join } from "node:path";
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";

const OUTCOMES_DIR = join(".alix", "executive", "outcomes");

export async function handleOutcomesCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const store = new OutcomeReportStore(join(process.cwd(), OUTCOMES_DIR));

  switch (subcommand) {
    case "list":
      return handleList(store, rest);
    case "show":
      return handleShow(store, rest);
    default:
      console.error(`Unknown outcomes subcommand: ${subcommand ?? "(none)"}`);
      console.error("Available: list, show");
      process.exit(1);
  }
}

function handleList(store: OutcomeReportStore, args: string[]): void {
  const jsonMode = args.includes("--json");
  const reports = store.list();

  if (jsonMode) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  if (reports.length === 0) {
    console.log("No outcome reports found.");
    return;
  }

  const header = "Report ID".padEnd(48) + "| Plan ID".padEnd(14) + "| Eval Status".padEnd(20) + "| Δ".padEnd(6) + "| Generated At";
  console.log(header);
  console.log("─".repeat(header.length));
  for (const r of reports) {
    const deltaStr = r.overallDelta >= 0 ? `+${r.overallDelta}` : `${r.overallDelta}`;
    console.log(`${r.reportId.padEnd(48)}| ${r.planId.padEnd(12)}| ${r.evaluationStatus.padEnd(18)}| ${deltaStr.padEnd(4)}| ${r.generatedAt}`);
  }
}

function handleShow(store: OutcomeReportStore, args: string[]): void {
  const jsonMode = args.includes("--json");
  const reportId = args.find(a => !a.startsWith("--"));

  if (!reportId) {
    console.error("Usage: alix executive outcomes show <reportId> [--json]");
    process.exit(1);
  }

  const report = store.load(reportId);
  if (!report) {
    console.error(`Report not found: ${reportId}`);
    process.exit(1);
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderOutcomeReport(report);
  }
}

function renderOutcomeReport(report: ExecutiveOutcomeEvaluationReport): void {
  console.log(`Plan: ${report.planId}`);
  console.log(`Status: ${report.planStatus}`);
  console.log(`Evaluation: ${report.evaluationStatus}`);
  console.log(`Baseline: ${report.baselineGeneratedAt ?? "—"}`);
  console.log(`Current: ${report.currentGeneratedAt ?? "—"}`);
  console.log("");

  if (report.evaluationStatus !== "completed") {
    for (const w of report.warnings) console.log(`  Warning: ${w}`);
    return;
  }

  const header = "Objective".padEnd(24) + "| Type".padEnd(16) + "| Subsystem".padEnd(14) + "| Before".padEnd(8) + "| After".padEnd(7) + "| Δ".padEnd(5) + "| Outcome";
  console.log(header);
  console.log("─".repeat(header.length));
  for (const obj of report.objectives) {
    for (let i = 0; i < obj.subsystemDeltas.length; i++) {
      const d = obj.subsystemDeltas[i];
      const label = i === 0 ? obj.objectiveId.slice(0, 23) : "";
      const typeLabel = i === 0 ? obj.objectiveType.slice(0, 14) : "";
      const deltaStr = d.delta >= 0 ? `+${d.delta}` : `${d.delta}`;
      console.log(`${label.padEnd(24)}| ${typeLabel.padEnd(14)}| ${d.subsystem.padEnd(12)}| ${String(d.baselineScore).padEnd(6)}| ${String(d.currentScore).padEnd(5)}| ${deltaStr.padEnd(3)}| ${obj.outcome}`);
    }
  }
  console.log("");
  console.log(`Overall Δ: ${report.overallDelta >= 0 ? "+" : ""}${report.overallDelta} (${report.objectives.length} objectives, ${report.evaluatedSubsystems.length} subsystems evaluated)`);
}
