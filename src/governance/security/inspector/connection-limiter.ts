/**
 * P4.3-Sc1.7 — Connection Limiter
 *
 * Bounds concurrent SSE connections at three levels:
 * - Global: total active SSE connections across all principals
 * - Per-principal: max SSE connections for a single authenticated principal
 * - Per-address: max SSE connections from a single client address
 *
 * Key invariants:
 * - Reserve/release is atomic within the process (Map operations in
 *   single-threaded Node.js event loop are atomic).
 * - Cleanup is idempotent (release on an already-released connection
 *   is a no-op).
 * - Diagnostics counters are available for `alix doctor`.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionLimiterConfig {
  /** Maximum total active SSE connections (default: 100). */
  maxGlobal?: number;
  /** Maximum SSE connections per authenticated principal (default: 10). */
  maxPerPrincipal?: number;
  /** Maximum SSE connections per client address (default: 20). */
  maxPerAddress?: number;
}

export interface ReserveResult {
  /** Whether the connection was accepted. */
  allowed: boolean;
  /** Stable error code if rejected. */
  error?: string;
  /** Token for release (only valid when allowed). */
  token?: ConnectionToken;
}

export interface ConnectionToken {
  /** Unique token ID (for release). */
  id: string;
  /** The principal ID (or "anonymous" for unauthenticated). */
  principal: string;
  /** The normalized client address. */
  address: string;
}

export interface ConnectionDiagnostic {
  /** Current active connections. */
  activeConnections: number;
  /** Global maximum. */
  maxGlobal: number;
  /** Per-principal maximum. */
  maxPerPrincipal: number;
  /** Per-address maximum. */
  maxPerAddress: number;
  /** Active connections by principal. */
  byPrincipal: Record<string, number>;
  /** Active connections by address. */
  byAddress: Record<string, number>;
  /** Total reservations (for monitoring). */
  totalReservations: number;
  /** Total releases (for monitoring). */
  totalReleases: number;
  /** Total rejections (for monitoring). */
  totalRejections: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_GLOBAL = 100;
const DEFAULT_MAX_PER_PRINCIPAL = 10;
const DEFAULT_MAX_PER_ADDRESS = 20;

// ---------------------------------------------------------------------------
// ConnectionLimiter
// ---------------------------------------------------------------------------

export class ConnectionLimiter {
  private readonly maxGlobal: number;
  private readonly maxPerPrincipal: number;
  private readonly maxPerAddress: number;

  /** Active connection tokens keyed by token ID. */
  private readonly active = new Map<string, ConnectionToken>();

  /** Counts by principal. */
  private readonly byPrincipal = new Map<string, number>();

  /** Counts by address. */
  private readonly byAddress = new Map<string, number>();

  // Diagnostic counters
  private reservations = 0;
  private releases = 0;
  private rejections = 0;

  /** Counter for unique token IDs. */
  private tokenSeq = 0;

  constructor(config?: ConnectionLimiterConfig) {
    this.maxGlobal = config?.maxGlobal ?? DEFAULT_MAX_GLOBAL;
    this.maxPerPrincipal = config?.maxPerPrincipal ?? DEFAULT_MAX_PER_PRINCIPAL;
    this.maxPerAddress = config?.maxPerAddress ?? DEFAULT_MAX_PER_ADDRESS;
  }

  // -----------------------------------------------------------------------
  // Reserve
  // -----------------------------------------------------------------------

  /**
   * Attempt to reserve a connection slot.
   *
   * Checks (in order):
   * 1. Global cap
   * 2. Per-address cap
   * 3. Per-principal cap
   *
   * Returns a token that must be released when the connection closes.
   * Release is idempotent — calling it multiple times on the same
   * token is safe.
   */
  reserve(principal: string, address: string): ReserveResult {
    // ── 1. Global cap ────────────────────────────────────────────────
    if (this.active.size >= this.maxGlobal) {
      this.rejections++;
      return { allowed: false, error: "connection_limit_global" };
    }

    // ── 2. Per-address cap ───────────────────────────────────────────
    const addrCount = this.byAddress.get(address) ?? 0;
    if (addrCount >= this.maxPerAddress) {
      this.rejections++;
      return { allowed: false, error: "connection_limit_address" };
    }

    // ── 3. Per-principal cap ─────────────────────────────────────────
    const principalCount = this.byPrincipal.get(principal) ?? 0;
    if (principalCount >= this.maxPerPrincipal) {
      this.rejections++;
      return { allowed: false, error: "connection_limit_principal" };
    }

    // ── Reserve ──────────────────────────────────────────────────────
    const tokenId = `conn-${++this.tokenSeq}-${Date.now().toString(36)}`;
    const token: ConnectionToken = { id: tokenId, principal, address };

    this.active.set(tokenId, token);
    this.byAddress.set(address, addrCount + 1);
    this.byPrincipal.set(principal, principalCount + 1);
    this.reservations++;

    return { allowed: true, token };
  }

  // -----------------------------------------------------------------------
  // Release
  // -----------------------------------------------------------------------

  /**
   * Release a reserved connection slot.
   *
   * Idempotent — calling twice on the same token is safe.
   * Returns true if the token was found and released, false if it
   * was already released or never existed.
   */
  release(token: ConnectionToken): boolean {
    if (!this.active.has(token.id)) {
      return false; // already released or never existed
    }

    this.active.delete(token.id);

    // Decrement address count
    const addrCount = this.byAddress.get(token.address);
    if (addrCount !== undefined) {
      if (addrCount <= 1) {
        this.byAddress.delete(token.address);
      } else {
        this.byAddress.set(token.address, addrCount - 1);
      }
    }

    // Decrement principal count
    const principalCount = this.byPrincipal.get(token.principal);
    if (principalCount !== undefined) {
      if (principalCount <= 1) {
        this.byPrincipal.delete(token.principal);
      } else {
        this.byPrincipal.set(token.principal, principalCount - 1);
      }
    }

    this.releases++;
    return true;
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Release all connections for a given principal.
   *
   * Idempotent — safe to call even if the principal has no connections.
   * Returns the number of connections released.
   */
  releasePrincipal(principal: string): number {
    let count = 0;
    for (const [id, token] of this.active) {
      if (token.principal === principal) {
        this.active.delete(id);
        count++;
      }
    }

    // Reset the principal counter
    if (count > 0) {
      this.byPrincipal.delete(principal);
      this.releases += count;
    }

    // Recalculate address counts (expensive but only used on principal removal)
    this.rebuildAddressCounts();

    return count;
  }

  /**
   * Release all connections.
   *
   * Idempotent — safe to call on an empty limiter.
   * Returns the number of connections released.
   */
  releaseAll(): number {
    const count = this.active.size;
    this.active.clear();
    this.byPrincipal.clear();
    this.byAddress.clear();
    this.releases += count;
    return count;
  }

  // -----------------------------------------------------------------------
  // Diagnostics
  // -----------------------------------------------------------------------

  /**
   * Current active connection count.
   */
  get activeCount(): number {
    return this.active.size;
  }

  /**
   * Produce a diagnostic snapshot for `alix doctor`.
   */
  diagnostic(): ConnectionDiagnostic {
    // Build by-principal and by-address maps from active tokens
    const byPrincipal: Record<string, number> = {};
    const byAddress: Record<string, number> = {};

    for (const token of this.active.values()) {
      byPrincipal[token.principal] = (byPrincipal[token.principal] ?? 0) + 1;
      byAddress[token.address] = (byAddress[token.address] ?? 0) + 1;
    }

    return {
      activeConnections: this.active.size,
      maxGlobal: this.maxGlobal,
      maxPerPrincipal: this.maxPerPrincipal,
      maxPerAddress: this.maxPerAddress,
      byPrincipal,
      byAddress,
      totalReservations: this.reservations,
      totalReleases: this.releases,
      totalRejections: this.rejections,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Recalculate per-address counts from active tokens.
   * Used after bulk principal release to keep counters consistent.
   */
  private rebuildAddressCounts(): void {
    this.byAddress.clear();
    for (const token of this.active.values()) {
      const count = this.byAddress.get(token.address) ?? 0;
      this.byAddress.set(token.address, count + 1);
    }
  }
}
