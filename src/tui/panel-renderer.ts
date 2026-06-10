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
    buf.push("── Daemon ──────────────────────────────");
    buf.push(`Status:  ${s.daemonRunning ? "● running" : "○ stopped"}`);
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
    buf.push(`Events:  ${s.runtimeEventCount || 0}`);
  } else if (s.activePanel === "approvals") {
    buf.push("── Approvals ────────────────────────────");
    buf.push(`Pending: ${s.pendingApprovalsCount || 0}`);
    if (s.pendingApprovalRecords && s.pendingApprovalRecords.length > 0) {
      for (const a of s.pendingApprovalRecords) {
        buf.push(`  ${a.id}  ${a.capability || "?"}  ${(a.reason || "").slice(0, 40)}`);
        buf.push(`    alix approvals approve ${a.id}`);
      }
    } else {
      buf.push("No pending approvals.");
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
  }

  for (const line of buf) tui.appendOutput(line, false);
  return buf.length;
}
