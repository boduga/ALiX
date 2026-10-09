// src/approvals/approval-ledger-reconcile.ts
//
// R2.4 — compare the approvals JSON projection (snapshot + journal replay)
// against the transactional ledger. Read-only. Counts unknown event types
// and reports read truncation (R2 exit conditions).
//
// Issue kinds:
//   missing_in_ledger   — projection record with zero ledger facts (legacy)
//   record_mismatch     — authorization-relevant fields differ (ledger wins)
//   projection_stale    — ledger says removed, record still in projection
//   projection_missing  — live ledger record absent from projection
//   version_behind      — last event entityVersion ≠ event count
//   ledger_payload_invalid — live event without an approval payload

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { APPROVAL_LEDGER_EVENT_TYPES } from "./approval-types.js";
import type { ApprovalRecord } from "./approval-types.js";
import { drainLedgerEvents, type LedgerEventRow } from "../storage/runtime-ledger.js";

export type ApprovalReconcileIssueKind =
  | "missing_in_ledger"
  | "record_mismatch"
  | "projection_stale"
  | "projection_missing"
  | "version_behind"
  | "ledger_payload_invalid";

export interface ApprovalReconcileIssue {
  approvalId: string;
  kind: ApprovalReconcileIssueKind;
  detail: string;
}

export interface ApprovalReconcileReport {
  scannedRecords: number;
  ledgerEntities: number;
  ledgerEventsRead: number;
  issues: ApprovalReconcileIssue[];
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set<string>(APPROVAL_LEDGER_EVENT_TYPES);

/**
 * Read the approvals projection exactly as external readers do: snapshot
 * first, then replay the append-only journal on top (#703 contract).
 */
async function readApprovalProjection(cwd: string): Promise<ApprovalRecord[]> {
  const filePath = join(cwd, ".alix", "approvals", "approvals.json");
  const journalPath = `${filePath}.journal.jsonl`;
  const records = new Map<string, ApprovalRecord>();
  if (existsSync(filePath)) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : (parsed.approvals ?? []);
      for (const r of list as ApprovalRecord[]) records.set(r.id, r);
    } catch {
      // corrupt snapshot — journal may still be readable; continue
    }
  }
  if (existsSync(journalPath)) {
    try {
      const raw = await readFile(journalPath, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as { op?: string; record?: ApprovalRecord };
          if (entry.op === "put" && entry.record?.id) records.set(entry.record.id, entry.record);
        } catch {
          // skip malformed journal line (same policy as JsonlStore)
        }
      }
    } catch {
      // unreadable journal — snapshot view only
    }
  }
  return [...records.values()];
}

/** Authorization-relevant fields compared for drift. */
const COMPARED_FIELDS = [
  "status", "bindingKey", "decisionReason", "decidedAt", "consumedAt",
  "revokedAt", "invalidatedAt", "expiresAt",
] as const;

export async function reconcileApprovalLedger(cwd: string): Promise<ApprovalReconcileReport> {
  const issues: ApprovalReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  const projection = await readApprovalProjection(cwd);
  const { events, truncated } = drainLedgerEvents(cwd, new Set(["approval"]));

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
        approvalId: record.id,
        kind: "missing_in_ledger",
        detail: "projection record with zero ledger facts (legacy pre-ledger approval)",
      });
      continue;
    }
    const last = evts[evts.length - 1];
    if (last.entityVersion !== evts.length) {
      issues.push({
        approvalId: record.id,
        kind: "version_behind",
        detail: `last entityVersion ${last.entityVersion} != event count ${evts.length}`,
      });
    }
    if (last.eventType === "approval.removed") {
      issues.push({
        approvalId: record.id,
        kind: "projection_stale",
        detail: "ledger removed this approval but it is still in the projection",
      });
      continue;
    }
    const payload = last.payload as { approval?: ApprovalRecord } | null;
    if (!payload?.approval) {
      issues.push({
        approvalId: record.id,
        kind: "ledger_payload_invalid",
        detail: "live approval event missing approval payload",
      });
      continue;
    }
    const ledgerRecord = payload.approval;
    for (const field of COMPARED_FIELDS) {
      const jsonValue = (record as unknown as Record<string, unknown>)[field];
      const ledgerValue = (ledgerRecord as unknown as Record<string, unknown>)[field];
      if (jsonValue !== ledgerValue) {
        issues.push({
          approvalId: record.id,
          kind: "record_mismatch",
          detail: `${field}: json=${JSON.stringify(jsonValue)} ledger=${JSON.stringify(ledgerValue)} (ledger authoritative)`,
        });
      }
    }
  }

  for (const [entityId, evts] of byEntity) {
    const last = evts[evts.length - 1];
    if (last.eventType === "approval.removed") continue;
    liveEntities += 1;
    if (projectionIds.has(entityId)) continue;
    const payload = last.payload as { approval?: ApprovalRecord } | null;
    if (!payload?.approval) {
      issues.push({
        approvalId: entityId,
        kind: "ledger_payload_invalid",
        detail: "live approval event missing approval payload",
      });
      continue;
    }
    issues.push({
      approvalId: entityId,
      kind: "projection_missing",
      detail: "live ledger approval absent from the projection (write failed or file lost)",
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
