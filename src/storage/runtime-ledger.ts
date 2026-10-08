// src/storage/runtime-ledger.ts
//
// R2 transactional runtime ledger — SQLite, project-scoped
// (`<cwd>/.alix/runtime-ledger.db`).
//
// One transaction per append writes, in order:
//   1. entity precondition (optimistic version check, no FOR UPDATE in
//      SQLite — a write transaction + version-checked UPDATE instead)
//   2. the canonical RuntimeEvent
//   3. the bumped entity version row
//   4. an outbox row for projection notification
//
// Atomicity is the point: a crash can never leave a snapshot ahead of
// history (the JSONL `store.save() -> eventLog.append()` defect R0 found)
// nor an event whose entity version never committed. Storage-level only:
// no domain vocabulary, no validation of payload contents — see
// src/storage/AGENTS.md.

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeEvent } from "../contracts/runtime-event.js";

/** Result of one ledger append. */
export type LedgerAppendResult =
  | { ok: true; entityVersion: number; ledgerSeq: number }
  | { ok: false; reason: "version_conflict" | "duplicate_event" | "invalid_precondition"; detail: string };

export interface LedgerAppendInput {
  event: RuntimeEvent;
  /**
   * Optimistic concurrency precondition: the entity version the caller
   * believes is current (0 = entity does not exist yet / genesis).
   * Mismatch rolls back everything — never partial state.
   */
  expectedVersion: number;
}

export interface RuntimeLedgerOptions {
  /** Absolute path of the SQLite file. */
  dbPath: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runtime_events (
  ledger_seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE,
  event_type    TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  entity_version INTEGER NOT NULL,
  run_id        TEXT,
  session_id    TEXT,
  coordination_run_id TEXT,
  agent_id      TEXT,
  task_id       TEXT,
  causation_id  TEXT,
  correlation_id TEXT NOT NULL,
  actor_type    TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  occurred_at   TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  payload_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runtime_events_entity
  ON runtime_events(entity_id, entity_version);
CREATE INDEX IF NOT EXISTS idx_runtime_events_run
  ON runtime_events(run_id);

CREATE TABLE IF NOT EXISTS runtime_entities (
  entity_id     TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_outbox (
  outbox_seq    INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE REFERENCES runtime_events(event_id),
  created_at    TEXT NOT NULL,
  delivered_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_runtime_outbox_undelivered
  ON runtime_outbox(delivered_at);
`;

export class RuntimeLedger {
  private readonly db: Database.Database;

  constructor(opts: RuntimeLedgerOptions) {
    const dir = dirname(opts.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(opts.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // Multi-process writers (scheduler + CLI + Inspector hosts) share the
    // project ledger file; wait instead of failing on a locked database.
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SCHEMA);
  }

  /**
   * Append one fact atomically. Returns the post-append entity version and
   * the ledger-global sequence. Any precondition failure rolls back the
   * whole transaction — event, entity row, and outbox move together or
   * not at all.
   */
  append(input: LedgerAppendInput): LedgerAppendResult {
    const { event, expectedVersion } = input;
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return { ok: false, reason: "invalid_precondition", detail: `expectedVersion must be a non-negative integer, got ${expectedVersion}` };
    }

    const tx = this.db.transaction((): LedgerAppendResult => {
      const current = this.db
        .prepare("SELECT version FROM runtime_entities WHERE entity_id = ?")
        .get(event.entityId) as { version: number } | undefined;
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== expectedVersion) {
        return {
          ok: false,
          reason: "version_conflict",
          detail: `entity ${event.entityId}: expected v${expectedVersion}, current v${currentVersion}`,
        };
      }
      const nextVersion = currentVersion + 1;
      if (event.entityVersion !== nextVersion) {
        return {
          ok: false,
          reason: "invalid_precondition",
          detail: `event entityVersion ${event.entityVersion} must equal expectedVersion+1 (${nextVersion})`,
        };
      }

      try {
        this.db.prepare(`
          INSERT INTO runtime_events (
            event_id, event_type, schema_version, entity_type, entity_id,
            entity_version, run_id, session_id, coordination_run_id, agent_id,
            task_id, causation_id, correlation_id, actor_type, actor_id,
            occurred_at, recorded_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          event.eventId, event.eventType, event.schemaVersion, event.entityType,
          event.entityId, event.entityVersion, event.runId ?? null,
          event.sessionId ?? null, event.coordinationRunId ?? null,
          event.agentId ?? null, event.taskId ?? null, event.causationId ?? null,
          event.correlationId, event.actor.type, event.actor.id,
          event.occurredAt, event.recordedAt, JSON.stringify(event.payload ?? null),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("UNIQUE") && message.includes("event_id")) {
          return { ok: false, reason: "duplicate_event", detail: `event ${event.eventId} already appended` };
        }
        throw err;
      }

      if (current) {
        const upd = this.db
          .prepare("UPDATE runtime_entities SET version = ?, updated_at = ? WHERE entity_id = ? AND version = ?")
          .run(nextVersion, event.recordedAt, event.entityId, expectedVersion);
        if (upd.changes !== 1) {
          // Impossible inside the write transaction — belt-and-braces.
          throw new Error(`version row for ${event.entityId} changed concurrently`);
        }
      } else {
        this.db
          .prepare("INSERT INTO runtime_entities (entity_id, entity_type, version, updated_at) VALUES (?, ?, ?, ?)")
          .run(event.entityId, event.entityType, nextVersion, event.recordedAt);
      }

      this.db
        .prepare("INSERT INTO runtime_outbox (event_id, created_at) VALUES (?, ?)")
        .run(event.eventId, event.recordedAt);

      const ledgerSeq = (this.db
        .prepare("SELECT ledger_seq FROM runtime_events WHERE event_id = ?")
        .get(event.eventId) as { ledger_seq: number }).ledger_seq;
      return { ok: true, entityVersion: nextVersion, ledgerSeq };
    });

    return tx();
  }

  /** Current committed version for an entity (0 when unknown). */
  entityVersion(entityId: string): number {
    const row = this.db
      .prepare("SELECT version FROM runtime_entities WHERE entity_id = ?")
      .get(entityId) as { version: number } | undefined;
    return row?.version ?? 0;
  }

  /**
   * Replay in ledger-global order. Cursor is `ledger_seq` (opaque to
   * callers beyond "greater than"). Rows are returned as full envelopes
   * so a projector can rebuild without consulting any other store.
   */
  readEvents(opts: { sinceSeq?: number; entityId?: string; limit?: number } = {}): Array<RuntimeEvent & { ledgerSeq: number }> {
    const since = opts.sinceSeq ?? 0;
    const limit = Math.max(1, Math.min(opts.limit ?? 1000, 10_000));
    const rows = opts.entityId
      ? this.db.prepare(
          "SELECT * FROM runtime_events WHERE ledger_seq > ? AND entity_id = ? ORDER BY ledger_seq ASC LIMIT ?",
        ).all(since, opts.entityId, limit)
      : this.db.prepare(
          "SELECT * FROM runtime_events WHERE ledger_seq > ? ORDER BY ledger_seq ASC LIMIT ?",
        ).all(since, limit);
    return (rows as Record<string, unknown>[]).map((r) => this.rowToEvent(r));
  }

  /** Undelivered outbox rows (projection notification queue). */
  claimOutbox(limit = 100): Array<{ outboxSeq: number; eventId: string }> {
    const rows = this.db
      .prepare("SELECT outbox_seq, event_id FROM runtime_outbox WHERE delivered_at IS NULL ORDER BY outbox_seq ASC LIMIT ?")
      .all(Math.max(1, Math.min(limit, 1000))) as { outbox_seq: number; event_id: string }[];
    return rows.map((r) => ({ outboxSeq: r.outbox_seq, eventId: r.event_id }));
  }

  markDelivered(outboxSeq: number, at: string): void {
    this.db
      .prepare("UPDATE runtime_outbox SET delivered_at = ? WHERE outbox_seq = ? AND delivered_at IS NULL")
      .run(at, outboxSeq);
  }

  close(): void {
    this.db.close();
  }

  private rowToEvent(r: Record<string, unknown>): RuntimeEvent & { ledgerSeq: number } {
    return {
      ledgerSeq: r.ledger_seq as number,
      eventId: r.event_id as string,
      eventType: r.event_type as string,
      schemaVersion: r.schema_version as number,
      entityType: r.entity_type as string,
      entityId: r.entity_id as string,
      entityVersion: r.entity_version as number,
      runId: (r.run_id as string | null) ?? undefined,
      sessionId: (r.session_id as string | null) ?? undefined,
      coordinationRunId: (r.coordination_run_id as string | null) ?? undefined,
      agentId: (r.agent_id as string | null) ?? undefined,
      taskId: (r.task_id as string | null) ?? undefined,
      causationId: (r.causation_id as string | null) ?? undefined,
      correlationId: r.correlation_id as string,
      actor: { type: r.actor_type as RuntimeEvent["actor"]["type"], id: r.actor_id as string },
      occurredAt: r.occurred_at as string,
      recordedAt: r.recorded_at as string,
      payload: JSON.parse(r.payload_json as string),
    };
  }
}

/** Canonical project-scoped ledger path. */
export function runtimeLedgerPath(cwd: string): string {
  return join(cwd, ".alix", "runtime-ledger.db");
}

// ── Shared connection cache ──────────────────────────────────────────
// Dual-write callers (CoordinationStore instances are constructed at many
// sites) open the ledger by cwd: one connection per path per process.
// WAL + busy_timeout make cross-process access safe; tests isolate by cwd.
const sharedLedgers = new Map<string, RuntimeLedger>();

export function getSharedLedger(cwd: string): RuntimeLedger {
  const key = runtimeLedgerPath(cwd);
  let ledger = sharedLedgers.get(key);
  if (!ledger) {
    ledger = new RuntimeLedger({ dbPath: key });
    sharedLedgers.set(key, ledger);
  }
  return ledger;
}

/** Close and forget the shared ledger for a cwd (tests / process shutdown). */
export function closeSharedLedger(cwd: string): void {
  const key = runtimeLedgerPath(cwd);
  const ledger = sharedLedgers.get(key);
  if (ledger) {
    sharedLedgers.delete(key);
    ledger.close();
  }
}
