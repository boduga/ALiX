/**
 * P10.5a + P10.9.1 — Executive evaluate CLI handler.
 *
 * Handles `alix executive evaluate <planId> [--json]`.
 * Wires PlanStore, StateStore, TrendStore together, calls pure
 * evaluatePlanOutcome, renders result as terminal table or JSON.
 *
 * P10.9.1 — Read sites + auto-current snapshot.
 *   - Baseline + current resolution goes through the plan-scoped snapshot
 *     stack (ExecutiveSnapshotStore.loadBaseline/loadCurrent →
 *     ExecutiveTrendStore.loadById via trendSnapshotId). No more
 *     time-window trend-store lookup.
 *   - Eager auto-capture of current snapshot for plans in terminal status
 *     when no current snapshot exists yet. Idempotent: subsequent calls
 *     reuse the captured current snapshot.
 *   - Fail-loud on missing baseline (insufficient_data warning includes
 *     "baseline not captured for planId=<id>"). No backfill, no
 *     fabrication.
 *   - All snapshot-store + provider operations are wrapped in try/catch
 *     (best-effort: never break the user-facing command).
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
import { OutcomeReportStore } from "../../executive/outcome-store.js";
import { ExecutiveSnapshotStore } from "../../executive/executive-snapshot-store.js";
import { createDefaultSnapshotProvider } from "../../executive/executive-snapshot-provider.js";
import type { ExecutiveTrendSnapshot } from "../../executive/trend-store.js";
import type { ExecutiveOutcomeEvaluationReport } from "../../executive/outcome-evaluator.js";
import type { PlanExecutionState, PlanStatus } from "../../executive/executive-plan-types.js";

const PLANS_DIR = join(".alix", "executive", "plans");
const EXECUTIVE_DIR = join(".alix", "executive");
const OUTCOMES_DIR = join(".alix", "executive", "outcomes");

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
// Snapshot resolution (P10.9.1)
//
// Symmetric resolution — both baseline and current go through the same path:
//   snapshotStore.loadBaseline/Current(planId)
//     → rawSubsystemState.trendSnapshotId
//     → trendStore.loadById(...)
//
// ExecutivePlanSnapshot is the durable pointer. ExecutiveTrendSnapshot is
// the evaluator payload. ExecutiveTrendStore.loadById() is the resolver.
// ---------------------------------------------------------------------------

interface ResolvedSnapshots {
  baseline: ExecutiveTrendSnapshot | null;
  current: ExecutiveTrendSnapshot | null;
  /** Set when the baseline file is missing on disk — used for the fail-loud warning. */
  baselineMissing: boolean;
}

async function resolveSnapshots(
  planId: string,
  state: PlanExecutionState | null,
  execDir: string,
): Promise<ResolvedSnapshots> {
  const snapshotsDir = join(execDir, "snapshots");
  const snapshotStore = new ExecutiveSnapshotStore(snapshotsDir);
  const provider = createDefaultSnapshotProvider(execDir);
  const trendStore = new ExecutiveTrendStore(execDir);

  let baselineSnapshot = null;
  let currentSnapshot = null;
  try {
    baselineSnapshot = await snapshotStore.loadBaseline(planId);
  } catch (e) {
    console.warn(
      `[executive-evaluate-handler] Failed to load baseline snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  try {
    currentSnapshot = await snapshotStore.loadCurrent(planId);
  } catch (e) {
    console.warn(
      `[executive-evaluate-handler] Failed to load current snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Eager auto-capture of current snapshot — invariant C from p10-9-1 plan.
  // If the plan is in terminal status AND no current snapshot exists, capture
  // and save before calling the evaluator. Idempotent: second evaluation
  // reuses the captured current snapshot.
  if (
    state &&
    (state.status === "completed" || state.status === "failed") &&
    !currentSnapshot
  ) {
    try {
      const captured = await provider.captureCurrent(planId);
      await snapshotStore.saveCurrent(captured);
      currentSnapshot = captured;
    } catch (e) {
      console.warn(
        `[executive-evaluate-handler] Failed to auto-capture current snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // Resolve trend snapshots from the captured plan-snapshot references.
  // Symmetric: baseline uses baselineSnapshot.trendSnapshotId, current uses
  // currentSnapshot.trendSnapshotId. Both resolve through trendStore.loadById.
  let baselineTrend: ExecutiveTrendSnapshot | null = null;
  let currentTrend: ExecutiveTrendSnapshot | null = null;

  if (baselineSnapshot?.rawSubsystemState.trendSnapshotId) {
    try {
      baselineTrend = await trendStore.loadById(
        baselineSnapshot.rawSubsystemState.trendSnapshotId,
      );
    } catch (e) {
      console.warn(
        `[executive-evaluate-handler] Failed to resolve baseline trend snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  if (currentSnapshot?.rawSubsystemState.trendSnapshotId) {
    try {
      currentTrend = await trendStore.loadById(
        currentSnapshot.rawSubsystemState.trendSnapshotId,
      );
    } catch (e) {
      console.warn(
        `[executive-evaluate-handler] Failed to resolve current trend snapshot for plan ${planId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  return {
    baseline: baselineTrend,
    current: currentTrend,
    baselineMissing: baselineSnapshot === null,
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

  // ── Resolve baseline + current trend snapshots via plan-scoped stack (P10.9.1)
  const resolved = await resolveSnapshots(planId, state, execDir);

  // ── Fail loud on missing baseline (invariant D)
  if (resolved.baselineMissing) {
    console.warn(
      `baseline not captured for planId=${planId} — plan was never executed by ExecutionEngine (no engine baseline snapshot found on disk). Cannot evaluate.`,
    );
  }

  // ── Evaluate ──────────────────────────────────────────────────────
  const report = evaluatePlanOutcome(plan, state, resolved.baseline, resolved.current);

  // ── Save (before render) ──────────────────────────────────────────
  const saveMode = args.includes("--save");
  let savedId: string | undefined;
  if (saveMode) {
    const outcomeStore = new OutcomeReportStore(join(cwd, OUTCOMES_DIR));
    savedId = outcomeStore.save(report);
  }

  // ── Render ────────────────────────────────────────────────────────
  if (jsonMode) {
    if (saveMode) {
      const output: Record<string, unknown> = { report };
      if (savedId) output.savedReportId = savedId;
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } else {
    renderEvaluationTable(report);
    if (savedId) console.log(`Report saved: ${savedId}`);
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
