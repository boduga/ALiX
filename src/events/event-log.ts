import { existsSync, watch, type FSWatcher } from "node:fs";
import { appendFile, mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { AlixEvent, NewEvent } from "./types.js";

type EventListener = (event: AlixEvent) => void;
const appendQueues = new Map<string, Promise<void>>();

/** Tail window used to recover the max seq without a full-file read. */
const RESYNC_TAIL_BYTES = 64 * 1024;

/** A lock older than this with no heartbeat refresh may be broken — but
 *  only when its owner is demonstrably dead (see shouldBreakLock). */
const STALE_LOCK_MS = 5_000;
/** How often a lock holder refreshes its heartbeat while appending. */
const LOCK_HEARTBEAT_MS = 1_000;

type EventLogLockContent = {
  pid: number;
  token: string;
  heartbeat: string;
};

/** True when no process with this PID exists (signal 0 is existence-only). */
function isPidDead(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === "ESRCH";
  }
}

/**
 * Decide whether a contended lock file may be broken. A lock is broken only
 * when its owner is demonstrably gone:
 *   - a lock whose heartbeat is fresh belongs to an active holder — never
 *     steal it, so a slow append is never robbed mid-write (no dup seq);
 *   - a lock with a stale heartbeat is broken only if its owner PID is dead
 *     (signal 0); an alive-but-stalled owner keeps the lock and we wait for
 *     the acquisition deadline instead of risking a duplicate seq;
 *   - legacy locks (empty/unparseable, written before owner metadata
 *     existed) fall back to mtime staleness.
 */
async function shouldBreakLock(lockPath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch {
    return false; // vanished — retry the acquire instead
  }
  let content: Partial<EventLogLockContent> | null = null;
  try {
    content = JSON.parse(raw) as Partial<EventLogLockContent>;
  } catch {
    content = null;
  }
  if (!content || typeof content.pid !== "number" || typeof content.token !== "string" || typeof content.heartbeat !== "string") {
    try {
      return Date.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS;
    } catch {
      return false;
    }
  }
  if (content.pid === process.pid) {
    // Our own process holds (or just held) this lock. The in-process append
    // queue serializes same-process writers, so a contender here means the
    // holder is live — never steal from ourselves.
    return false;
  }
  const heartbeatAge = Date.now() - new Date(content.heartbeat).getTime();
  if (!(heartbeatAge > STALE_LOCK_MS)) return false;
  return isPidDead(content.pid);
}

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
  /** Byte offset of the end of the log at the time this cursor was made.
   *  Undefined means "unknown" (restored/getCursor cursors) — the first
   *  `readSince` resolves it with one full read, then reads are incremental. */
  offset?: number;
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
    return this.makeCursor(0, 0);
  }

  /** The current head cursor (for callers that want to skip existing history). */
  getCursor(): EventLogCursor {
    return this.makeCursor(this.nextSeq - 1);
  }

  /** Events with seq > cursor.seq, ascending. Returned cursor = highest seq
   *  successfully included (at-least-once: retrying from the input cursor
   *  re-reads the same events). Reads only bytes appended since the cursor's
   *  recorded offset when known, falling back to a full read for unknown
   *  offsets or a truncated log. Throws `EventLogCursorError` if the cursor
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

    // Incremental path: a known offset that is still within the file.
    if (internal.offset !== undefined) {
      const tail = await this.readTailFrom(internal.offset);
      if (tail) {
        const events = tail.lines
          .flatMap((line) => {
            try { return [JSON.parse(line) as AlixEvent]; }
            catch { return []; }
          })
          .filter((e) => (e.seq ?? 0) > internal.seq);
        const lastSeq = events.length > 0 ? (events[events.length - 1]!.seq ?? internal.seq) : internal.seq;
        return { events, cursor: this.makeCursor(lastSeq, tail.end) };
      }
      // File shrank (rotation/truncation) — fall through to a full read.
    }

    const events = await this.readAll();
    const newer = events.filter(e => (e.seq ?? 0) > internal.seq);
    const lastSeq = newer.length > 0 ? (newer[newer.length - 1]!.seq ?? internal.seq) : internal.seq;
    const end = existsSync(this.path) ? (await stat(this.path)).size : 0;
    return { events: newer, cursor: this.makeCursor(lastSeq, end) };
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

  private makeCursor(seq: number, offset?: number): EventLogCursor {
    const cursor = { [eventLogCursorBrand]: true } as EventLogCursor;
    cursorInternals.set(cursor, { seq, owner: this.owner, ...(offset !== undefined ? { offset } : {}) });
    return cursor;
  }

  /** Read the log tail from a byte offset. Returns null when the file is
   *  missing or shorter than the offset (truncated/rotated). */
  private async readTailFrom(offset: number): Promise<{ lines: string[]; end: number } | null> {
    if (!existsSync(this.path)) return null;
    const st = await stat(this.path);
    if (offset > st.size) return null;
    const length = st.size - offset;
    if (length === 0) return { lines: [], end: st.size };
    const fd = await open(this.path, "r");
    try {
      const buf = Buffer.alloc(length);
      await fd.read(buf, 0, length, offset);
      return { lines: buf.toString("utf8").split("\n").filter(Boolean), end: st.size };
    } finally {
      await fd.close();
    }
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
    const lockPath = `${this.path}.lock`;
    const previous = appendQueues.get(this.path) ?? Promise.resolve();
    let releaseQueue!: () => void;
    const current = new Promise<void>((resolve) => { releaseQueue = resolve; });
    const queued = previous.then(() => current);
    appendQueues.set(this.path, queued);
    await previous;
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    let lockToken: string | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const stopHeartbeat = (): void => {
      if (heartbeatTimer !== undefined) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };
    const deadline = Date.now() + 5_000;
    let fullEvent: AlixEvent<TType, TPayload>;
    try {
      while (!lock) {
        try {
          lock = await open(lockPath, "wx", 0o600);
          // Record ownership so a contender can tell a live holder from a
          // dead one instead of blindly stealing by mtime.
          lockToken = randomUUID();
          const beat = (): string => new Date().toISOString();
          await lock.writeFile(JSON.stringify({ pid: process.pid, token: lockToken, heartbeat: beat() }));
          heartbeatTimer = setInterval(() => {
            writeFile(lockPath, JSON.stringify({ pid: process.pid, token: lockToken, heartbeat: beat() })).catch(() => {});
          }, LOCK_HEARTBEAT_MS);
          heartbeatTimer.unref?.();
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "EEXIST") throw error;
          let removedStaleLock = false;
          try {
            if (await shouldBreakLock(lockPath)) {
              await unlink(lockPath);
              removedStaleLock = true;
            }
          } catch { /* another writer released it */ }
          if (removedStaleLock) continue;
          if (Date.now() >= deadline) throw new Error(`Timed out acquiring EventLog append lock: ${lockPath}`);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      await this.resyncFromDisk();
      fullEvent = {
        ...event,
        id: randomUUID(),
        seq: this.nextSeq++,
        version: 1,
        timestamp: new Date().toISOString()
      };
      await appendFile(this.path, `${JSON.stringify(fullEvent)}\n`, "utf8");
    } finally {
      stopHeartbeat();
      if (lock) {
        await lock.close().catch(() => {});
        // Re-check ownership before unlinking: only remove the lock when it
        // is still ours, so we can never delete a peer's live lock.
        try {
          const raw = await readFile(lockPath, "utf8");
          const content = JSON.parse(raw) as Partial<EventLogLockContent>;
          if (content?.token === lockToken) {
            await unlink(lockPath).catch(() => {});
          }
        } catch { /* lock already gone or unreadable — leave it alone */ }
      }
      releaseQueue();
      if (appendQueues.get(this.path) === queued) appendQueues.delete(this.path);
    }
    // Notify all watchers
    for (const listener of this.watchers) {
      try { listener(fullEvent); } catch { /* ignore listener errors */ }
    }
    return fullEvent;
  }

  /** Re-sync nextSeq from the durable file. Called by append() before every
   *  write to defend against multi-instance writers. Reads only a bounded
   *  tail window (the last line holds the max seq) so append cost stays flat
   *  as the log grows; falls back to a full read only when the tail cannot
   *  be parsed (e.g. a single line larger than the window). */
  private async resyncFromDisk(): Promise<void> {
    if (!existsSync(this.path)) return;
    const maxSeq = await this.readMaxSeqFromTail();
    if (maxSeq === null) {
      await this.resyncFromFullRead();
      return;
    }
    if (maxSeq + 1 > this.nextSeq) this.nextSeq = maxSeq + 1;
  }

  /** Max seq from the last complete line in the tail window, or null when
   *  the tail is unparseable and a full read is required. */
  private async readMaxSeqFromTail(): Promise<number | null> {
    const st = await stat(this.path);
    if (st.size === 0) return 0;
    const window = Math.min(st.size, RESYNC_TAIL_BYTES);
    const fd = await open(this.path, "r");
    let text: string;
    try {
      const buf = Buffer.alloc(window);
      await fd.read(buf, 0, window, st.size - window);
      text = buf.toString("utf8");
    } finally {
      await fd.close();
    }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        const e = JSON.parse(line) as { seq?: number };
        if (typeof e.seq === "number") return e.seq;
      } catch {
        // Partial/truncated line — try the previous complete line.
      }
    }
    // If the window did not start at byte 0, the leading fragment may be an
    // incomplete line, but any complete line in the window would have parsed.
    // A null here means no complete line existed (single huge line) — fall
    // back to the full read.
    return null;
  }

  /** Full-file resync (rare fallback). */
  private async resyncFromFullRead(): Promise<void> {
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
   *
   * Uses `fs.watch` with a byte-offset tail read so a quiescent log costs
   * nothing beyond the watch registration (no repeated full reads). A slow
   * fallback poll (1s) covers platforms/filesystems where fs.watch misses
   * events; it also does a bounded tail read, never a full read.
   */
  async startWatching(listener: EventListener): Promise<() => void> {
    let position = existsSync(this.path) ? (await stat(this.path)).size : 0;
    let stopped = false;
    let watcher: FSWatcher | undefined;
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;

    const drain = async (): Promise<void> => {
      if (stopped || !existsSync(this.path)) return;
      try {
        const st = await stat(this.path);
        if (st.size < position) position = 0; // truncated/rotated
        if (st.size === position) return;
        const fd = await open(this.path, "r");
        try {
          const length = st.size - position;
          const buf = Buffer.alloc(length);
          await fd.read(buf, 0, length, position);
          position = st.size;
          for (const line of buf.toString("utf8").split("\n").filter(Boolean)) {
            try {
              listener(JSON.parse(line) as AlixEvent);
            } catch { /* ignore parse errors */ }
          }
        } finally {
          await fd.close();
        }
      } catch { /* ignore read errors */ }
    };

    // Prefer fs.watch; fall back to polling only when unavailable.
    try {
      watcher = watch(this.path, { persistent: false }, () => { void drain(); });
      watcher.on("error", () => { /* fall through to poll below */ });
    } catch {
      watcher = undefined;
    }

    if (watcher) {
      // fs.watch can miss events on some platforms — keep a cheap safety net
      // that only reads when the file actually grew.
      fallbackTimer = setInterval(() => { void drain(); }, 1_000);
      fallbackTimer.unref?.();
    } else {
      fallbackTimer = setInterval(() => { void drain(); }, 100);
      fallbackTimer.unref?.();
    }

    await drain(); // deliver anything appended between construction and watch

    return () => {
      stopped = true;
      if (fallbackTimer !== undefined) clearInterval(fallbackTimer);
      watcher?.close();
    };
  }
}
