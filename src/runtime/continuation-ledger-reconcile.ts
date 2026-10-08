// src/runtime/continuation-ledger-reconcile.ts
//
// R2.8 — compare `.alix/approvals/continuations.json` against the
// transactional ledger. Read-only. Counts unknown event types and reports
// read truncation (R2 exit conditions).
//
// Issue kinds:
//   missing_in_ledger     — projection record with zero ledger facts (legacy)
//   record_mismatch       — argsHash/name/kind differ (ledger wins after flip)
//   projection_stale      — ledger says removed, record still present
//   projection_missing    — live ledger continuation absent from the file
//   version_behind        — last event entityVersion ≠ event count
//   ledger_payload_invalid — live event without a continuation payload

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONTINUATION_LEDGER_EVENT_TYPES } from "./continuation-store.js";
import type { PendingContinuation } from "./continuation-store.js";
import { getSharedLedger } from "../storage/runtime-ledger.js";

export type ContinuationReconcileIssueKind =
  | "missing_in_ledger"
  | "record_mismatch"
  | "projection_stale"
  | "projection_missing"
  | "version_behind"
  | "ledger_payload_invalid";

export interface ContinuationReconcileIssue {
  approvalId: string;
  kind: ContinuationReconcileIssueKind;
  detail: string;
}

export interface ContinuationReconcileReport {
  scannedRecords: number;
  ledgerEntities: number;
  ledgerEventsRead: number;
  issues: ContinuationReconcileIssue[];
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set<string>(CONTINUATION_LEDGER_EVENT_TYPES);

interface LedgerEventRow {
  eventType: string;
  entityType: string;
  entityId: string;
  entityVersion: number;
  payload: unknown;
  ledgerSeq: number;
}

function drainLedgerEvents(cwd: string, entityTypes: ReadonlySet<string>, maxPages = 50, pageSize = 2000): { events: LedgerEventRow[]; truncated: boolean } {
  const ledger = getSharedLedger(cwd);
  const events: LedgerEventRow[] = [];
  let cursor = 0;
  for (let page = 0; page < maxPages; page++) {
    const rows = ledger.readEvents({ sinceSeq: cursor, limit: pageSize });
    for (const r of rows) {
      if (!entityTypes.has(r.entityType)) continue;
      events.push({
        eventType: r.eventType,
        entityType: r.entityType,
        entityId: r.entityId,
        entityVersion: r.entityVersion,
        payload: r.payload,
        ledgerSeq: r.ledgerSeq,
      });
      cursor = r.ledgerSeq;
    }
    if (rows.length < pageSize) return { events, truncated: false };
  }
  return { events, truncated: true };
}

export async function reconcileContinuationLedger(cwd: string): Promise<ContinuationReconcileReport> {
  const issues: ContinuationReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  const filePath = join(cwd, ".alix", "approvals", "continuations.json");
  const projection: PendingContinuation[] = existsSync(filePath)
    ? (JSON.parse(await readFile(filePath, "utf-8")) as PendingContinuation[])
    : [];

  const { events, truncated } = drainLedgerEvents(cwd, new Set(["continuation"]));
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
    projectionIds.add(record.approvalId);
    const evts = byEntity.get(record.approvalId);
    if (!evts || evts.length === 0) {
      issues.push({
        approvalId: record.approvalId,
        kind: "missing_in_ledger",
        detail: "continuation exists with zero ledger facts (legacy pre-ledger record)",
      });
      continue;
    }
    const last = evts[evts.length - 1];
    if (last.entityVersion !== evts.length) {
      issues.push({
        approvalId: record.approvalId,
        kind: "version_behind",
        detail: `last entityVersion ${last.entityVersion} != event count ${evts.length}`,
      });
    }
    if (last.eventType === "continuation.removed") {
      issues.push({
        approvalId: record.approvalId,
        kind: "projection_stale",
        detail: "ledger removed this continuation but it is still in continuations.json",
      });
      continue;
    }
    const payload = last.payload as { continuation?: PendingContinuation } | null;
    if (!payload?.continuation) {
      issues.push({
        approvalId: record.approvalId,
        kind: "ledger_payload_invalid",
        detail: "live continuation event missing continuation payload",
      });
      continue;
    }
    const ledgerRecord = payload.continuation;
    const compare: Array<[string, unknown, unknown]> = [
      ["kind", record.kind, ledgerRecord.kind],
      ["sessionId", record.sessionId, ledgerRecord.sessionId],
      ["argsHash", record.toolCall?.argsHash, ledgerRecord.toolCall?.argsHash],
      ["toolName", record.toolCall?.name, ledgerRecord.toolCall?.name],
    ];
    for (const [field, jsonValue, ledgerValue] of compare) {
      if (jsonValue !== ledgerValue) {
        issues.push({
          approvalId: record.approvalId,
          kind: "record_mismatch",
          detail: `${field}: json=${JSON.stringify(jsonValue)} ledger=${JSON.stringify(ledgerValue)}`,
        });
      }
    }
  }

  for (const [entityId, evts] of byEntity) {
    const last = evts[evts.length - 1];
    if (last.eventType === "continuation.removed") continue;
    liveEntities += 1;
    if (projectionIds.has(entityId)) continue;
    const payload = last.payload as { continuation?: PendingContinuation } | null;
    if (!payload?.continuation) {
      issues.push({
        approvalId: entityId,
        kind: "ledger_payload_invalid",
        detail: "live continuation event missing continuation payload",
      });
      continue;
    }
    issues.push({
      approvalId: entityId,
      kind: "projection_missing",
      detail: "live ledger continuation absent from continuations.json (write failed or consumed elsewhere)",
    });
  }

  issues.sort((a, b) => a.approvalId.localeCompare(b.approvalId) || a.kind.localeCompare(b.kind));
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
