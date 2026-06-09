/**
 * runtime-snapshot.ts — Loads Agent OS runtime state for TUI display.
 */

import type { DaemonTaskSummary, TuiStore, PanelApprovalRecord, PanelRuntimeEvent } from "./store.js";

export interface TuiRuntimeSnapshot {
  daemonRunning: boolean;
  daemonTasks: DaemonTaskSummary;
  daemonTaskRecords: { id: string; task: string; status: string; sessionId?: string }[];
  pendingApprovalsCount: number;
  pendingApprovalRecords: PanelApprovalRecord[];
  sopsCount: number;
  policyRulesCount: number;
  runtimeEventCount: number;
  recentRuntimeEvents: PanelRuntimeEvent[];
  daemonHeartbeatAge: number;
}

/** Build a fresh snapshot from disk. Returns null on failure. */
export async function buildRuntimeSnapshot(cwd: string): Promise<TuiRuntimeSnapshot | null> {
  try {
    const snapshot: TuiRuntimeSnapshot = {
      daemonRunning: false,
      daemonTasks: { queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0, failedOrphaned: 0 },
      daemonTaskRecords: [],
      pendingApprovalsCount: 0,
      pendingApprovalRecords: [],
      sopsCount: 0,
      policyRulesCount: 0,
      runtimeEventCount: 0,
      recentRuntimeEvents: [],
      daemonHeartbeatAge: -1,
    };

    // Daemon
    const { DaemonManager } = await import("../daemon/daemon-manager.js");
    const mgr = new DaemonManager(cwd);
    snapshot.daemonRunning = await mgr.isRunning();
    if (snapshot.daemonRunning) {
      const status = await mgr.status();
      if (status?.lastHeartbeat) {
        snapshot.daemonHeartbeatAge = Math.round((Date.now() - new Date(status.lastHeartbeat).getTime()) / 1000);
      }
    }

    // Daemon tasks
    const { existsSync } = await import("node:fs");
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const tasksPath = join(cwd, ".alix", "daemon-tasks.json");
    if (existsSync(tasksPath)) {
      const raw = await readFile(tasksPath, "utf-8");
      const tasks = JSON.parse(raw);
      for (const t of tasks) {
        const s = t.status;
        if (s === "queued") snapshot.daemonTasks.queued++;
        else if (s === "running") snapshot.daemonTasks.running++;
        else if (s === "completed") snapshot.daemonTasks.completed++;
        else if (s === "failed" || s === "failed_orphaned") snapshot.daemonTasks.failed++;
        else if (s === "cancelled") snapshot.daemonTasks.cancelled++;
        snapshot.daemonTaskRecords.push({ id: t.id, task: t.task, status: s, sessionId: t.sessionId });
      }
    }

    // Approvals
    const { ApprovalStore } = await import("../approvals/approval-store.js");
    const approvalStore = new ApprovalStore(cwd);
    await approvalStore.load();
    const allPending = approvalStore.listPending();
    snapshot.pendingApprovalsCount = allPending.length;
    for (const a of allPending) {
      snapshot.pendingApprovalRecords.push({
        id: a.id, capability: a.capability, riskLevel: a.riskLevel,
        reason: a.reason, createdAt: a.createdAt,
      });
    }

    // SOPs
    const { listSops } = await import("../sop/sop-registry.js");
    snapshot.sopsCount = listSops().length;

    // Policy rules
    const { loadRuleEvaluator } = await import("../policy/policy-loader.js");
    const ev = await loadRuleEvaluator(cwd);
    snapshot.policyRulesCount = ev.getAllRules().length;

    // RuntimeIndex
    const { buildRuntimeIndex } = await import("../runtime/runtime-index.js");
    const idx = await buildRuntimeIndex(cwd);
    snapshot.runtimeEventCount = idx.events.length;
    for (const e of idx.events.slice(0, 10)) {
      snapshot.recentRuntimeEvents.push({
        id: e.id, action: e.action, source: e.source,
        summary: e.summary, timestamp: e.timestamp, graphId: e.graphId,
      });
    }

    return snapshot;
  } catch {
    return null;
  }
}

/** Apply a snapshot to a TuiStore. */
export function applySnapshotToStore(store: TuiStore, snapshot: TuiRuntimeSnapshot): void {
  store.setDaemonRunning(snapshot.daemonRunning);
  store.setDaemonTaskSummary(snapshot.daemonTasks);
  store.setDaemonTaskRecords(snapshot.daemonTaskRecords);
  store.setPendingApprovalsCount(snapshot.pendingApprovalsCount);
  store.setPendingApprovalRecords(snapshot.pendingApprovalRecords);
  store.setSopsCount(snapshot.sopsCount);
  store.setPolicyRulesCount(snapshot.policyRulesCount);
  store.setRuntimeEventCount(snapshot.runtimeEventCount);
  store.setRecentRuntimeEvents(snapshot.recentRuntimeEvents);
}
