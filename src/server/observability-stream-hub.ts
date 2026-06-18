/**
 * P4.3-Sc2.2 — Observability Stream Hub
 *
 * One producer per Inspector server instance.  Gathers a health snapshot,
 * evaluates alerts, samples metrics, and detects anomalies in a single
 * production cycle, redacts the result once, stores it in a bounded replay
 * ring, and fans out to all subscribers — eliminating per-client
 * recomputation.
 *
 * Replay semantics:
 *   Event ID format: `<server-epoch>:<sequence>`
 *   - Old epoch → send `replay.reset` + full ring
 *   - Cursor below floor → send `replay.reset` + full ring
 *   - Cursor at/above head → no replay
 *   - Otherwise → send events from cursor+1 to head
 *
 * @module
 */

import type { SecureSseConnection } from "./secure-sse.js";
import { SecretDetector } from "../security/redaction/secret-detector.js";
import { redactValue } from "../security/redaction/redactor.js";
import { createRedactionPolicy, type RedactionPolicy } from "../security/redaction/redaction-policy.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single redacted event stored in the replay ring. */
export interface ObservabilityReplayEvent {
  /** Server epoch (stable for the server lifetime). */
  epoch: string;
  /** Monotonic sequence within this epoch. */
  seq: number;
  /** SSE event name. */
  event: string;
  /** Already-redacted payload. */
  data: unknown;
  /** ISO-8601 timestamp of production. */
  timestamp: string;
}

export interface ObservabilityHubOptions {
  /** Cycle interval in ms (default: 2000). */
  cycleIntervalMs?: number;
  /** Maximum replay ring entries (default: 100). */
  maxRingSize?: number;
  /** Maximum replay events per reconnect (default: 1000). */
  maxReplayEvents?: number;
  /** Pre-configured secret detector. */
  detector?: SecretDetector;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CYCLE_MS = 2000;
const DEFAULT_MAX_RING = 100;
const DEFAULT_MAX_REPLAY = 1000;

// ---------------------------------------------------------------------------
// Replay ID helpers
// ---------------------------------------------------------------------------

const REPLAY_ID_RE = /^([a-z0-9]+):(\d+)$/;

function parseReplayId(id: string): { epoch: string; seq: number } | null {
  const m = id.match(REPLAY_ID_RE);
  if (!m) return null;
  const seq = parseInt(m[2], 10);
  if (!Number.isFinite(seq) || seq < 0) return null;
  return { epoch: m[1], seq };
}

function formatReplayId(epoch: string, seq: number): string {
  return `${epoch}:${seq}`;
}

// ---------------------------------------------------------------------------
// Hub
// ---------------------------------------------------------------------------

export class ObservabilityStreamHub {
  private readonly subscribers = new Set<SecureSseConnection>();
  private readonly ring: ObservabilityReplayEvent[] = [];
  private readonly epoch: string;
  private readonly cycleMs: number;
  private readonly maxRing: number;
  private readonly maxReplay: number;
  private readonly detector: SecretDetector;
  private readonly policy: RedactionPolicy;

  private seq = 0;
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private running = false;

  // ── Resource counters (Sc2.5) ────────────────────────────────────────
  private rejectedCount = 0;
  private disconnectCount = 0;
  private disconnectReasons: Record<string, number> = {};
  private cycleCount = 0;
  private root: string;

  constructor(root: string, opts?: ObservabilityHubOptions) {
    this.root = root;
    this.cycleMs = opts?.cycleIntervalMs ?? DEFAULT_CYCLE_MS;
    this.maxRing = opts?.maxRingSize ?? DEFAULT_MAX_RING;
    this.maxReplay = opts?.maxReplayEvents ?? DEFAULT_MAX_REPLAY;
    this.detector = opts?.detector ?? new SecretDetector();
    this.policy = createRedactionPolicy("operational");
    // Compact epoch: server start time in base-36 + random (no hyphens for SSE replay ID compat)
    this.epoch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Begin the production cycle. Idempotent. */
  start(): void {
    if (this.running) return;
    this.running = true;

    // First cycle immediately
    this.productionCycle();

    // Then on interval
    this.intervalId = setInterval(() => {
      this.productionCycle();
    }, this.cycleMs);

    // Allow the event loop to exit even with this timer
    if (this.intervalId && typeof this.intervalId === "object" && "unref" in this.intervalId) {
      (this.intervalId as NodeJS.Timeout).unref();
    }
  }

  /** Stop production and disconnect all subscribers. Idempotent. */
  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    // Close all subscribers
    for (const conn of this.subscribers) {
      try { conn.close(); } catch { /* suppress */ }
    }
    this.subscribers.clear();
  }

  // -----------------------------------------------------------------------
  // Subscriber management
  // -----------------------------------------------------------------------

  /**
   * Subscribe a connection.  Handles replay based on the Last-Event-ID
   * header (passed via the connection metadata or a separate parameter).
   *
   * Call `handleReplay(conn, lastEventId)` separately if replay is needed.
   */
  subscribe(conn: SecureSseConnection): void {
    if (!this.running) return;
    this.subscribers.add(conn);

    conn.onClose(() => {
      this.subscribers.delete(conn);
      this.disconnectCount++;
      // Track disconnect reason for diagnostics
      const reason: string =
        typeof (conn as any)._getCloseReason === "function"
          ? (conn as any)._getCloseReason()
          : "unknown";
      this.disconnectReasons[reason] = (this.disconnectReasons[reason] ?? 0) + 1;
    });
  }

  /** Unsubscribe a connection. Idempotent. */
  unsubscribe(conn: SecureSseConnection): void {
    this.subscribers.delete(conn);
  }

  // -----------------------------------------------------------------------
  // Replay
  // -----------------------------------------------------------------------

  /**
   * Replay events from the ring to a newly-subscribed connection based
   * on the Last-Event-ID header value.
   *
   * @returns the number of events replayed.
   */
  replay(conn: SecureSseConnection, lastEventId?: string): number {
    if (this.ring.length === 0) return 0;

    // Parse and validate
    let cursorSeq = -1;
    let epochOk = false;

    if (lastEventId) {
      const parsed = parseReplayId(lastEventId);
      if (parsed) {
        epochOk = parsed.epoch === this.epoch;
        cursorSeq = parsed.seq;
      }
    }

    // Determine which events to replay
    let eventsToReplay: ObservabilityReplayEvent[];

    if (!epochOk || lastEventId === undefined || lastEventId === "") {
      // Fresh connect or epoch mismatch — replay everything
      eventsToReplay = [...this.ring];
      // Signal reset
      conn.send("replay.reset", {
        epoch: this.epoch,
        reason: !epochOk ? "epoch_mismatch" : "fresh_connect",
        totalEvents: eventsToReplay.length,
      }, formatReplayId(this.epoch, this.headSeq()));
    } else if (cursorSeq >= this.headSeq()) {
      // Cursor at or beyond head — nothing to replay
      return 0;
    } else if (cursorSeq < this.floorSeq()) {
      // Cursor below floor — full replay with reset
      eventsToReplay = [...this.ring];
      conn.send("replay.reset", {
        epoch: this.epoch,
        reason: "cursor_below_floor",
        requestedSeq: cursorSeq,
        floorSeq: this.floorSeq(),
        totalEvents: eventsToReplay.length,
      }, formatReplayId(this.epoch, this.headSeq()));
    } else {
      // Normal incremental replay
      eventsToReplay = this.ring.filter((e) => e.seq > cursorSeq);
    }

    // Bound replay count
    if (eventsToReplay.length > this.maxReplay) {
      eventsToReplay = eventsToReplay.slice(eventsToReplay.length - this.maxReplay);
      conn.send("replay.reset", {
        epoch: this.epoch,
        reason: "replay_truncated",
        totalEvents: eventsToReplay.length,
      }, formatReplayId(this.epoch, eventsToReplay[eventsToReplay.length - 1].seq));
    }

    // Send replay events
    let count = 0;
    for (const ev of eventsToReplay) {
      conn.send(ev.event, ev.data, formatReplayId(ev.epoch, ev.seq));
      count++;
    }

    return count;
  }

  // -----------------------------------------------------------------------
  // Diagnostics (Sc2.5)
  // -----------------------------------------------------------------------

  /** Current number of active subscribers. */
  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** The server epoch string. */
  get serverEpoch(): string {
    return this.epoch;
  }

  /** Current ring size. */
  get ringSize(): number {
    return this.ring.length;
  }

  /** Latest sequence number. */
  get latestSeq(): number {
    return this.seq;
  }

  /** Get diagnostic snapshot for `alix doctor`. */
  diagnostic(): Record<string, unknown> {
    return {
      epoch: this.epoch,
      running: this.running,
      subscribers: this.subscribers.size,
      ringSize: this.ring.length,
      latestSeq: this.seq,
      floorSeq: this.floorSeq(),
      headSeq: this.headSeq(),
      cycleCount: this.cycleCount,
      rejectedConnections: this.rejectedCount,
      disconnectedClients: this.disconnectCount,
      disconnectReasons: { ...this.disconnectReasons },
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private headSeq(): number {
    if (this.ring.length === 0) return 0;
    return this.ring[this.ring.length - 1].seq;
  }

  private floorSeq(): number {
    if (this.ring.length === 0) return 0;
    return this.ring[0].seq;
  }

  private async productionCycle(): Promise<void> {
    if (!this.running) return;

    try {
      // ── 1. Health snapshot ──────────────────────────────────────────
      const { ObservabilitySnapshotService } = await import("../observability/health-snapshot.js");
      const healthSvc = new ObservabilitySnapshotService(this.root);
      const health = await healthSvc.getHealth();

      // ── 2. Alert evaluation ─────────────────────────────────────────
      const { AlertEngine } = await import("../observability/alert-engine.js");
      const engine = new AlertEngine();
      const alerts = engine.evaluate(health);

      // ── 3. Metric samples ───────────────────────────────────────────
      const { MetricsStore } = await import("../observability/metrics-store.js");
      const store = new MetricsStore(this.root);
      const metricSamples: unknown[] = [];
      const seenMetrics = new Set<string>();
      for await (const row of store.readAll({ limit: 50 })) {
        if (!seenMetrics.has(row.name)) {
          metricSamples.push(row);
          seenMetrics.add(row.name);
          if (metricSamples.length >= 5) break;
        }
      }

      // ── 4. Anomaly detection ────────────────────────────────────────
      const { TrendAnalyzer } = await import("../observability/trend-analyzer.js");
      const analyzer = new TrendAnalyzer(store);
      const anomalies = await analyzer.detectAnomalies({ sensitivity: 2.0, maxResults: 5 });

      this.cycleCount++;

      // ── 5. Emit events ──────────────────────────────────────────────
      // Redact once before storage and fan-out
      this.emitEvent("health.snapshot", health);
      for (const a of alerts.firing) {
        this.emitEvent("alert.firing", a);
      }
      if (metricSamples.length > 0) {
        this.emitEvent("metric.sample", metricSamples);
      }
      for (const a of anomalies) {
        this.emitEvent("anomaly.detected", a);
      }
    } catch {
      // Cycle errors are non-fatal — continue cycling
    }
  }

  /**
   * Redact event data once, store in ring, and fan out to all subscribers.
   */
  private emitEvent(event: string, rawData: unknown): void {
    // Redact once
    const redactedData = redactValue(rawData, this.policy, this.detector);

    this.seq++;
    const ringEntry: ObservabilityReplayEvent = {
      epoch: this.epoch,
      seq: this.seq,
      event,
      data: redactedData,
      timestamp: new Date().toISOString(),
    };

    // Store in bounded ring
    this.ring.push(ringEntry);
    while (this.ring.length > this.maxRing) {
      this.ring.shift();
    }

    // Format replay ID for this event
    const replayId = formatReplayId(this.epoch, this.seq);

    // Fan out to all subscribers (data is already redacted)
    for (const conn of this.subscribers) {
      try {
        // Pass replay ID as the SSE event ID
        conn.send(event, redactedData, replayId);
      } catch {
        // Best-effort per subscriber
      }
    }
  }
}
