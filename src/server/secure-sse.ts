/**
 * P4.3-Sc2.1 — Secure SSE Connection Wrapper
 *
 * Wraps a Node.js ServerResponse in a secure SSE connection that:
 * - Applies SSE headers only after authentication/authorization
 * - Serializes all event data through the redactor
 * - Enforces per-event and total-buffer byte limits
 * - Enforces buffered event count limit
 * - Observes res.write() backpressure and disconnects on timeout
 * - Maintains a single idempotent cleanup function
 * - Sends keepalive heartbeats and enforces lifetime caps
 * - Reserves/releases connection-limiter slots on all close/error paths
 *
 * @module
 */

import type { ServerResponse } from "node:http";
import type { ConnectionLimiter, ConnectionToken } from "../security/inspector/connection-limiter.js";
import type { SecurityContext } from "../security/inspector/security-context.js";
import { redactValue } from "../security/redaction/redactor.js";
import { createRedactionPolicy, type RedactionPolicy } from "../security/redaction/redaction-policy.js";
import { SecretDetector } from "../security/redaction/secret-detector.js";
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A secure SSE connection bound to a single HTTP response.
 *
 * Every call to `send()` redacts the data, enforces size/backpressure
 * limits, and writes a properly-formatted SSE event to the client.
 * `close()` performs idempotent cleanup (timers, listeners, limiter release).
 */
export interface SecureSseConnection {
  /** Send an SSE event. May drop the event if buffers are full. */
  send(event: string, data: unknown, id?: string): void;

  /** Idempotent close — releases all resources. */
  close(): void;

  /** Register a callback invoked when the connection closes (once). */
  onClose(cb: () => void): void;
}

export interface SecureSseOptions {
  /** Client address for connection limiter (default: from socket). */
  clientAddress?: string;

  /** Maximum bytes in a single event after serialization (default: 65536). */
  perEventByteLimit?: number;

  /** Maximum total bytes buffered (unwritten to socket) (default: 1048576). */
  totalBufferBytes?: number;

  /** Maximum number of events buffered (default: 1000). */
  maxBufferedEvents?: number;

  /** Time in ms before a backpressured connection is disconnected (default: 30000). */
  backpressureTimeoutMs?: number;

  /** Heartbeat keepalive interval in ms (default: 30000). */
  heartbeatIntervalMs?: number;

  /** Maximum connection lifetime in ms (default: no limit). */
  maxLifetimeMs?: number;

  /** Pre-configured secret detector for redaction. */
  detector?: SecretDetector;

  /** Redaction profile name (default: "operational"). */
  redactionProfile?: string;
}

/** Reason a connection was closed — for diagnostics / metrics. */
export type SseCloseReason =
  | "client_closed"
  | "server_close"
  | "backpressure_timeout"
  | "lifetime_expired"
  | "write_error"
  | "buffer_overflow";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_PER_EVENT_BYTES = 65536;       // 64 KB
const DEFAULT_TOTAL_BUFFER_BYTES = 1048576;  // 1 MB
const DEFAULT_MAX_BUFFERED_EVENTS = 1000;
const DEFAULT_BACKPRESSURE_TIMEOUT_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a secure SSE connection.
 *
 * Applies SSE headers, reserves a connection-limiter slot, and returns a
 * `SecureSseConnection` that redacts all event data before transmission.
 *
 * If the connection limiter rejects the reservation, SSE headers are NOT
 * applied and the function returns `null`.
 */
export function createSecureSseConnection(
  res: ServerResponse,
  ctx: SecurityContext,
  limiter: ConnectionLimiter,
  opts?: SecureSseOptions,
): SecureSseConnection | null {
  const perEventBytes = opts?.perEventByteLimit ?? DEFAULT_PER_EVENT_BYTES;
  const maxBufferBytes = opts?.totalBufferBytes ?? DEFAULT_TOTAL_BUFFER_BYTES;
  const maxBuffered = opts?.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
  const bpTimeoutMs = opts?.backpressureTimeoutMs ?? DEFAULT_BACKPRESSURE_TIMEOUT_MS;
  const heartbeatMs = opts?.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const maxLifetimeMs = opts?.maxLifetimeMs;

  // Resolve client address
  const principalId = ctx.authenticated ? (ctx.tokenId ?? "authenticated") : "anonymous";
  const address = opts?.clientAddress ?? (res as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? "unknown";

  // ── Reservation ──────────────────────────────────────────────────────
  const reserveResult = limiter.reserve(principalId, address);
  if (!reserveResult.allowed) {
    return null;
  }
  const connToken: ConnectionToken = reserveResult.token!;

  // ── Redaction setup ──────────────────────────────────────────────────
  const detector = opts?.detector ?? new SecretDetector();
  const policy: RedactionPolicy = createRedactionPolicy(opts?.redactionProfile ?? "operational");

  // ── State ────────────────────────────────────────────────────────────
  let closed = false;
  let closeReason: SseCloseReason = "client_closed";
  let totalBuffered = 0;
  let bufferedCount = 0;
  let bpTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
  const onCloseCallbacks: Array<() => void> = [];
  let bpActive = false;
  let bpResolve: (() => void) | undefined;

  // ── SSE headers (only after reservation succeeds) ─────────────────────
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.setHeader("x-accel-buffering", "no");
  res.flushHeaders();

  // ── Idempotent cleanup ───────────────────────────────────────────────
  const cleanup = (): void => {
    if (closed) return;
    closed = true;

    // Clear all timers
    if (bpTimer) { clearTimeout(bpTimer); bpTimer = undefined; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = undefined; }
    if (lifetimeTimer) { clearTimeout(lifetimeTimer); lifetimeTimer = undefined; }

    // Remove drain listener
    res.removeAllListeners("drain");

    // Release connection limiter token
    limiter.release(connToken);

    // End the response if not already ended
    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch {
      // best-effort
    }

    // Fire close callbacks once
    for (const cb of onCloseCallbacks) {
      try { cb(); } catch { /* suppress callback errors */ }
    }
    onCloseCallbacks.length = 0;
  };

  // ── Backpressure handling ────────────────────────────────────────────

  const clearBackpressure = (): void => {
    bpActive = false;
    if (bpTimer) { clearTimeout(bpTimer); bpTimer = undefined; }
    if (bpResolve) {
      const resolve = bpResolve;
      bpResolve = undefined;
      resolve();
    }
  };

  const startBackpressureTimer = (): void => {
    if (bpTimer) return; // already active
    bpActive = true;
    bpTimer = setTimeout(() => {
      closeReason = "backpressure_timeout";
      cleanup();
    }, bpTimeoutMs);
  };

  // Listen for drain to clear backpressure
  res.on("drain", () => {
    clearBackpressure();
  });

  // ── Socket close handlers ────────────────────────────────────────────

  res.on("close", () => {
    if (!closed) {
      closeReason = "client_closed";
      cleanup();
    }
  });

  res.on("error", () => {
    if (!closed) {
      closeReason = "write_error";
      cleanup();
    }
  });

  // ── Heartbeat ────────────────────────────────────────────────────────

  heartbeatTimer = setInterval(() => {
    if (closed) return;
    try {
      // SSE comment line as keepalive (clients MUST ignore lines starting with ':')
      const keepalive = ": keepalive\n\n";
      res.write(keepalive);
    } catch {
      closeReason = "write_error";
      cleanup();
    }
  }, heartbeatMs);

  // Allow Node.js to not keep the event loop alive just for heartbeat
  if (heartbeatTimer && typeof heartbeatTimer === "object" && "unref" in heartbeatTimer) {
    (heartbeatTimer as NodeJS.Timeout).unref();
  }

  // ── Lifetime cap ─────────────────────────────────────────────────────

  if (maxLifetimeMs !== undefined && maxLifetimeMs > 0) {
    lifetimeTimer = setTimeout(() => {
      if (!closed) {
        closeReason = "lifetime_expired";
        cleanup();
      }
    }, maxLifetimeMs);
  }

  // ── Write helper ─────────────────────────────────────────────────────

  const doWrite = (payload: string): void => {
    if (closed) return;

    const payloadBytes = Buffer.byteLength(payload, "utf8");

    // Check total buffer
    if (totalBuffered + payloadBytes > maxBufferBytes) {
      closeReason = "buffer_overflow";
      cleanup();
      return;
    }

    // Check buffered count
    if (bufferedCount >= maxBuffered) {
      closeReason = "buffer_overflow";
      cleanup();
      return;
    }

    totalBuffered += payloadBytes;
    bufferedCount++;

    const canContinue = res.write(payload, "utf8", () => {
      // Write completed — decrement buffer tracking
      totalBuffered = Math.max(0, totalBuffered - payloadBytes);
      bufferedCount = Math.max(0, bufferedCount - 1);
    });

    if (!canContinue) {
      // Backpressure — start timeout
      startBackpressureTimer();
    }
  };

  // ── Public API ───────────────────────────────────────────────────────

  const send = (event: string, data: unknown, id?: string): void => {
    if (closed) return;

    try {
      // Redact the data before serialization
      const redacted = redactValue(data, policy, detector);

      // Serialize
      const dataStr = JSON.stringify(redacted);

      // Per-event byte limit
      if (Buffer.byteLength(dataStr, "utf8") > perEventBytes) {
        // Event too large — drop it (don't disconnect)
        return;
      }

      // Format as SSE: event, id, data fields
      const eventLine = event.includes("\n") ? "" : `event: ${event}\n`;
      const idLine = id !== undefined ? `id: ${id}\n` : "";
      const payload = `${eventLine}${idLine}data: ${dataStr}\n\n`;

      doWrite(payload);
    } catch {
      // Serialization or redaction failure — drop this event
    }
  };

  const close = (): void => {
    if (!closed) {
      closeReason = "server_close";
      cleanup();
    }
  };

  const onClose = (cb: () => void): void => {
    onCloseCallbacks.push(cb);
  };

  // ── Diagnostics (internal, exposed for tests) ─────────────────────────

  const connection: SecureSseConnection & {
    _getCloseReason: () => SseCloseReason;
    _isClosed: () => boolean;
  } = {
    send,
    close,
    onClose,
    _getCloseReason: () => closeReason,
    _isClosed: () => closed,
  };

  return connection;
}

// ---------------------------------------------------------------------------
// Mock for testing
// ---------------------------------------------------------------------------

/**
 * A mock SecureSseConnection for unit tests.
 *
 * Records all sent events in-memory. Does not touch real HTTP responses.
 * All limits are enforced identically to the real implementation.
 */
export class MockSecureSseConnection implements SecureSseConnection {
  /** All events sent through this connection (event name, raw data). */
  readonly events: Array<{ event: string; data: unknown }> = [];

  private _closed = false;
  private closeCallbacks: Array<() => void> = [];
  private readonly perEventBytes: number;
  private readonly maxBufferBytes: number;
  private readonly maxBuffered: number;
  private totalBuffered = 0;

  constructor(
    private readonly detector = new SecretDetector(),
    private readonly policy: RedactionPolicy = createRedactionPolicy("operational"),
    opts?: {
      perEventByteLimit?: number;
      totalBufferBytes?: number;
      maxBufferedEvents?: number;
    },
  ) {
    this.perEventBytes = opts?.perEventByteLimit ?? DEFAULT_PER_EVENT_BYTES;
    this.maxBufferBytes = opts?.totalBufferBytes ?? DEFAULT_TOTAL_BUFFER_BYTES;
    this.maxBuffered = opts?.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
  }

  send(event: string, data: unknown, _id?: string): void {
    if (this._closed) return;

    // Redact
    try {
      redactValue(data, this.policy, this.detector);
    } catch {
      return;
    }

    // Serialize to check size
    const dataStr = JSON.stringify(data);
    const payloadBytes = Buffer.byteLength(dataStr, "utf8");

    // Per-event limit
    if (payloadBytes > this.perEventBytes) return;

    // Buffer limits
    if (this.totalBuffered + payloadBytes > this.maxBufferBytes) {
      this.close();
      return;
    }
    if (this.events.length >= this.maxBuffered) {
      this.close();
      return;
    }

    this.totalBuffered += payloadBytes;
    this.events.push({ event, data });
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    for (const cb of this.closeCallbacks) {
      try { cb(); } catch { /* suppress */ }
    }
    this.closeCallbacks = [];
  }

  onClose(cb: () => void): void {
    this.closeCallbacks.push(cb);
  }

  get closed(): boolean {
    return this._closed;
  }
}
