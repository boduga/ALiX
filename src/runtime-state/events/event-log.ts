import { existsSync, watch, type FSWatcher } from "node:fs";
import { appendFile, mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { AlixEvent, NewEvent } from "./types.js";

type EventListener = (event: AlixEvent) => void;
const appendQueues = new Map<string, Promise<void>>();

/**
 * Wall-clock primitives captured at module load. The append-lock retry,
 * deadline, staleness checks, and heartbeat must use the REAL clock: under
 * fake timers (vitest `vi.useFakeTimers()`), a lock contender awaiting a
 * faked `setTimeout` with a frozen `Date` hangs forever once the test stops
 * advancing time, and a fake-time deadline misfires. In production there are
 * no fake timers, so these are identical to the globals.
 */
const RealDate: DateConstructor = Date;
const realSetTimeout: typeof setTimeout = globalThis.setTimeout.bind(globalThis);
const realSetInterval: typeof setInterval = globalThis.setInterval.bind(globalThis);
const realClearInterval: typeof clearInterval = globalThis.clearInterval.bind(globalThis);

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
      return RealDate.now() - (await stat(lockPath)).mtimeMs > STALE_LOCK_MS;
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
  const heartbeatAge = RealDate.now() - new RealDate(content.heartbeat).getTime();
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
  /**
   * Size-gated resync fast path (P3): the byte size of the log the last time
   * this instance held the append lock. Under the lock, an unchanged size
   * means no peer appended since our last write, so `nextSeq` is already
   * correct and the tail read can be skipped — saving two file opens + a read
   * on every uncontended burst append. `undefined` (including right after
   * `init()`, which runs unlocked and must never prime the gate) falls
   * through to the tail read, so multi-writer correctness is unchanged.
   * Assumption: the log file is append-only in normal operation — an
   * out-of-band truncate-and-rewrite to an identical byte length would fool
   * the pure-size comparison. Nothing in the runtime truncates or rewrites
   * events.jsonl; rotation would need a generation check added here.
   */
  private lastKnownSize: number | undefined;
  private watchers: EventListener[] = [];
  private readonly owner = Symbol('EventLogCursorOwner');

  constructor(readonly sessionDir: string) {
    this.path = join(sessionDir, "events.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const events = await this.readAll();
    this.nextSeq = events.reduce((max, e) => Math.max(max, e.seq ?? 0), 0) + 1;
    // Deliberately NOT priming lastKnownSize here: init() runs unlocked, so a
    // peer append between readAll() and stat() would prime the gate with a
    // fresh size over a stale nextSeq, and the first append would skip its
    // resync and duplicate a seq. The gate primes only under the append lock
    // (resyncFromDisk) or arithmetically after our own locked write.
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
    return this.appendLocked(event);
  }

  /** Conditionally append under the same cross-process lock as append().
   * The predicate is evaluated against durable history while the lock is held.
   * Callers must use a stable identity predicate; returning an existing event
   * is not a new append and does not notify watchers. */
  async appendIfAbsent<TType extends string, TPayload>(
    event: NewEvent<TType, TPayload>,
    matches: (existing: AlixEvent) => boolean,
  ): Promise<AlixEvent> {
    return this.appendLocked(event, matches);
  }

  private async appendLocked<TType extends string, TPayload>(
    event: NewEvent<TType, TPayload>,
    matches?: (existing: AlixEvent) => boolean,
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
        realClearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };
    const deadline = RealDate.now() + 5_000;
    let fullEvent: AlixEvent<TType, TPayload>;
    try {
      while (!lock) {
        try {
          lock = await open(lockPath, "wx", 0o600);
          // Record ownership so a contender can tell a live holder from a
          // dead one instead of blindly stealing by mtime.
          lockToken = randomUUID();
          const beat = (): string => new RealDate().toISOString();
          await lock.writeFile(JSON.stringify({ pid: process.pid, token: lockToken, heartbeat: beat() }));
          heartbeatTimer = realSetInterval(() => {
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
          if (RealDate.now() >= deadline) throw new Error(`Timed out acquiring EventLog append lock: ${lockPath}`);
          await new Promise((resolve) => realSetTimeout(resolve, 5));
        }
      }
      await this.resyncFromDisk();
      if (matches) {
        const existing = (await this.readAll()).find(matches);
        if (existing) return existing as AlixEvent<TType, TPayload>;
      }
      fullEvent = {
        ...event,
        id: randomUUID(),
        seq: this.nextSeq++,
        version: 1,
        timestamp: new Date().toISOString()
      };
      const lineBytes = Buffer.byteLength(`${JSON.stringify(fullEvent)}\n`, "utf8");
      await appendFile(this.path, `${JSON.stringify(fullEvent)}\n`, "utf8");
      // Prime the size gate from the observed pre-write size + our own bytes,
      // so a following uncontended append skips its tail read. A peer write
      // changes the on-disk size and re-arms the full resync path.
      if (this.lastKnownSize !== undefined) this.lastKnownSize += lineBytes;
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
   *  as the log grows; the window grows geometrically only when the last line
   *  exceeds it (e.g. a large context bundle) and never degrades to a
   *  whole-file read while any complete line is reachable in the tail. */
  private async resyncFromDisk(): Promise<void> {
    if (!existsSync(this.path)) {
      this.lastKnownSize = 0;
      return;
    }
    const size = (await stat(this.path)).size;
    // Fast path: the file is exactly the size we left it, so no peer wrote
    // since our last locked resync — nextSeq is already correct. Always
    // re-prime the gate from the observed size so a stale cache can never
    // pin us to a skip after an external truncate/replace.
    if (this.lastKnownSize !== undefined && size === this.lastKnownSize) return;
    this.lastKnownSize = size;
    const maxSeq = await this.readMaxSeqFromTail();
    if (maxSeq === null) {
      await this.resyncFromFullRead();
      return;
    }
    if (maxSeq + 1 > this.nextSeq) this.nextSeq = maxSeq + 1;
  }

  /** Max seq from the last complete line in the tail, or null when the file
   *  holds no parseable complete line at all (a single un-newlined fragment).
   *
   *  The window starts at `RESYNC_TAIL_BYTES` and DOUBLES until a complete
   *  line fits or the whole file is covered. This matters because a single
   *  event can exceed 64KB (context bundles reached 126KB/141KB in session
   *  1791853059081): a fixed window then straddled one huge line, found no
   *  complete line, and fell back to reading the ENTIRE growing file on every
   *  append — turning each append into an O(file) read that held the shared
   *  append lock for seconds and timed out peer writers. Geometric growth
   *  costs O(last-line size) instead of O(file size), keeping the lock hold
   *  bounded regardless of log length. */
  private async readMaxSeqFromTail(): Promise<number | null> {
    const st = await stat(this.path);
    if (st.size === 0) return 0;
    let window = Math.min(st.size, RESYNC_TAIL_BYTES);
    for (;;) {
      const text = await this.readTailBytes(st.size, window);
      const lines = text.split("\n");
      // When the window does not begin at byte 0, its first element is a
      // partial-line fragment; start scanning from the first COMPLETE line.
      const firstComplete = window < st.size ? 1 : 0;
      for (let i = lines.length - 1; i >= firstComplete; i--) {
        const line = lines[i]!.trim();
        if (!line) continue;
        try {
          const e = JSON.parse(line) as { seq?: number };
          if (typeof e.seq === "number") return e.seq;
        } catch {
          // Partial/truncated line — try the previous complete line.
        }
      }
      // No complete line fit. Cover the whole file before giving up; the
      // caller's full read cannot do better than a window that already spans
      // every byte, so stopping here avoids a redundant whole-file pass.
      if (window >= st.size) return null;
      window = Math.min(st.size, window * 2);
    }
  }

  /** Read the last `window` bytes of the file as UTF-8. */
  private async readTailBytes(size: number, window: number): Promise<string> {
    const fd = await open(this.path, "r");
    try {
      const buf = Buffer.alloc(window);
      await fd.read(buf, 0, window, size - window);
      return buf.toString("utf8");
    } finally {
      await fd.close();
    }
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
