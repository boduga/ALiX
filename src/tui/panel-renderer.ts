/**
 * panel-renderer.ts — Panel content rendering for the TUI, extracted from the command loop.
 */

import type { TuiStore } from "./store.js";
import type { Tui } from "./index.js";

/** Render content for the active panel. Returns number of lines rendered. */
export function renderPanelContent(store: TuiStore, tui: Tui): number {
  const s = store.getState();
  const buf: string[] = [];

  if (s.activePanel === "daemon") {
    const ws = s.workspaceName ? ` — ${s.workspaceName}` : "";
    buf.push(`── Daemon${ws} ──────────────────────────`);
    buf.push(`Status:  ${s.daemonRunning ? "● running" : "○ stopped"}`);
    if (s.workspacePath) {
      buf.push(`Path:    ${s.workspacePath}`);
    }
    if (s.daemonTasks) {
      const t = s.daemonTasks;
      buf.push(`Tasks:   run:${t.running} queued:${t.queued} done:${t.completed} fail:${t.failed}`);
    }
    if (s.daemonTaskRecords && s.daemonTaskRecords.length > 0) {
      buf.push("── Recent Tasks ────────────────────────");
      for (const r of s.daemonTaskRecords.slice(0, 8)) {
        buf.push(`  ${(r.status || "").padEnd(18)} ${r.id} ${(r.task || "").slice(0, 30)}`);
      }
    }
    if (s.recentWorkspaces && s.recentWorkspaces.length > 1) {
      buf.push("── Recent Workspaces ────────────────────");
      for (const w of s.recentWorkspaces.slice(0, 4)) {
        if (w.path === s.workspacePath) continue; // skip current
        const icon = w.status === "active" ? "●" : "○";
        buf.push(`  ${icon} ${w.name} (${w.taskCount} tasks)`);
      }
    }
    buf.push(`Events:  ${s.runtimeEventCount || 0}`);
  } else if (s.activePanel === "approvals") {
    buf.push("── Approvals ────────────────────────────");
    buf.push(`Pending: ${s.pendingApprovalsCount || 0}`);
    if (s.pendingApprovalRecords && s.pendingApprovalRecords.length > 0) {
      for (const a of s.pendingApprovalRecords) {
        buf.push(`  ${a.id}  ${a.capability || "?"}  ${(a.reason || "").slice(0, 40)}`);
        buf.push(`    /approve ${a.id} or /deny ${a.id}`);
      }
    } else {
      buf.push("  No pending approvals.");
    }
    if (s.resolvedApprovalRecords && s.resolvedApprovalRecords.length > 0) {
      buf.push(`Resolved: ${s.resolvedApprovalsCount || 0}`);
      for (const a of s.resolvedApprovalRecords.slice(0, 8)) {
        const marker = a.status === "approved" ? "✓" : "✗";
        buf.push(`  ${marker} ${a.id}  ${a.capability || "?"}  ${a.status || "?"}  ${(a.reason || "").slice(0, 30)}`);
      }
    }
    if (s.continuationsCount) {
      buf.push(`Continuations: ${s.continuationsCount}`);
    }
  } else if (s.activePanel === "sops") {
    buf.push("── SOP Packs ────────────────────────────");
    buf.push(`SOPs:    ${s.sopsCount || 0}`);
    if (s.sopItems && s.sopItems.length > 0) {
      for (const sop of s.sopItems) {
        const n = sop.nodeCount ? `${sop.nodeCount}n` : "?";
        buf.push(`  ${sop.id} ${n}`);
      }
    } else {
      buf.push("  research.deep_report      6 nodes");
      buf.push("  infra.docker_compose_audit 1 node");
    }
  } else if (s.activePanel === "policy") {
    buf.push("── Policy Rules ─────────────────────────");
    buf.push(`Rules:   ${s.policyRulesCount || 0}`);
    buf.push("Run: alix policy eval --capability <cap>");
  } else if (s.activePanel === "runtime") {
    buf.push("── Runtime Events ───────────────────────");
    buf.push(`Events:  ${s.runtimeEventCount || 0}`);
    if (s.recentRuntimeEvents && s.recentRuntimeEvents.length > 0) {
      for (const e of s.recentRuntimeEvents.slice(0, 8)) {
        buf.push(`  [${e.source}] ${e.action} ${(e.summary || "").slice(0, 40)}`);
      }
    }
  } else if (s.activePanel === "trace") {
    const filterLabel = s.traceFilter === "all" ? "all" : s.traceFilter;
    buf.push(`── Trace (filter: ${filterLabel}) ──────────────`);
    buf.push(`Events: ${s.traceEventCount ?? s.traceEvents.length}`);
    if (s.traceEvents.length === 0) {
      buf.push("  No trace events. Run a task to populate the timeline.");
    } else {
      const filtered = s.traceFilter === "all"
        ? s.traceEvents
        : s.traceEvents.filter(e => e.sourceType === s.traceFilter);
      const display = filtered.slice(-20).reverse();
      for (const t of display) {
        const time = new Date(t.timestamp).toLocaleTimeString();
        const iconMap: Record<string, string> = {
          allowed: "●", denied: "✗", pending: "○",
          running: "▶", success: "✔", failed: "✗", completed: "✔",
        };
        const icon = t.status ? (iconMap[t.status] || " ") : " ";
        const src = t.sourceType.padEnd(12);
        const label = t.label.slice(0, 48);
        buf.push(`  ${time} ${icon} ${src} ${label}`);
      }
    }
    buf.push(`  t=filter  r=refresh`);
  }

  for (const line of buf) tui.appendOutput(line, false);
  return buf.length;
}
