/**
 * P11.3 — Executive strategic-plan CLI handler.
 *
 * Handles `alix executive strategic-plan [--json] [--latest]`.
 * Runs the PlanningEngine to produce a StrategicPlan and displays
 * a summary or full JSON output. The `--latest` flag loads the last saved
 * plan without re-running.
 *
 * @module
 */

import { join } from "node:path";
import { RootCauseStore } from "../../reasoning/root-cause-store.js";
import { StrategicPlanStore } from "../../planning/strategic-plan-store.js";
import { PlanningEngine } from "../../planning/planning-engine.js";
import { DEFAULT_PLANNING_CONFIG } from "../../planning/planning-config.js";
import type { StrategicPlan } from "../../planning/planning-types.js";
import { PlanningEngineError } from "../../planning/planning-types.js";

export async function handleStrategicPlanCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const reasoningDir = join(cwd, ".alix", "reasoning");
  const planningDir = join(cwd, ".alix", "planning");
  const isJson = args.includes("--json");
  const isLatest = args.includes("--latest");

  try {
    if (isLatest) {
      const store = new StrategicPlanStore(planningDir);
      const plan = await store.loadLatest();
      if (!plan) { console.log("No saved strategic plan found."); return; }
      printSummary(plan, isJson);
      return;
    }

    const rootCauseStore = new RootCauseStore(reasoningDir);
    const strategicPlanStore = new StrategicPlanStore(planningDir);
    const engine = new PlanningEngine(rootCauseStore, strategicPlanStore, DEFAULT_PLANNING_CONFIG);
    const plan = await engine.run();
    printSummary(plan, isJson);
  } catch (err: unknown) {
    if (err instanceof PlanningEngineError) {
      console.error(`Planning engine error: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Strategic planning error: ${err.message}`);
    } else {
      console.error("Unknown strategic planning error");
    }
    process.exit(1);
  }
}

function printSummary(plan: StrategicPlan, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  console.log(`Strategic Plan`);
  console.log(`Status: ${plan.status}`);
  console.log(`Generated: ${plan.generatedAt}`);
  console.log(`Root cause analysis: ${plan.rootCauseAnalysisId}`);
  console.log(`Objectives: ${plan.objectives.length} prioritized`);

  if (plan.objectives.length > 0) {
    console.log();
    // Table header
    console.log(`${"#".padEnd(3)} ${"subsystem".padEnd(12)} ${"urgency".padEnd(8)} ${"effort".padEnd(8)} ${"impact".padEnd(10)} ${"top cause".padEnd(16)}`);
    console.log(`${"".padEnd(3, "-")} ${"".padEnd(12, "-")} ${"".padEnd(8, "-")} ${"".padEnd(8, "-")} ${"".padEnd(10, "-")} ${"".padEnd(16, "-")}`);
    for (let i = 0; i < plan.objectives.length; i++) {
      const o = plan.objectives[i];
      const cause = o.topCauseSubsystem ?? "(none)";
      console.log(`${String(i + 1).padEnd(3)} ${o.targetSubsystem.padEnd(12)} ${String(o.urgencyScore).padEnd(8)} ${o.estimatedEffort.padEnd(8)} ${o.expectedImpact.padEnd(10)} ${cause.padEnd(16)}`);
    }
  }

  if (plan.status === "insufficient_analysis") {
    console.log(`\nNote: Insufficient analysis data. Run 'alix executive reason' to produce a fresh root cause analysis.`);
  } else if (plan.status === "no_objectives") {
    console.log(`\nNote: No actionable objectives from current analysis.`);
  }
}
