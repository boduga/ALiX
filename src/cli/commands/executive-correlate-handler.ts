/**
 * P11.1 — Executive correlate CLI handler.
 *
 * Handles `alix executive correlate [--json] [--status]`.
 * Runs the CorrelationEngine to produce a correlation graph and displays
 * a summary or full JSON output. The `--status` flag loads the last saved
 * graph without re-running.
 *
 * @module
 */

import { join } from "node:path";
import { createDefaultBaselineRegistry } from "../../baseline/baseline-registry.js";
import { ExecutiveTrendStore } from "../../executive/trend-store.js";
import { CorrelationEngine } from "../../correlation/correlation-engine.js";
import { CorrelationGraphStore } from "../../correlation/correlation-graph-store.js";
import { DEFAULT_CORRELATION_CONFIG } from "../../correlation/correlation-config.js";
import type { CorrelationGraph } from "../../correlation/correlation-types.js";
import { CorrelationGraphLoadError } from "../../correlation/correlation-types.js";

export async function handleCorrelateCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const executiveDir = join(cwd, ".alix", "executive");
  const correlationDir = join(cwd, ".alix", "correlation");
  const isJson = args.includes("--json");
  const isStatus = args.includes("--status");
  const store = new CorrelationGraphStore(correlationDir);

  try {
    if (isStatus) {
      const graph = await store.loadLatest();
      if (!graph) { console.log("No saved correlation graph found."); return; }
      printSummary(graph, isJson);
      return;
    }

    const registry = createDefaultBaselineRegistry();
    const trendStore = new ExecutiveTrendStore(executiveDir);
    const engine = new CorrelationEngine(registry, trendStore, DEFAULT_CORRELATION_CONFIG);
    const graph = await engine.run();
    await store.save(graph);
    printSummary(graph, isJson);
  } catch (err: unknown) {
    if (err instanceof CorrelationGraphLoadError) {
      console.error(`Error reading correlation graph: ${err.message}`);
    } else if (err instanceof Error) {
      console.error(`Correlation error: ${err.message}`);
    } else {
      console.error("Unknown correlation error");
    }
    process.exit(1);
  }
}

function printSummary(graph: CorrelationGraph, isJson: boolean): void {
  if (isJson) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }
  console.log(`Correlation Graph`);
  console.log(`Status: ${graph.status}`);
  console.log(`Generated: ${graph.generatedAt}`);
  console.log(`Nodes: ${graph.nodes.length}`);
  console.log(`Edges: ${graph.edges.length}`);
  console.log(`Window size: ${graph.windowSize}`);
  console.log(`Snapshots examined: ${graph.meta.totalSnapshotsExamined}`);
  if (graph.edges.length > 0) {
    console.log();
    const top = [...graph.edges]
      .sort((a, b) => b.correlationConfidence - a.correlationConfidence)
      .slice(0, 5);
    console.log("Top correlations:");
    top.forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.source} → ${e.target}\tconfidence ${e.correlationConfidence.toFixed(2)}\tlag ${e.temporalLag}\t${e.correlationDirection}`);
    });
  }
}
