// src/coordination/kernel/collaboration-ledger-reconcile.ts
//
// R2.10 — compare `.alix/coordination/shared/<runId>/state.json` files
// against the transactional ledger. Read-only. Counts unknown event types
// and reports read truncation (R2 exit conditions).
//
// Issue kinds:
//   missing_in_ledger     — state file with zero ledger facts (legacy)
//   record_mismatch       — revision or collection counts differ
//   projection_missing    — live ledger state has no file
//   version_behind        — last event entityVersion ≠ event count
//   ledger_payload_invalid — live event without a state payload

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { COLLABORATION_LEDGER_EVENT_TYPES, collabEntityId } from "./collaboration-types.js";
import type { CollaborationState } from "./collaboration-types.js";
import { drainLedgerEvents, type LedgerEventRow } from "../../runtime-state/storage/runtime-ledger.js";

export type CollaborationReconcileIssueKind =
  | "missing_in_ledger"
  | "record_mismatch"
  | "projection_missing"
  | "version_behind"
  | "ledger_payload_invalid";

export interface CollaborationReconcileIssue {
  runId: string;
  kind: CollaborationReconcileIssueKind;
  detail: string;
}

export interface CollaborationReconcileReport {
  scannedStates: number;
  ledgerEntities: number;
  ledgerEventsRead: number;
  issues: CollaborationReconcileIssue[];
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set<string>(COLLABORATION_LEDGER_EVENT_TYPES);

async function readProjection(cwd: string): Promise<CollaborationState[]> {
  const dir = join(cwd, ".alix", "coordination", "shared");
  if (!existsSync(dir)) return [];
  const out: CollaborationState[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, "state.json");
    if (!existsSync(path)) continue;
    try {
      out.push(JSON.parse(await readFile(path, "utf-8")) as CollaborationState);
    } catch {
      // corrupt state file — invisible to both sides
    }
  }
  return out;
}

export async function reconcileCollaborationLedger(cwd: string): Promise<CollaborationReconcileReport> {
  const issues: CollaborationReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  const projections = await readProjection(cwd);
  const { events, truncated } = drainLedgerEvents(cwd, new Set(["collaborationState"]));

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
  for (const state of projections) {
    projectionIds.add(collabEntityId(state.runId));
    const evts = byEntity.get(collabEntityId(state.runId));
    if (!evts || evts.length === 0) {
      issues.push({
        runId: state.runId,
        kind: "missing_in_ledger",
        detail: "state file exists with zero ledger facts (legacy pre-ledger collaboration)",
      });
      continue;
    }
    const last = evts[evts.length - 1];
    if (last.entityVersion !== evts.length) {
      issues.push({
        runId: state.runId,
        kind: "version_behind",
        detail: `last entityVersion ${last.entityVersion} != event count ${evts.length}`,
      });
    }
    const payload = last.payload as { state?: CollaborationState } | null;
    if (!payload?.state) {
      issues.push({
        runId: state.runId,
        kind: "ledger_payload_invalid",
        detail: "live collaboration event missing state payload",
      });
      continue;
    }
    const ledgerState = payload.state;
    if (ledgerState.revision !== state.revision) {
      issues.push({
        runId: state.runId,
        kind: "record_mismatch",
        detail: `revision: json=${state.revision} ledger=${ledgerState.revision}`,
      });
    }
    const compare: Array<[string, number, number]> = [
      ["findings", state.findings?.length ?? 0, ledgerState.findings?.length ?? 0],
      ["artifacts", state.artifacts?.length ?? 0, ledgerState.artifacts?.length ?? 0],
      ["conflicts", state.conflicts?.length ?? 0, ledgerState.conflicts?.length ?? 0],
    ];
    for (const [name, jsonCount, ledgerCount] of compare) {
      if (jsonCount !== ledgerCount) {
        issues.push({
          runId: state.runId,
          kind: "record_mismatch",
          detail: `${name}: json=${jsonCount} ledger=${ledgerCount}`,
        });
      }
    }
  }

  for (const [entityId, evts] of byEntity) {
    liveEntities += 1;
    if (projectionIds.has(entityId)) continue;
    const payload = evts[evts.length - 1].payload as { state?: CollaborationState } | null;
    if (!payload?.state) {
      issues.push({
        runId: entityId,
        kind: "ledger_payload_invalid",
        detail: "live collaboration event missing state payload",
      });
      continue;
    }
    issues.push({
      runId: entityId,
      kind: "projection_missing",
      detail: "live ledger collaboration state has no state.json (write failed or deleted)",
    });
  }

  issues.sort((a, b) => a.runId.localeCompare(b.runId) || a.kind.localeCompare(b.kind));
  return {
    scannedStates: projections.length,
    ledgerEntities: liveEntities,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}
