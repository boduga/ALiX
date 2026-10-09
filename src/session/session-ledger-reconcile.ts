// src/session/session-ledger-reconcile.ts
//
// R2.18 — compare session persistence artifacts (messages.jsonl, scope.json,
// state.json under `.alix/sessions/<id>/`) against the transactional ledger.
// Read-only. Counts unknown event types and reports read truncation (R2
// exit conditions).
//
// Issue kinds (per session):
//   missing_in_ledger — projection record with no ledger facts (legacy)
//   record_mismatch   — scope/state JSON differs from the ledger fact
//   projection_missing — live ledger fact with no projection line/file
//   message_count     — message index coverage differs
//   version_behind    — sessionMessage entity version ≠ event count
//   ledger_payload_invalid — live event missing its payload

import { readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SESSION_LEDGER_EVENT_TYPES, sessionScopeEntityId, sessionStateEntityId } from "./persist.js";
import { drainLedgerEvents, type LedgerEventRow } from "../runtime-state/storage/runtime-ledger.js";
import { streamJsonlLines } from "../runtime-state/storage/jsonl-store.js";

export type SessionReconcileIssueKind =
  | "missing_in_ledger"
  | "record_mismatch"
  | "projection_missing"
  | "message_count"
  | "version_behind"
  | "ledger_payload_invalid";

export interface SessionReconcileIssue {
  sessionId: string;
  kind: SessionReconcileIssueKind;
  detail: string;
}

export interface SessionReconcileReport {
  scannedSessions: number;
  scannedMessages: number;
  ledgerMessageFacts: number;
  ledgerEventsRead: number;
  issues: SessionReconcileIssue[];
  unknownEventTypes: Record<string, number>;
  truncated: boolean;
  ok: boolean;
}

const KNOWN_TYPES = new Set<string>(SESSION_LEDGER_EVENT_TYPES);
const SESSION_TYPES = new Set(["sessionMessage", "sessionScope", "sessionState"]);

export async function reconcileSessionLedger(cwd: string): Promise<SessionReconcileReport> {
  const issues: SessionReconcileIssue[] = [];
  const unknownEventTypes: Record<string, number> = {};

  const sessionsDir = join(cwd, ".alix", "sessions");
  const sessionIds: string[] = existsSync(sessionsDir)
    ? (await readdir(sessionsDir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name)
    : [];

  const { events, truncated } = drainLedgerEvents(cwd, SESSION_TYPES);
  for (const e of events) {
    if (!KNOWN_TYPES.has(e.eventType)) {
      unknownEventTypes[e.eventType] = (unknownEventTypes[e.eventType] ?? 0) + 1;
    }
  }

  const messagesBySession = new Map<string, Array<{ entityId: string; index?: number; payload: unknown; entityVersion: number; count: number }>>();
  const latestByEntity = new Map<string, LedgerEventRow>();
  const versionsByEntity = new Map<string, number>();
  let ledgerMessageFacts = 0;
  for (const e of events) {
    versionsByEntity.set(e.entityId, (versionsByEntity.get(e.entityId) ?? 0) + 1);
    if (e.entityType === "sessionMessage") {
      ledgerMessageFacts += 1;
      const sid = e.sessionId ?? "";
      const payload = e.payload as { index?: number } | null;
      const list = messagesBySession.get(sid) ?? [];
      list.push({ entityId: e.entityId, index: payload?.index, payload: e.payload, entityVersion: e.entityVersion, count: 0 });
      messagesBySession.set(sid, list);
    } else if (e.entityType === "sessionScope" || e.entityType === "sessionState") {
      latestByEntity.set(e.entityId, e);
    }
  }

  let scannedMessages = 0;
  for (const sessionId of sessionIds) {
    const dir = join(sessionsDir, sessionId);

    // messages.jsonl — legacy lines without facts vs ledger index coverage
    const msgPath = join(dir, "messages.jsonl");
    let fileLineCount = 0;
    if (existsSync(msgPath)) {
      for await (const { line } of streamJsonlLines(msgPath)) {
        if (line.trim()) fileLineCount += 1;
      }
    }
    scannedMessages += fileLineCount;
    const facts = messagesBySession.get(sessionId) ?? [];
    const factIndexes = new Set(facts.map(f => f.index).filter((i): i is number => typeof i === "number"));
    if (fileLineCount > 0 && facts.length === 0) {
      issues.push({ sessionId, kind: "missing_in_ledger", detail: `${fileLineCount} message line(s) with zero ledger facts (legacy pre-ledger session)` });
    } else {
      for (let i = 0; i < fileLineCount; i++) {
        if (!factIndexes.has(i)) {
          issues.push({ sessionId, kind: "missing_in_ledger", detail: `message index ${i} present in messages.jsonl but not mirrored` });
        }
      }
      const maxFactIndex = factIndexes.size > 0 ? Math.max(...factIndexes) : -1;
      for (let i = 0; i <= maxFactIndex; i++) {
        if (!factIndexes.has(i)) {
          issues.push({ sessionId, kind: "message_count", detail: `message index ${i} mirrored in the ledger but missing from messages.jsonl` });
        }
      }
    }
    for (const f of facts) {
      if (typeof f.index === "number" && (versionsByEntity.get(f.entityId) ?? 0) !== f.entityVersion) {
        issues.push({ sessionId, kind: "version_behind", detail: `entity ${f.entityId}: version ${f.entityVersion} != event count ${versionsByEntity.get(f.entityId)}` });
      }
    }

    // scope.json / state.json
    const compareSnapshot = (file: string, entityId: string, label: string, extract: (payload: unknown) => unknown): void => {
      const path = join(dir, file);
      const last = latestByEntity.get(entityId);
      const fileExists = existsSync(path);
      if (!last) {
        if (fileExists) {
          issues.push({ sessionId, kind: "missing_in_ledger", detail: `${file} exists with zero ledger facts (legacy pre-ledger session)` });
        }
        return;
      }
      const payload = last.payload as Record<string, unknown> | null;
      const ledgerValue = payload ? extract(payload) : undefined;
      if (ledgerValue === undefined) {
        issues.push({ sessionId, kind: "ledger_payload_invalid", detail: `live ${label} event missing payload` });
        return;
      }
      if (!fileExists) {
        issues.push({ sessionId, kind: "projection_missing", detail: `live ledger ${label} fact has no ${file}` });
        return;
      }
      try {
        const fileValue = JSON.parse(readFileSync(path, "utf-8"));
        if (JSON.stringify(fileValue) !== JSON.stringify(ledgerValue)) {
          issues.push({ sessionId, kind: "record_mismatch", detail: `${file} differs from the ledger ${label} fact (ledger authoritative)` });
        }
      } catch {
        issues.push({ sessionId, kind: "record_mismatch", detail: `${file} unreadable while a live ledger ${label} fact exists` });
      }
    };
    compareSnapshot("scope.json", sessionScopeEntityId(sessionId), "scope", (p) => (p as { scope?: unknown }).scope);
    compareSnapshot("state.json", sessionStateEntityId(sessionId), "state", (p) => (p as { state?: unknown }).state);
  }

  // Ledger-side: facts for sessions with no projection dir at all.
  const sessionSet = new Set(sessionIds);
  for (const e of events) {
    const sid = e.sessionId ?? "";
    if (!sid || sessionSet.has(sid)) continue;
    issues.push({ sessionId: sid, kind: "projection_missing", detail: `live ledger ${e.entityType} fact has no session directory` });
  }

  issues.sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.kind.localeCompare(b.kind));
  return {
    scannedSessions: sessionIds.length,
    scannedMessages,
    ledgerMessageFacts,
    ledgerEventsRead: events.length,
    issues,
    unknownEventTypes,
    truncated,
    ok: issues.length === 0 && !truncated,
  };
}
