/**
 * P4.3-Sc2.3 — Session Stream Hub
 *
 * Manages per-session file tailers that watch session events JSONL files
 * and stream new events to subscribers via secure SSE connections.
 *
 * Key design:
 * - One tailer per session, shared among all subscribers for that session
 * - Incremental reads from byte offset using fs.watch for change notification
 * - Bounded partial-line buffer (max 64 KB per tailer)
 * - Handles file creation after subscription (waits for file)
 * - Handles truncation (file size shrinks → reset cursor)
 * - Validates session ID against path traversal before path construction
 * - Parses and filters events against a visible-event-type allowlist
 * - Redacts before fan-out (once per event, not per subscriber)
 * - Stops tailer when no subscribers remain after an idle grace period
 * - Enforces max-concurrent-tailer cap
 *
 * Replay semantics:
 *   Event ID: non-negative integer sequence number
 *   - Cursor below first available → send `replay.reset`
 *   - Cursor above latest → no replay
 *   - Otherwise → replay from cursor+1 to latest
 *   - Bounded replay count (max 1000 events per reconnect)
 *
 * @module
 */

import { existsSync, statSync, watch, createReadStream, type Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { isValidSessionId, sessionEventsPath } from "../inspector/session-reader.js";
import { SecretDetector } from "../security/redaction/secret-detector.js";
import { redactValue } from "../security/redaction/redactor.js";
import { createRedactionPolicy, type RedactionPolicy } from "../security/redaction/redaction-policy.js";
import type { SecureSseConnection } from "./secure-sse.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionHubOptions {
  /** Maximum concurrent tailers (default: 1000). */
  maxTailers?: number;
  /** Maximum partial-line buffer bytes per tailer (default: 65536). */
  maxPartialLineBytes?: number;
  /** Idle grace period before stopping a tailer with no subscribers (ms, default: 60000). */
  idleGraceMs?: number;
  /** Maximum replay events per reconnect (default: 1000). */
  maxReplayEvents?: number;
  /** Pre-configured secret detector. */
  detector?: SecretDetector;
}

/** Visible event types to include in the SSE stream (shared with server.ts). */
export type VisibleEventType = string;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TAILERS = 1000;
const DEFAULT_MAX_PARTIAL_LINE = 65536;       // 64 KB
const DEFAULT_IDLE_GRACE_MS = 60_000;          // 60 s
const DEFAULT_MAX_REPLAY = 1000;

/** Events we keep in memory for replay across the tailer lifecycle. */
interface CachedEvent {
  seq: number;
  type: string;
  line: string;   // the original JSONL line, for redaction-avoidance
  redacted: string; // the redacted JSON string ready for fan-out
}

// ---------------------------------------------------------------------------
// SessionTailer
// ---------------------------------------------------------------------------

class SessionTailer {
  /** Active subscribers. */
  readonly subscribers = new Set<SecureSseConnection>();

  /** Cached parsed events for replay (bounded). */
  private readonly eventCache: CachedEvent[] = [];
  private readonly maxCache = 200; // keep last N events for replay

  /** Current byte offset in the events file. */
  private readPos = 0;
  /** Partial line buffer (incomplete last line). */
  private partialLine = "";
  /** Maximum partial line bytes before reset. */
  private readonly maxPartialBytes: number;

  private watcher: ReturnType<typeof watch> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private fileCheckTimer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private fileSize = 0;
  private fileInode = 0;

  private readonly detector: SecretDetector;
  private readonly policy: RedactionPolicy;

  constructor(
    private readonly eventsPath: string,
    private readonly visibleEvents: Set<VisibleEventType>,
    private readonly idleGraceMs: number,
    opts?: SessionHubOptions,
  ) {
    this.maxPartialBytes = opts?.maxPartialLineBytes ?? DEFAULT_MAX_PARTIAL_LINE;
    this.detector = opts?.detector ?? new SecretDetector();
    this.policy = createRedactionPolicy("operational");
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Start watching the session file. */
  async start(): Promise<void> {
    this.stopped = false;

    // Check if file already exists
    if (existsSync(this.eventsPath)) {
      await this.initTail();
    } else {
      // Wait for file creation (poll, capped)
      await this.waitForFile();
    }
  }

  /** Stop the tailer and disconnect all subscribers. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;

    this.clearTimers();

    // Disconnect all subscribers
    for (const conn of this.subscribers) {
      try { conn.close(); } catch { /* suppress */ }
    }
    this.subscribers.clear();
    this.eventCache.length = 0;
  }

  // ── Subscriber management ────────────────────────────────────────────

  addSubscriber(conn: SecureSseConnection): void {
    this.subscribers.add(conn);
    this.clearIdleTimer();

    conn.onClose(() => {
      this.subscribers.delete(conn);
      if (this.subscribers.size === 0) {
        this.startIdleTimer();
      }
    });
  }

  removeSubscriber(conn: SecureSseConnection): void {
    this.subscribers.delete(conn);
    if (this.subscribers.size === 0) {
      this.startIdleTimer();
    }
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  // ── Replay ───────────────────────────────────────────────────────────

  /**
   * Replay cached events from the given cursor sequence.
   * Returns the number of events replayed.
   */
  replay(conn: SecureSseConnection, cursorSeq: number, maxReplay: number): number {
    if (this.eventCache.length === 0) return 0;

    const firstSeq = this.eventCache[0].seq;
    const lastSeq = this.eventCache[this.eventCache.length - 1].seq;

    // Cursor at or beyond latest — nothing to replay
    if (cursorSeq >= lastSeq) return 0;

    // Cursor below first available — reset
    if (cursorSeq < firstSeq) {
      conn.send("replay.reset", {
        reason: "cursor_below_floor",
        requestedSeq: cursorSeq,
        availableFrom: firstSeq,
      });
      cursorSeq = firstSeq - 1;
    }

    // Collect events after cursor
    const toReplay = this.eventCache.filter((e) => e.seq > cursorSeq);

    // Bound replay count
    const bounded = toReplay.length > maxReplay ? toReplay.slice(toReplay.length - maxReplay) : toReplay;

    if (toReplay.length > maxReplay) {
      conn.send("replay.reset", {
        reason: "replay_truncated",
        totalEvents: bounded.length,
      });
    }

    let count = 0;
    for (const ev of bounded) {
      conn.send("alix", ev.redacted);
      count++;
    }

    return count;
  }

  // ── Internal: file waiting ───────────────────────────────────────────

  private waitForFile(): Promise<void> {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 120; // 2 minutes at 1s intervals

      this.fileCheckTimer = setInterval(() => {
        if (this.stopped) {
          clearInterval(this.fileCheckTimer!);
          this.fileCheckTimer = undefined;
          resolve();
          return;
        }

        attempts++;
        if (existsSync(this.eventsPath)) {
          clearInterval(this.fileCheckTimer!);
          this.fileCheckTimer = undefined;
          this.initTail().then(resolve);
          return;
        }

        if (attempts >= maxAttempts) {
          clearInterval(this.fileCheckTimer!);
          this.fileCheckTimer = undefined;
          // File never appeared — stop the tailer
          this.stop();
          resolve();
        }
      }, 1000);
    });
  }

  // ── Internal: file tailing ───────────────────────────────────────────

  private async initTail(): Promise<void> {
    if (this.stopped) return;

    try {
      const st = await stat(this.eventsPath);
      this.fileSize = st.size;
      this.fileInode = st.ino;
      this.readPos = 0; // start from beginning for new tailer

      // Read existing content
      await this.readNewBytes();

      // Start watching
      this.startWatcher();
    } catch {
      // File disappeared or error — try waiting again
      this.closeWatcher();
      await this.waitForFile();
    }
  }

  private startWatcher(): void {
    if (this.stopped) return;

    try {
      this.watcher = watch(this.eventsPath, (eventType) => {
        if (this.stopped) return;
        this.onFileChange(eventType);
      });

      this.watcher.on("error", () => {
        // Watcher error — close and retry
        this.closeWatcher();
        if (!this.stopped) {
          this.waitForFile();
        }
      });
    } catch {
      // File may not exist anymore
      if (!this.stopped) {
        this.waitForFile();
      }
    }
  }

  private onFileChange(eventType: string): void {
    if (this.stopped) return;

    if (eventType === "rename") {
      // File may have been deleted or replaced
      this.closeWatcher();
      if (!this.stopped) {
        this.waitForFile();
      }
      return;
    }

    // Check for truncation
    try {
      const st = statSync(this.eventsPath);

      // Inode change → file replaced
      if (st.ino !== this.fileInode) {
        this.fileInode = st.ino;
        this.fileSize = st.size;
        this.readPos = 0;
        this.partialLine = "";
        this.eventCache.length = 0;
        this.readNewBytes();
        return;
      }

      // Truncation → file shrank
      if (st.size < this.readPos) {
        this.readPos = 0;
        this.partialLine = "";
        this.eventCache.length = 0;
      }

      this.fileSize = st.size;
      this.readNewBytes();
    } catch {
      // File disappeared
      this.closeWatcher();
      if (!this.stopped) {
        this.waitForFile();
      }
    }
  }

  private async readNewBytes(): Promise<void> {
    if (this.stopped) return;

    try {
      const currentSize = statSync(this.eventsPath).size;
      if (currentSize <= this.readPos) return;

      const bytesToRead = currentSize - this.readPos;
      const fd = await open(this.eventsPath, "r");
      const buffer = Buffer.alloc(bytesToRead);

      try {
        const { bytesRead } = await fd.read(buffer, 0, bytesToRead, this.readPos);
        if (bytesRead > 0) {
          const chunk = buffer.toString("utf8", 0, bytesRead);
          this.processChunk(chunk);
          this.readPos += bytesRead;
        }
      } finally {
        await fd.close();
      }
    } catch {
      // Best-effort — will retry on next watch event
    }
  }

  private processChunk(chunk: string): void {
    // Prepend partial line from previous chunk
    const fullText = this.partialLine + chunk;

    const lines = fullText.split("\n");

    // The last element is either a partial line or empty
    // (if the chunk ends with \n, split produces an empty last element)
    const lastIdx = lines.length - 1;
    const lastLine = lines[lastIdx];

    // Process complete lines
    for (let i = 0; i < lastIdx; i++) {
      const line = lines[i];
      if (line.length === 0) continue;
      this.processLine(line);
    }

    // Carry over partial line (or clear if complete)
    // If lastLine is empty, the chunk ended with \n → all lines complete
    if (lastLine.length > 0) {
      // Enforce partial-line buffer limit
      if (lastLine.length > this.maxPartialBytes) {
        // Discard the oversized partial line
        this.partialLine = "";
      } else {
        this.partialLine = lastLine;
      }
    } else {
      this.partialLine = "";
    }
  }

  private processLine(line: string): void {
    try {
      const event = JSON.parse(line) as { seq?: number; type?: string };

      // Validate
      if (event.seq === undefined || event.type === undefined) return;

      // Filter against visible events
      if (!this.visibleEvents.has(event.type)) return;

      // Redact the parsed event
      const redacted = redactValue(event, this.policy, this.detector);
      const redactedStr = JSON.stringify(redacted);

      // Cache for replay
      const cached: CachedEvent = {
        seq: event.seq,
        type: event.type,
        line,
        redacted: redactedStr,
      };
      this.eventCache.push(cached);

      // Bound the cache (FIFO)
      while (this.eventCache.length > this.maxCache) {
        this.eventCache.shift();
      }

      // Fan out to subscribers
      for (const conn of this.subscribers) {
        try {
          conn.send("alix", redacted);
        } catch {
          // Best-effort per subscriber
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  // ── Internal: timers ─────────────────────────────────────────────────

  private clearTimers(): void {
    this.closeWatcher();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.fileCheckTimer) {
      clearInterval(this.fileCheckTimer);
      this.fileCheckTimer = undefined;
    }
  }

  private closeWatcher(): void {
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* suppress */ }
      this.watcher = undefined;
    }
  }

  private startIdleTimer(): void {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.stop();
    }, this.idleGraceMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// SessionStreamHub
// ---------------------------------------------------------------------------

export class SessionStreamHub {
  private readonly tailers = new Map<string, SessionTailer>();
  private readonly maxTailers: number;
  private readonly visibleEvents: Set<VisibleEventType>;
  private readonly idleGraceMs: number;
  private readonly maxReplay: number;
  private readonly detector: SecretDetector;
  private readonly root: string;

  // ── Resource counters (Sc2.5) ────────────────────────────────────────
  private rejectedCount = 0;
  private disconnectCount = 0;

  constructor(
    root: string,
    visibleEvents: VisibleEventType[],
    opts?: SessionHubOptions,
  ) {
    this.root = root;
    this.maxTailers = opts?.maxTailers ?? DEFAULT_MAX_TAILERS;
    this.visibleEvents = new Set(visibleEvents);
    this.idleGraceMs = opts?.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
    this.maxReplay = opts?.maxReplayEvents ?? DEFAULT_MAX_REPLAY;
    this.detector = opts?.detector ?? new SecretDetector();
  }

  // -----------------------------------------------------------------------
  // Subscriber management
  // -----------------------------------------------------------------------

  /**
   * Subscribe to session events.  Validates the session ID, creates or
   * reuses a tailer, and handles replay.
   *
   * Returns `false` if the session ID is invalid (path traversal) or
   * the tailer cap is exceeded.
   */
  subscribe(sessionId: string, conn: SecureSseConnection): boolean {
    // Validate session ID
    if (!isValidSessionId(sessionId)) {
      this.rejectedCount++;
      return false;
    }

    // Get or create tailer
    let tailer = this.tailers.get(sessionId);
    if (!tailer) {
      // Enforce max tailers
      if (this.tailers.size >= this.maxTailers) {
        this.rejectedCount++;
        return false;
      }

      // Validate path (extra safety — path traversal check)
      const eventsPath = sessionEventsPath(this.root, sessionId);

      tailer = new SessionTailer(eventsPath, this.visibleEvents, this.idleGraceMs, {
        maxPartialLineBytes: DEFAULT_MAX_PARTIAL_LINE,
        detector: this.detector,
      });
      this.tailers.set(sessionId, tailer);

      // Start tailer (async — don't block)
      tailer.start().catch(() => {
        tailer?.stop();
        this.tailers.delete(sessionId);
      });

      // Cleanup when tailer stops
      const checkStopped = (): void => {
        if (tailer && tailer.subscriberCount === 0) {
          tailer.stop();
          this.tailers.delete(sessionId);
        }
      };
      // Poll for stopped tailers periodically (lightweight)
      // Actually, the tailer handles its own idle cleanup
    }

    tailer.addSubscriber(conn);
    return true;
  }

  /**
   * Unsubscribe from session events. Idempotent.
   */
  unsubscribe(sessionId: string, conn: SecureSseConnection): void {
    const tailer = this.tailers.get(sessionId);
    if (!tailer) return;
    tailer.removeSubscriber(conn);
  }

  /**
   * Replay cached session events for a connection.
   * Returns the number of events replayed.
   */
  replay(sessionId: string, conn: SecureSseConnection, lastEventId?: string): number {
    const tailer = this.tailers.get(sessionId);
    if (!tailer) return 0;

    // Parse Last-Event-ID as a non-negative integer sequence
    let cursorSeq = -1;
    if (lastEventId !== undefined && lastEventId !== "") {
      const parsed = parseInt(lastEventId, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        cursorSeq = parsed;
      }
    }

    return tailer.replay(conn, cursorSeq, this.maxReplay);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Stop all tailers and disconnect all subscribers. */
  stop(): void {
    for (const tailer of this.tailers.values()) {
      try { tailer.stop(); } catch { /* suppress */ }
    }
    this.tailers.clear();
  }

  // -----------------------------------------------------------------------
  // Diagnostics (Sc2.5)
  // -----------------------------------------------------------------------

  /** Current number of tailers. */
  get tailerCount(): number {
    return this.tailers.size;
  }

  /** Total subscribers across all tailers. */
  get totalSubscribers(): number {
    let count = 0;
    for (const t of this.tailers.values()) {
      count += t.subscriberCount;
    }
    return count;
  }

  /** Get diagnostic snapshot for `alix doctor`. */
  diagnostic(): Record<string, unknown> {
    const tailerInfo: Record<string, { subscribers: number }> = {};
    for (const [sessionId, t] of this.tailers) {
      tailerInfo[sessionId] = { subscribers: t.subscriberCount };
    }

    return {
      tailers: this.tailers.size,
      maxTailers: this.maxTailers,
      totalSubscribers: this.totalSubscribers,
      rejectedConnections: this.rejectedCount,
      disconnectedClients: this.disconnectCount,
      activeSessions: Object.keys(tailerInfo),
    };
  }
}
