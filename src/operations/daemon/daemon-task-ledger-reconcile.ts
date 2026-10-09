// src/operations/daemon/daemon-task-ledger-reconcile.ts
//
// R2.9 — compare the GLOBAL daemon task registry (~/.alix/daemon-tasks.json)
// against the per-user transactional ledger (~/.alix/runtime-ledger.db).
// Read-only. Counts unknown event types and reports read truncation (R2
// exit conditions).
//
// Issue kinds:
//   missing_in_ledger     — registry record with zero ledger facts (legacy)
//   record_mismatch       — status/sessionId differ (ledger mirrors after
//                           each durable write, so a diff = missed mirror)
//   projection_stale      — ledger says removed, record still present
//   projection_missing    — live ledger task absent from the registry
//   version_behind        — last event entityVersion ≠ event count
//   ledger_payload_invalid — live event without a task payload

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { DAEMON_TASK_LEDGER_EVENT_TYPES } from "./daemon-types.js";
import type { DaemonTaskRecord } from "./task-registry.js";
import { resolveDaemonTasksPath } from "./daemon-paths.js";
import { drainLedgerEvents, type LedgerEventRow } from "../../runtime-state/storage/runtime-ledger.js";

export type DaemonTaskReconcileIssueKind =
  | "missing_in_ledger"
  | "record_mismatch"
  | "projection_stale"
  | "projection_missing"
  | "version_behind"
  | "ledger_payload_invalid";

export interface DaemonTaskReconcileIssue {
  taskId: string;
  kind: DaemonTaskReconcileIssueKind;
  detail: string;
}

export interface DaemonTaskReconcileReport {
  scannedRecords: number;
  ledgerEntities: number;
  ledgerEventsRead: number;
  issues: DaemonTaskReconcileIssue[];
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set<string>(DAEMON_TASK_LEDGER_EVENT_TYPES);

export async function reconcileDaemonTaskLedger(
  registryPath: string = resolveDaemonTasksPath(),
  ledgerCwd: string = homedir(),
): Promise<DaemonTaskReconcileReport> {
  const issues: DaemonTaskReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  const projection: DaemonTaskRecord[] = existsSync(registryPath)
    ? JSON.parse(await readFile(registryPath, "utf-8"))
    : [];

  const { events, truncated } = drainLedgerEvents(ledgerCwd, new Set(["daemonTask"]));
  const byEntity = new Map<string, LedgerEventRow[]>();
  for (const e of events) {
    if (!KNOWN_TYPES.has(e.eventType)) {
      unknownEventTypes[e.eventType] = (unknownEventTypes[e.eventType] ?? 0) + 1;
    }
    const list = byEntity.get(e.entityId) ?? [];
    list.push(e);
    byEntity.set(e.entityId, list);
  }

  const projectionIds = new Set<string>();
  let liveEntities = 0;
  for (const record of projection) {
    projectionIds.add(record.id);
    const evts = byEntity.get(record.id);
    if (!evts || evts.length === 0) {
      issues.push({
        taskId: record.id,
        kind: "missing_in_ledger",
        detail: "registry record with zero ledger facts (legacy pre-ledger task)",
      });
      continue;
    }
    const last = evts[evts.length - 1];
    if (last.entityVersion !== evts.length) {
      issues.push({
        taskId: record.id,
        kind: "version_behind",
        detail: `last entityVersion ${last.entityVersion} != event count ${evts.length}`,
      });
    }
    if (last.eventType === "daemonTask.removed") {
      issues.push({
        taskId: record.id,
        kind: "projection_stale",
        detail: "ledger removed this task but it is still in the registry",
      });
      continue;
    }
    const payload = last.payload as { task?: DaemonTaskRecord } | null;
    if (!payload?.task) {
      issues.push({
        taskId: record.id,
        kind: "ledger_payload_invalid",
        detail: "live daemonTask event missing task payload",
      });
      continue;
    }
    const ledgerRecord = payload.task;
    if (ledgerRecord.status !== record.status) {
      issues.push({
        taskId: record.id,
        kind: "record_mismatch",
        detail: `status: json=${record.status} ledger=${ledgerRecord.status}`,
      });
    }
    if (ledgerRecord.sessionId !== record.sessionId) {
      issues.push({
        taskId: record.id,
        kind: "record_mismatch",
        detail: `sessionId: json=${JSON.stringify(record.sessionId)} ledger=${JSON.stringify(ledgerRecord.sessionId)}`,
      });
    }
  }

  for (const [entityId, evts] of byEntity) {
    const last = evts[evts.length - 1];
    if (last.eventType === "daemonTask.removed") continue;
    liveEntities += 1;
    if (projectionIds.has(entityId)) continue;
    const payload = last.payload as { task?: DaemonTaskRecord } | null;
    if (!payload?.task) {
      issues.push({
        taskId: entityId,
        kind: "ledger_payload_invalid",
        detail: "live daemonTask event missing task payload",
      });
      continue;
    }
    issues.push({
      taskId: entityId,
      kind: "projection_missing",
      detail: "live ledger task absent from the registry (write failed or pruned without tombstone)",
    });
  }

  issues.sort((a, b) => a.taskId.localeCompare(b.taskId) || a.kind.localeCompare(b.kind));
  return {
    scannedRecords: projection.length,
    ledgerEntities: liveEntities,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}
