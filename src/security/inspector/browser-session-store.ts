/**
 * P4.3-Sb3 — Browser Session Store
 *
 * In-memory session store with LRU/expiry cleanup. Sessions are never
 * persisted to disk and are invalidated on server restart.
 *
 * Key invariants:
 * - Session IDs are opaque (32 bytes, base64url-encoded).
 * - Total session count is bounded (configurable, default 256).
 * - Sessions expire after a configurable TTL (default 24 hours).
 * - Idle sessions expire after a configurable idle TTL (default 1 hour).
 * - Expired sessions are cleaned up on access.
 * - Token IDs, request IDs, and file paths are never used as labels.
 *
 * @module
 */

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Principal extracted from a verified token. */
export interface SessionPrincipal {
  id: string;
  name: string;
  role: string;
  workspaceIds?: string[];
  /** Permissions derived from the token role at session creation time. */
  permissions?: string[];
}

/** An active browser session. */
export interface BrowserSession {
  /** Opaque session ID (32 bytes, base64url). */
  id: string;
  /** The authenticated principal. */
  principal: SessionPrincipal;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 absolute expiry. */
  expiresAt: string;
  /** ISO-8601 idle expiry (updated on each access). */
  lastAccessedAt: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BrowserSessionStoreConfig {
  /** Maximum number of concurrent sessions (default: 256). */
  maxSessions?: number;
  /** Session TTL in milliseconds (default: 24 hours). */
  sessionTtlMs?: number;
  /** Idle TTL in milliseconds (default: 1 hour). */
  idleTtlMs?: number;
}

const DEFAULT_MAX_SESSIONS = 256;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_IDLE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// BrowserSessionStore
// ---------------------------------------------------------------------------

export class BrowserSessionStore {
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly maxSessions: number;
  private readonly sessionTtlMs: number;
  private readonly idleTtlMs: number;

  constructor(config?: BrowserSessionStoreConfig) {
    this.maxSessions = config?.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.sessionTtlMs = config?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.idleTtlMs = config?.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
  }

  // -----------------------------------------------------------------------
  // Create
  // -----------------------------------------------------------------------

  /**
   * Create a new session for a principal.
   *
   * Returns the created session. If the session store is at capacity, the
   * oldest (least recently accessed) session is evicted first.
   */
  createSession(principal: SessionPrincipal, opts?: {
    /** Override default session TTL for this session (ms). */
    sessionTtlMs?: number;
  }): BrowserSession {
    // Evict if at capacity
    while (this.sessions.size >= this.maxSessions) {
      this.evictOldest();
    }

    const now = Date.now();
    const ttl = opts?.sessionTtlMs ?? this.sessionTtlMs;
    const id = generateSessionId();

    const session: BrowserSession = {
      id,
      principal: { ...principal },
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
      lastAccessedAt: new Date(now).toISOString(),
    };

    this.sessions.set(id, session);
    return session;
  }

  // -----------------------------------------------------------------------
  // Get
  // -----------------------------------------------------------------------

  /**
   * Get a session by ID, checking expiry and idle expiry.
   *
   * Updates lastAccessedAt on successful retrieval. Returns null if the
   * session does not exist, has expired, or has been idle too long.
   */
  getSession(sessionId: string): BrowserSession | null {
    this.cleanupExpired();

    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const now = new Date().toISOString();

    // Check absolute expiry
    if (session.expiresAt < now) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Check idle expiry
    const idleExpiry = new Date(
      new Date(session.lastAccessedAt).getTime() + this.idleTtlMs,
    ).toISOString();
    if (idleExpiry < now) {
      this.sessions.delete(sessionId);
      return null;
    }

    // Update last accessed time
    session.lastAccessedAt = now;
    return session;
  }

  // -----------------------------------------------------------------------
  // Remove
  // -----------------------------------------------------------------------

  /**
   * Remove a session by ID.
   *
   * Idempotent — returns true if a session was removed, false if it did
   * not exist.
   */
  removeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  // -----------------------------------------------------------------------
  // Invalidate
  // -----------------------------------------------------------------------

  /**
   * Invalidate all sessions (e.g., on server restart).
   */
  invalidateAll(): void {
    this.sessions.clear();
  }

  /**
   * Invalidate all sessions for a given token ID (e.g., on token revocation).
   */
  invalidatePrincipal(tokenId: string): number {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.principal.id === tokenId) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  // -----------------------------------------------------------------------
  // Introspection (test/debug only — never exposed over HTTP)
  // -----------------------------------------------------------------------

  /** Current session count. */
  get size(): number {
    this.cleanupExpired();
    return this.sessions.size;
  }

  /** Maximum session capacity. */
  get capacity(): number {
    return this.maxSessions;
  }

  /** Return a shallow copy of all active sessions. */
  getAll(): BrowserSession[] {
    this.cleanupExpired();
    return [...this.sessions.values()];
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Evict the least recently accessed session.
   */
  private evictOldest(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, session] of this.sessions) {
      const accessTime = new Date(session.lastAccessedAt).getTime();
      if (accessTime < oldestTime) {
        oldestTime = accessTime;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.sessions.delete(oldestId);
    }
  }

  /**
   * Remove all expired sessions.
   */
  private cleanupExpired(): void {
    const now = new Date().toISOString();

    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
        continue;
      }

      const idleExpiry = new Date(
        new Date(session.lastAccessedAt).getTime() + this.idleTtlMs,
      ).toISOString();
      if (idleExpiry < now) {
        this.sessions.delete(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate an opaque session ID (32 random bytes, base64url-encoded).
 */
function generateSessionId(): string {
  return randomBytes(32).toString("base64url");
}
