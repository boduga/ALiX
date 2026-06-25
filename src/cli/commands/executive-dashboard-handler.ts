/**
 * P10.0 + P10.1 — Executive Dashboard CLI handler.
 *
 * Extracted to its own file so the dashboard sentinel can scan a precise
 * target. This handler coordinates the P10.0 health aggregator, the P10.1
 * priority engine, and the TrendStore.
 *
 * @module
 */

import { join } from "node:path";
import { buildExecutiveHealthReport } from "../../executive/executive-health.js";
import { buildPriorityReport } from "../../executive/priority-engine.js";
import { buildObjectiveReport } from "../../executive/objective-engine.js";
import { buildExecutionPlan } from "../../executive/planning-engine.js";
import { ExecutiveTrendStore } from "../../executive/trend-store.js";
import { GovernanceStore } from "../../governance/governance-store.js";
import { InvestigationStore } from "../../governance/investigation-store.js";
import { listCompatibleInvestigations } from "../../governance/investigation-compat.js";
import { renderExecutiveDashboard } from "./executive-dashboard-renderer.js";

const EXECUTIVE_DIR = join(".alix", "executive");

export async function runDashboard(args: string[]): Promise<void> {
  const jsonMode = args.includes("--json");
  const cwd = process.cwd();

  let windowDays = 90;
  const windowIdx = args.indexOf("--window");
  if (windowIdx !== -1) {
    if (windowIdx + 1 >= args.length) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    const parsed = parseInt(args[windowIdx + 1], 10);
    if (isNaN(parsed) || parsed <= 0) {
      console.error("Error: --window requires a positive integer");
      process.exit(1);
    }
    windowDays = parsed;
  }

  // P10.0: Build health report
  const healthReport = await buildExecutiveHealthReport({ cwd, windowDays });

  // P10.1: Load prior trend snapshot
  const trendStore = new ExecutiveTrendStore(join(cwd, EXECUTIVE_DIR));
  const priorSnapshot = await trendStore.loadLatest();

  // P10.1: Build priority report
  const priorityReport = buildPriorityReport(healthReport, priorSnapshot);

  // P10.1: Persist current scores as a trend snapshot for future runs
  await trendStore.save(healthReport);

  // P10.2: Load P9.6 investigations and build objective report
  const govStore = new GovernanceStore(join(cwd, ".alix", "governance"));
  const invStore = new InvestigationStore(join(cwd, ".alix", "governance"));
  const investigations = await listCompatibleInvestigations(govStore, invStore);
  const objectiveReport = buildObjectiveReport(healthReport, priorityReport, investigations);

  // P10.3: Build execution plan
  const plan = buildExecutionPlan(objectiveReport);

  // Render all 4 panels
  renderExecutiveDashboard(healthReport, priorityReport, objectiveReport, plan, { jsonMode });
}