// src/runtime-state/storage/runtime-ledger.ts
//
// R2 transactional runtime ledger — SQLite, project-scoped
// (`<cwd>/.alix/runtime-ledger.db`).
//
// One transaction per append writes, in order:
//   1. entity precondition (optimistic version check, no FOR UPDATE in
//      SQLite — a write transaction + version-checked UPDATE instead)
//   2. the canonical RuntimeEvent
//   3. the bumped entity version row
//   4. a durable outbox notification row
//
// Atomicity is the point: a crash can never leave a snapshot ahead of
// history (the JSONL `store.save() -> eventLog.append()` defect R0 found)
// nor an event whose entity version never committed.
//
// Shared domain-facing helpers live here too, so the append/replay
// boilerplate every migrated store re-implemented lands once:
//   - `appendFact` builds the R2 envelope, applies the optimistic
//     precondition, accounts the result on a caller-owned counter object,
//     and throws on failure (fail-closed: no JSON-only mutation).
//   - `drainLedgerEvents` pages the whole ledger with a cursor that always
//     advances, filtering to a domain's entity types.
//
// Storage-level only: no domain vocabulary, no validation of payload
// contents — see src/runtime-state/storage/AGENTS.md.

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
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
   * Latest event for one entity (authority read). Null when the entity has
   * no ledger facts (legacy/pre-ledger). `entityType` scopes the lookup when
   * id spaces of different domains could overlap — always pass it if the
   * domain shares ids with another (e.g. coordination runId vs collab runId).
   * Throws only on genuine db errors — authoritative callers must not mask those.
   */
  lastEvent(entityId: string, entityType?: string): (RuntimeEvent & { ledgerSeq: number }) | null {
    const row = entityType !== undefined
      ? this.db
          .prepare("SELECT * FROM runtime_events WHERE entity_id = ? AND entity_type = ? ORDER BY ledger_seq DESC LIMIT 1")
          .get(entityId, entityType) as Record<string, unknown> | undefined
      : this.db
          .prepare("SELECT * FROM runtime_events WHERE entity_id = ? ORDER BY ledger_seq DESC LIMIT 1")
          .get(entityId) as Record<string, unknown> | undefined;
    return row ? this.rowToEvent(row) : null;
  }

  /**
   * Latest event per entity for one entity type — the authority snapshot set
   * used to reconstruct a domain without touching its legacy store.
   */
  readLatestByEntityType(entityType: string): Array<RuntimeEvent & { ledgerSeq: number }> {
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY entity_id ORDER BY ledger_seq DESC) AS rn
        FROM runtime_events WHERE entity_type = ?
      ) WHERE rn = 1 ORDER BY ledger_seq ASC
    `).all(entityType) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEvent(r));
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

  /**
   * Undelivered outbox rows — the durable notification queue each append
   * enqueues into. Exposed as a primitive for a future projection consumer;
   * no production projector claims it today (projections are written inline
   * by their stores), so it is exercised by tests only.
   */
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

/**
 * Close and forget EVERY cached ledger. Tests that remove a workspace temp
 * dir must call this first: Windows refuses to unlink a SQLite file that an
 * open connection still holds (`EBUSY`), where POSIX silently unlinks it.
 */
export function closeAllSharedLedgers(): void {
  for (const ledger of sharedLedgers.values()) {
    try {
      ledger.close();
    } catch {
      /* already closed */
    }
  }
  sharedLedgers.clear();
}

// ── Shared domain-facing helpers ─────────────────────────────────────
// Every migrated domain re-implemented the same envelope construction and
// status accounting; one copy here keeps the fail-closed contract uniform.

/** A drained ledger event, decoupled from the SQL row shape. */
export interface LedgerEventRow {
  eventType: string;
  entityType: string;
  entityId: string;
  sessionId?: string;
  entityVersion: number;
  payload: unknown;
  ledgerSeq: number;
}

/**
 * Page the whole ledger, returning only `entityTypes` rows, bounded by
 * `maxPages * pageSize`. The cursor ALWAYS advances to the last row read —
 * a page with no matches must not re-read itself (that defect made every
 * reconcile on a shared multi-domain ledger report false `truncated`).
 */
export function drainLedgerEvents(
  cwd: string,
  entityTypes: ReadonlySet<string>,
  maxPages = 50,
  pageSize = 2000,
): { events: LedgerEventRow[]; truncated: boolean } {
  const ledger = getSharedLedger(cwd);
  const events: LedgerEventRow[] = [];
  let cursor = 0;
  for (let page = 0; page < maxPages; page++) {
    const rows = ledger.readEvents({ sinceSeq: cursor, limit: pageSize });
    if (rows.length === 0) return { events, truncated: false };
    for (const r of rows) {
      cursor = r.ledgerSeq;
      if (!entityTypes.has(r.entityType)) continue;
      events.push({
        eventType: r.eventType,
        entityType: r.entityType,
        entityId: r.entityId,
        sessionId: r.sessionId,
        entityVersion: r.entityVersion,
        payload: r.payload,
        ledgerSeq: r.ledgerSeq,
      });
    }
    if (rows.length < pageSize) return { events, truncated: false };
  }
  return { events, truncated: true };
}

/** Mutable append accounting a domain owns (module- or instance-scoped). */
export interface LedgerFactCounters {
  appends: number;
  failures: number;
  lastError?: string;
}

export interface AppendFactInput {
  eventType: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  correlationId: string;
  actor: RuntimeEvent["actor"];
  occurredAt: string;
  sessionId?: string;
  runId?: string;
  coordinationRunId?: string;
  agentId?: string;
  taskId?: string;
  causationId?: string;
  /** Optimistic precondition; default = current committed version. */
  expectedVersion?: number;
  /** Version to write; default `expectedVersion + 1` (immutable appends pass 1). */
  entityVersion?: number;
  /** Error-message prefix, e.g. "approval ledger". */
  errorLabel: string;
}

/**
 * Append one domain fact — THE COMMIT. Builds the R2 envelope, applies the
 * optimistic precondition, records the outcome on `counters` (appends on
 * success; failures + lastError on any failure), and throws on failure so an
 * unavailable ledger can never leave a JSON-only mutation behind.
 */
/**
 * Read the current committed entity version, accounting a db-open/read
 * failure on `counters` and rethrowing. Use where the event type depends on
 * whether the entity already exists (callers still call `appendFact`).
 */
export function currentEntityVersion(cwd: string, counters: LedgerFactCounters, entityId: string): number {
  try {
    return getSharedLedger(cwd).entityVersion(entityId);
  } catch (err) {
    counters.failures += 1;
    counters.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

export function appendFact(
  cwd: string,
  counters: LedgerFactCounters,
  input: AppendFactInput,
): { entityVersion: number; ledgerSeq: number } {
  let res: LedgerAppendResult;
  try {
    const ledger = getSharedLedger(cwd);
    const expected = input.expectedVersion ?? ledger.entityVersion(input.entityId);
    res = ledger.append({
      event: {
        eventId: randomUUID(),
        eventType: input.eventType,
        schemaVersion: 1,
        entityType: input.entityType,
        entityId: input.entityId,
        entityVersion: input.entityVersion ?? expected + 1,
        correlationId: input.correlationId,
        ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
        ...(input.runId !== undefined ? { runId: input.runId } : {}),
        ...(input.coordinationRunId !== undefined ? { coordinationRunId: input.coordinationRunId } : {}),
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
        actor: input.actor,
        occurredAt: input.occurredAt,
        recordedAt: new Date().toISOString(),
        payload: input.payload,
      },
      expectedVersion: expected,
    });
  } catch (err) {
    counters.failures += 1;
    counters.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
  if (res.ok) {
    counters.appends += 1;
    return { entityVersion: res.entityVersion, ledgerSeq: res.ledgerSeq };
  }
  counters.failures += 1;
  counters.lastError = `${res.reason}: ${res.detail}`;
  throw new Error(`${input.errorLabel} append failed (${res.reason}): ${res.detail}`);
}
