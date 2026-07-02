/**
 * P11.2 — Executive reason CLI handler.
 *
 * Handles `alix executive reason [--json] [--latest]`.
 * Runs the ReasoningEngine to produce a root cause analysis and displays
 * a summary or full JSON output. The `--latest` flag loads the last saved
 * analysis without re-running.
 *
 * @module
 */

import { join } from "node:path";
import { CorrelationGraphStore } from "../../correlation/correlation-graph-store.js";
import { ReasoningEngine } from "../../reasoning/reasoning-engine.js";
import { RootCauseStore } from "../../reasoning/root-cause-store.js";
import { DEFAULT_REASONING_CONFIG } from "../../reasoning/reasoning-config.js";
import type { RootCauseAnalysis } from "../../reasoning/reasoning-types.js";
import { RootCauseAnalysisError } from "../../reasoning/reasoning-types.js";

export async function handleReasonCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const correlationDir = join(cwd, ".alix", "correlation");
  const reasoningDir = join(cwd, ".alix", "reasoning");
  const isJson = args.includes("--json");
  const isLatest = args.includes("--latest");

  try {
    if (isLatest) {
      const store = new RootCauseStore(reasoningDir);
      const analysis = await store.loadLatest();
      if (!analysis) { console.log("No saved root cause analysis found."); return; }
      printSummary(analysis, isJson);
      return;
    }

    const graphStore = new CorrelationGraphStore(correlationDir);
    const rootCauseStore = new RootCauseStore(reasoningDir);
    const engine = new ReasoningEngine(graphStore, rootCauseStore, DEFAULT_REASONING_CONFIG);
    const analysis = await engine.run();
    printSummary(analysis, isJson);
  } catch (err: unknown) {
    if (err instanceof RootCauseAnalysisError) {
      console.error(`Root cause analysis error: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Reasoning engine error: ${err.message}`);
    } else {
      console.error("Unknown reasoning error");
    }
    process.exit(1);
  }
}

function printSummary(analysis: RootCauseAnalysis, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }
  console.log(`Root Cause Analysis`);
  console.log(`Status: ${analysis.status}`);
  console.log(`Generated: ${analysis.generatedAt}`);
  console.log(`Findings: ${analysis.findings.length} degraded subsystems`);

  if (analysis.findings.length > 0) {
    console.log();
    // Table header
    console.log(`${"subsystem".padEnd(12)} ${"score".padEnd(6)} ${"top cause".padEnd(16)} ${"confidence".padEnd(12)} ${"mechanism"}`);
    console.log(`${"".padEnd(12, "-")} ${"".padEnd(6, "-")} ${"".padEnd(16, "-")} ${"".padEnd(12, "-")} ${"".padEnd(20, "-")}`);
    for (const f of analysis.findings) {
      const top = f.likelyCauses[0];
      const cause = top?.causeSubsystem ?? "(none)";
      const conf = top ? `${(top.confidence * 100).toFixed(0)}%` : "-";
      const mech = top?.mechanism ?? "-";
      console.log(`${f.primarySubsystem.padEnd(12)} ${String(f.currentScore).padEnd(6)} ${cause.padEnd(16)} ${conf.padEnd(12)} ${mech}`);
    }
  }

  if (analysis.status === "insufficient_history" || analysis.status === "insufficient_edges" || analysis.status === "stale") {
    console.log(`\nNote: Analysis status is "${analysis.status}". Run 'alix executive correlate' to produce a fresh correlation graph.`);
  }
}
