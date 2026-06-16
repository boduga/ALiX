/**
 * coordination-panel.ts — TUI panel for coordination run visibility.
 *
 * Shows run header, worker table with selection, and drill-down details.
 * Follows the same pattern as ifamas-panel.ts and chronicle-panel.ts.
 */

import type { CoordinationRunView } from "../kernel/coordination-view.js";

export type CoordinationPanelViewMode = "overview" | "worker" | "approvals" | "failures" | "results" | "conflicts";

export type CoordinationPanelData = {
  view: CoordinationRunView;
  selectedWorkerIndex: number;
  viewMode: CoordinationPanelViewMode;
  selectedConflictIndex?: number;
};

export function formatCoordinationPanel(
  data: CoordinationPanelData,
  width?: number,
): string[] {
  const lines: string[] = [];
  const w = width ?? 80;

  switch (data.viewMode) {
    case "overview": return renderOverview(data, w);
    case "worker": return renderWorkerDetail(data, w);
    case "approvals": return renderApprovals(data, w);
    case "failures": return renderFailures(data, w);
    case "results": return renderResults(data, w);
    case "conflicts": return renderConflicts(data, w);
    default: return lines;
  }
}

function renderOverview(data: CoordinationPanelData, width: number): string[] {
  const lines: string[] = [];
  const v = data.view;
  lines.push(`── Coordination Run ─────────────────────`);
  lines.push(`Run: ${v.run.id}`);
  lines.push(`Goal: ${v.run.goal}`);
  lines.push(`Status: ${v.run.status}  Outcome: ${v.run.outcome ?? "-"}  Freshness: ${v.freshness}`);
  lines.push(`Workers: ${v.run.workerCount} total`);
  if (typeof v.conflictCount === "number" && v.conflictCount > 0) {
    lines.push(`Conflicts: ${v.conflictCount} unresolved`);
  }
  lines.push(`Created: ${v.run.createdAt.slice(0, 19)}`);
  lines.push(`Updated: ${v.run.updatedAt.slice(0, 19)}`);
  lines.push("");
  lines.push(`${"Worker".padEnd(20)} ${"Status".padEnd(12)} ${"Attempt".padEnd(8)} ${"Duration".padEnd(10)} Task`);
  lines.push("─".repeat(Math.min(width, 80)));

  for (let i = 0; i < v.workers.length; i++) {
    const w = v.workers[i];
    const sel = i === data.selectedWorkerIndex ? ">" : " ";
    const dur = w.durationMs ? `${(w.durationMs / 1000).toFixed(1)}s` : "-";
    const status = w.blockReason ?? w.status;
    const taskTrunc = w.taskLabel.slice(0, Math.max(20, width - 70));
    lines.push(`${sel} ${w.id.slice(0, 16).padEnd(18)} ${status.padEnd(12)} ${String(w.attempt).padEnd(8)} ${dur.padEnd(10)} ${taskTrunc}`);
  }

  if (v.workers.length === 0) {
    lines.push("  (no workers)");
  }

  lines.push("");
  lines.push("Keys: ↑↓ select worker  Enter=detail  a=approvals  f=failures  r=results  c=conflicts");
  return lines;
}

function renderWorkerDetail(data: CoordinationPanelData, _width: number): string[] {
  const w = data.view.workers[data.selectedWorkerIndex] ?? data.view.workers[0];
  if (!w) return ["No worker selected."];
  const lines: string[] = [];
  lines.push("── Worker Detail ─────────────────────────");
  lines.push(`Worker: ${w.id}`);
  lines.push(`Task: ${w.taskLabel}`);
  lines.push(`Agent: ${w.agentId}  Attempt: ${w.attempt}/${w.maxAttempts}  Status: ${w.status}`);
  if (w.outcome) lines.push(`Outcome: ${w.outcome}`);
  if (w.durationMs) lines.push(`Duration: ${(w.durationMs / 1000).toFixed(1)}s`);
  if (w.error) lines.push(`Error: ${w.error}`);
  if (w.blockReason) lines.push(`Blocked: ${w.blockReason}`);
  if (w.resultRef) lines.push(`Result: ${w.resultRef}`);
  if (w.startedAt) lines.push(`Started: ${w.startedAt.slice(0, 19)}`);
  if (w.completedAt) lines.push(`Completed: ${w.completedAt.slice(0, 19)}`);
  if (w.ownershipScopes.length > 0) lines.push(`Ownership: ${w.ownershipScopes.join(", ")}`);
  lines.push(""); lines.push("Keys: ESC=back");
  return lines;
}

function renderApprovals(data: CoordinationPanelData, _width: number): string[] {
  const lines = ["── Approvals ────────────────────────────"];
  for (const a of data.view.approvals) {
    lines.push(`  ${a.id}  ${a.status}  ${(a.capabilities ?? []).join(",")}  expires ${a.expiresAt.slice(0, 19)}`);
  }
  if (data.view.approvals.length === 0) lines.push("  (none)");
  lines.push(""); lines.push("Keys: ESC=back");
  return lines;
}

function renderFailures(data: CoordinationPanelData, _width: number): string[] {
  const lines = ["── Failure Chains ───────────────────────"];
  for (const c of data.view.failureChains) {
    lines.push(`  Root: ${c.rootWorkerId} (${c.rootTaskLabel})`);
    if (c.rootError) lines.push(`  Error: ${c.rootError}`);
    lines.push(`  Affected: ${c.allAffectedWorkers.length} workers`);
    const depths = Object.entries(c.depthByWorker)
      .sort(([, a], [, b]) => a - b)
      .map(([id, d]) => `${id.slice(0, 8)}:${d}`);
    lines.push(`  Depth: ${depths.join(" → ")}`);
    lines.push("");
  }
  if (data.view.failureChains.length === 0) lines.push("  (none)");
  lines.push(""); lines.push("Keys: ESC=back");
  return lines;
}

function renderResults(data: CoordinationPanelData, _width: number): string[] {
  const lines = ["── Aggregate Results ────────────────────"];
  const agg = data.view.aggregate;
  if (!agg) {
    lines.push("  (no aggregate — run may not be complete)");
    lines.push(""); lines.push("Keys: ESC=back");
    return lines;
  }
  lines.push(`  Outcome: ${agg.outcome}`);
  lines.push(`  Workers: ${agg.counts.completed} completed, ${agg.counts.failed} failed, ${agg.counts.blocked} blocked`);
  lines.push(`  Results: ${agg.counts.successfulResults} success, ${agg.counts.failedResults} failure`);
  if (agg.timing.wallClockDurationMs) lines.push(`  Duration: ${(agg.timing.wallClockDurationMs / 1000).toFixed(1)}s`);
  if (agg.finalSummary) lines.push(`\n  Synthesis: ${agg.finalSummary}`);
  lines.push(""); lines.push("Keys: ESC=back");
  return lines;
}

function renderConflicts(data: CoordinationPanelData, width: number): string[] {
  const lines = ["── Conflicts ────────────────────────────"];
  const conflicts = data.view.conflicts ?? [];
  if (conflicts.length === 0) {
    lines.push("  (no unresolved conflicts)");
    lines.push(""); lines.push("Keys: ESC=back");
    return lines;
  }
  const sel = data.selectedConflictIndex ?? 0;
  lines.push(`${"  "}${"Conflict".padEnd(22)} ${"Status".padEnd(14)} ${"Type".padEnd(22)} ${"Crit".padEnd(8)} F  Topic`);
  lines.push("─".repeat(Math.min(width, 80)));
  for (let i = 0; i < conflicts.length; i++) {
    const c = conflicts[i];
    const mark = i === sel ? ">" : " ";
    const topicTrunc = c.topicKey.slice(0, Math.max(20, width - 78));
    lines.push(`${mark} ${c.id.slice(0, 20).padEnd(22)} ${c.status.padEnd(14)} ${c.type.padEnd(22)} ${c.criticality.padEnd(8)} ${String(c.findingCount).padEnd(2)} ${topicTrunc}`);
  }
  const cur = conflicts[sel];
  if (cur) {
    lines.push("");
    lines.push(`Evidence: ${cur.evidenceRecommendation} (confidence ${cur.evidenceConfidence}, margin ${cur.scoreMargin.toFixed(2)})`);
    lines.push(`Detected by: ${cur.detectedBy.join(", ")}`);
    lines.push(`Updated: ${cur.updatedAt.slice(0, 19)}`);
  }
  lines.push(""); lines.push("Keys: ↑↓ select conflict  ESC=back");
  return lines;
}
