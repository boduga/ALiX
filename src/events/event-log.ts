import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { AlixEvent, NewEvent } from "./types.js";

type EventListener = (event: AlixEvent) => void;

// Runtime symbol (NOT `declare`): the computed property key below is evaluated
// at runtime, so the brand must be a real binding. Symbol-keyed properties are
// invisible to `Object.keys`, `for...in`, and JSON — the D1 opacity test relies
// on this (cursor exposes no `.seq`/`.owner`, and `Object.keys(cursor) === []`).
const eventLogCursorBrand: unique symbol = Symbol('eventLogCursorBrand');

/** Opaque, log-local position marker. Belongs to exactly one EventLog
 *  instance; consumers obtain/store/compare/pass back — never read internals.
 *  A cursor from another log is rejected by `readSince` (owner mismatch) and
 *  `cursorsEqual` returns false for it. */
export type EventLogCursor = { readonly [eventLogCursorBrand]: true };

interface InternalEventLogCursor {
  readonly seq: number;
  readonly owner: symbol;
}

/** Internals are stored off-object in a WeakMap so the cursor object exposes
 *  no readable properties at runtime (D1): even a `cursor as any` cannot read
 *  `.seq` or `.owner`. */
const cursorInternals = new WeakMap<object, InternalEventLogCursor>();

/** Durable cursor serialization format version. Bump on incompatible changes. */
const SERIALIZED_CURSOR_VERSION = 1;

interface SerializedCursor {
  readonly version: number;
  readonly seq: number;
}

/** Thrown by `deserializeCursor` and `readSince` for cursor-validation
 *  failures (malformed JSON, unsupported version, invalid payload, or a
 *  serialized position that lies beyond the current EventLog head). Callers
 *  discriminate on `instanceof EventLogCursorError` to distinguish an
 *  invalid-cursor fallback (replay from `beginningCursor()`) from an
 *  operational failure (preserve current state, retry next sample). */
export class EventLogCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventLogCursorError';
  }
}

export class EventLog {
  readonly path: string;
  private nextSeq = 1;
  private watchers: EventListener[] = [];
  private readonly owner = Symbol('EventLogCursorOwner');

  constructor(readonly sessionDir: string) {
    this.path = join(sessionDir, "events.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const events = await this.readAll();
    this.nextSeq = events.reduce((max, e) => Math.max(max, e.seq ?? 0), 0) + 1;
  }

  /** The position before the first event — the start for full replay. */
  beginningCursor(): EventLogCursor {
    return this.makeCursor(0);
  }

  /** The current head cursor (for callers that want to skip existing history). */
  getCursor(): EventLogCursor {
    return this.makeCursor(this.nextSeq - 1);
  }

  /** Events with seq > cursor.seq, ascending. Returned cursor = highest seq
   *  successfully included (at-least-once: retrying from the input cursor
   *  re-reads the same events). Throws `EventLogCursorError` if the cursor
   *  position lies beyond the current EventLog head (a sibling/truncated log
   *  checkpoint against an active log) — the caller should fall back to
   *  `beginningCursor()` rather than silently skip events. Throws a plain
   *  `Error` if the cursor belongs to another log. */
  async readSince(cursor: EventLogCursor): Promise<{
    readonly events: readonly AlixEvent[];
    readonly cursor: EventLogCursor;
  }> {
    const internal = this.unwrap(cursor);
    if (internal.seq > this.currentHead()) {
      throw new EventLogCursorError('Cursor position is beyond the current EventLog head');
    }
    const events = await this.readAll();
    const newer = events.filter(e => (e.seq ?? 0) > internal.seq);
    const lastSeq = newer.length > 0 ? (newer[newer.length - 1]!.seq ?? internal.seq) : internal.seq;
    return { events: newer, cursor: this.makeCursor(lastSeq) };
  }

  /** Equality helper. Log-local: returns false (never throws) for a foreign
   *  cursor or a cursor this log does not own. */
  cursorsEqual(a: EventLogCursor, b: EventLogCursor): boolean {
    const ia = this.tryUnwrap(a);
    const ib = this.tryUnwrap(b);
    if (!ia || !ib) return false;
    return ia.seq === ib.seq;
  }

  /** Serialize a cursor for durable storage. Opaque — only meaningful to this
   *  EventLog. The representation is a POSITION CLAIM, not a transferable
   *  cursor: no owner token is persisted, so a restored cursor carries THIS
   *  instance's owner symbol. seq is never exposed through the public API —
   *  it is only handled inside serialize/deserialize. */
  serializeCursor(cursor: EventLogCursor): string {
    const internal = this.unwrap(cursor);
    const payload: SerializedCursor = { version: SERIALIZED_CURSOR_VERSION, seq: internal.seq };
    return JSON.stringify(payload);
  }

  /** Restore a cursor owned by this EventLog. Has exactly four failure modes,
   *  all of which throw `EventLogCursorError`:
   *    1. malformed JSON (e.g. corrupted file, partial write),
   *    2. unsupported version (a future migration landed with a different `version`),
   *    3. invalid payload (a missing/non-integer/negative `seq`),
   *    4. cursor position beyond the current EventLog head (a sibling or
   *       truncated log checkpoint with `seq > current head`; without this
   *       check the caller would silently skip events because `readSince`
   *       filters on `seq > cursor.seq`).
   *  Callers discriminate via `instanceof EventLogCursorError` to fall back
   *  to `beginningCursor()` (deterministic full replay) on any of the four.
   *  The restored cursor is created via `makeCursor`, so it carries THIS
   *  instance's owner token — a serialized cursor from another log is
   *  rejected by `unwrap`/`readSince` as foreign. */
  deserializeCursor(serialized: string): EventLogCursor {
    let parsed: Partial<SerializedCursor>;
    try {
      parsed = JSON.parse(serialized) as Partial<SerializedCursor>;
    } catch {
      // JSON.parse throws a SyntaxError for malformed input; we re-throw
      // as the dedicated EventLogCursorError so callers can discriminate
      // on `instanceof` and treat it as an invalid-cursor fallback rather
      // than an operational error.
      throw new EventLogCursorError('Malformed serialized cursor');
    }
    if (typeof parsed !== 'object' || parsed === null) throw new EventLogCursorError('Malformed serialized cursor');
    if (parsed.version !== SERIALIZED_CURSOR_VERSION) throw new EventLogCursorError(`Unknown serialized cursor version: ${String(parsed.version)}`);
    const seq = parsed.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) throw new EventLogCursorError('Malformed serialized cursor seq');
    if (seq > this.currentHead()) throw new EventLogCursorError('Serialized cursor position is beyond the current EventLog head');
    return this.makeCursor(seq);
  }

  /** Highest seq assigned by this EventLog so far (contiguous from 1 on
   *  append). Returns 0 before any event has been appended. Used by
   *  `deserializeCursor` and `readSince` to reject checkpoints whose `seq`
   *  exceeds the active log head — those would otherwise silently skip
   *  events because `readSince` filters on `seq > cursor.seq`. */
  private currentHead(): number {
    return this.nextSeq - 1;
  }

  private makeCursor(seq: number): EventLogCursor {
    const cursor = { [eventLogCursorBrand]: true } as EventLogCursor;
    cursorInternals.set(cursor, { seq, owner: this.owner });
    return cursor;
  }

  /** Throws on a cursor this log does not own. */
  private unwrap(cursor: EventLogCursor): InternalEventLogCursor {
    const internal = this.tryUnwrap(cursor);
    if (!internal) throw new Error('EventLogCursor belongs to a different EventLog instance');
    return internal;
  }

  /** Returns null (not throw) for a foreign cursor or a non-object input (primitive/null), so `cursorsEqual` never throws. */
  private tryUnwrap(cursor: EventLogCursor): InternalEventLogCursor | null {
    if (typeof cursor !== 'object' || cursor === null) return null;
    const internal = cursorInternals.get(cursor);
    if (!internal || internal.owner !== this.owner) return null;
    return internal;
  }

  async append<TType extends string, TPayload>(
    event: NewEvent<TType, TPayload>
  ): Promise<AlixEvent<TType, TPayload>> {
    // Self-correcting seq allocation: re-sync nextSeq from disk before every
    // append. This prevents collisions when more than one EventLog instance
    // points at the same sessionDir (e.g. the TUI's timelineEmitter and the
    // agent's runTaskLoop both creating new EventLog instances). The cost is
    // one readFileSync per append; sub-millisecond for typical sessions
    // (hundreds of events) and strictly correct across any number of writers.
    //
    // Without this, init()'s reduce-based nextSeq computation runs once per
    // instance. Two instances can both compute the same nextSeq, append
    // simultaneously, and produce duplicate seqs in the same file —
    // observed in alix-init-test session 1786002949079 where session.started
    // and agent.response shared seq=6 across two EventLog writers.
    await this.resyncFromDisk();
    const fullEvent: AlixEvent<TType, TPayload> = {
      ...event,
      id: randomUUID(),
      seq: this.nextSeq++,
      version: 1,
      timestamp: new Date().toISOString()
    };
    await appendFile(this.path, `${JSON.stringify(fullEvent)}\n`, "utf8");
    // Notify all watchers
    for (const listener of this.watchers) {
      try { listener(fullEvent); } catch { /* ignore listener errors */ }
    }
    return fullEvent;
  }

  /** Re-sync nextSeq from the durable file. Called by append() before every
   *  write to defend against multi-instance writers. No-op if the in-memory
   *  counter is already at-or-ahead of the file's max seq (the common case
   *  for the only-writer scenario, where this is just a 1-line file read). */
  private async resyncFromDisk(): Promise<void> {
    if (!existsSync(this.path)) return;
    const text = await readFile(this.path, "utf8");
    let maxSeq = 0;
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as { seq?: number };
        if (typeof e.seq === 'number' && e.seq > maxSeq) maxSeq = e.seq;
      } catch {
        // Skip malformed lines (e.g. partial write from a crashed prior process).
      }
    }
    if (maxSeq + 1 > this.nextSeq) this.nextSeq = maxSeq + 1;
  }

  async readAll(): Promise<AlixEvent[]> {
    if (!existsSync(this.path)) return [];
    const text = await readFile(this.path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try { return [JSON.parse(line) as AlixEvent]; }
        catch { return []; }
      });
  }

  async close(): Promise<void> {
    // No-op: all file operations are already complete after append
    // Keep for interface compatibility
  }

  /**
   * Watch for new events appended to the log.
   * Returns a stop function to stop watching.
   */
  watch(listener: EventListener): () => void {
    this.watchers.push(listener);
    return () => {
      this.watchers = this.watchers.filter(w => w !== listener);
    };
  }

  /**
   * Start watching the event log file for changes.
   * Calls the listener with new events as they are appended.
   * Returns a stop function.
   */
  async startWatching(listener: EventListener): Promise<() => void> {
    let position = 0;
    if (existsSync(this.path)) {
      const text = await readFile(this.path, "utf8");
      position = text.length;
    }

    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (stopped || !existsSync(this.path)) break;
        try {
          const text = await readFile(this.path, "utf8");
          if (text.length > position) {
            const newText = text.slice(position);
            position = text.length;
            for (const line of newText.split("\n").filter(Boolean)) {
              try {
                listener(JSON.parse(line) as AlixEvent);
              } catch { /* ignore parse errors */ }
            }
          }
        } catch { /* ignore read errors */ }
      }
    };

    poll(); // Start polling (non-blocking)

    return () => {
      stopped = true;
    };
  }
}
