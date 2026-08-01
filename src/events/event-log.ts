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
   *  re-reads the same events). Throws if the cursor belongs to another log. */
  async readSince(cursor: EventLogCursor): Promise<{
    readonly events: readonly AlixEvent[];
    readonly cursor: EventLogCursor;
  }> {
    const internal = this.unwrap(cursor);
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

  /** Restore a cursor owned by this EventLog. Throws for malformed JSON or an
   *  unknown version. The restored cursor is created via makeCursor, so it
   *  carries THIS instance's owner token — a serialized cursor from another
   *  log is rejected by unwrap/readSince as foreign. */
  deserializeCursor(serialized: string): EventLogCursor {
    const parsed = JSON.parse(serialized) as Partial<SerializedCursor>;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('Malformed serialized cursor');
    if (parsed.version !== SERIALIZED_CURSOR_VERSION) throw new Error(`Unknown serialized cursor version: ${String(parsed.version)}`);
    const seq = parsed.seq;
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) throw new Error('Malformed serialized cursor seq');
    return this.makeCursor(seq);
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
