/**
 * P4.3-Sc1.6 — Two-Stage Token-Bucket Rate Limiter
 *
 * Provides pre-auth and post-auth rate limiting using a token-bucket
 * algorithm with monotonic time, bounded state, and idle eviction.
 *
 * Key design:
 * - Token bucket: refill at `rate` tokens/second, burst up to `burst` tokens.
 * - Monotonic clock: injected via `Clock` interface for deterministic testing.
 * - Bounded buckets: `maxEntries` hard cap; evicts oldest-idle bucket on overflow.
 * - Idle eviction: buckets not used within `idleTtlMs` are swept.
 * - Address normalization: IPv4/IPv6 normalized to consistent forms.
 * - Key-length bound: bucket keys are capped at 128 characters.
 *
 * Two-stage usage:
 * - Pre-auth:   keyed by (normalizedAddress, routeClass)
 * - Post-auth:  keyed by (principal, normalizedAddress, routeClass)
 *
 * Follows the discriminated-union pattern for consumption results.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Clock interface (for fake-clock testing)
// ---------------------------------------------------------------------------

export interface Clock {
  /** Current monotonic time in milliseconds. */
  now(): number;
}

/** Default clock using performance.now(). */
export const monotonicClock: Clock = {
  now: () => performance.now(),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimiterConfig {
  /** Token refill rate (tokens per second). */
  rate: number;
  /** Maximum burst capacity (tokens). */
  burst: number;
  /** Maximum number of tracked buckets. */
  maxEntries?: number;
  /** Idle time after which a bucket is evicted (ms). */
  idleTtlMs?: number;
  /** Clock for time (injectable for testing). */
  clock?: Clock;
}

export interface ConsumeResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Tokens remaining after this consumption. */
  remaining: number;
  /** Monotonic time (ms) when the bucket resets to full. */
  resetAt: number;
  /** Seconds until reset, for Retry-After header (0 if allowed). */
  retryAfterSeconds: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_IDLE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Bucket state
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefill: number; // monotonic ms
  lastAccess: number; // monotonic ms
}

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an IP address for consistent rate-limit keying.
 *
 * - IPv4: standard dotted-quad (e.g., "192.168.1.1")
 * - IPv6: fully expanded, lowercase, zero-compressed removed
 * - IPv4-mapped IPv6 (::ffff:x.x.x.x) → IPv4 string
 */
export function normalizeClientAddress(addr: string): string {
  const trimmed = addr.trim().toLowerCase();

  // IPv4-mapped IPv6 → extract IPv4
  const v4MapMatch = trimmed.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MapMatch) {
    return v4MapMatch[1];
  }

  // Bare IPv4 — normalize each octet
  const v4Parts = trimmed.split(".");
  if (v4Parts.length === 4) {
    const octets = v4Parts.map((p) => {
      const n = parseInt(p, 10);
      return isNaN(n) ? null : n;
    });
    if (octets.every((o): o is number => o !== null && o >= 0 && o <= 255)) {
      return octets.join(".");
    }
  }

  // IPv6 — full expansion
  if (trimmed.includes(":")) {
    return expandIPv6(trimmed);
  }

  return trimmed;
}

/**
 * Fully expand an IPv6 address.
 */
function expandIPv6(addr: string): string {
  let expanded = addr;

  if (expanded.includes("::")) {
    const [left, right] = expanded.split("::");
    const leftParts = left ? left.split(":").filter(Boolean) : [];
    const rightParts = right ? right.split(":").filter(Boolean) : [];
    const missing = 8 - leftParts.length - rightParts.length;
    if (missing < 0) return addr; // malformed, return as-is
    expanded = [
      ...leftParts,
      ...Array(missing).fill("0"),
      ...rightParts,
    ].join(":");
  }

  const parts = expanded.split(":");
  if (parts.length !== 8) return addr;

  return parts.map((p) => {
    const n = parseInt(p || "0", 16);
    return isNaN(n) ? "0" : n.toString(16);
  }).join(":");
}

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

/** Maximum key length to prevent unbounded key growth. */
const MAX_KEY_LENGTH = 128;

/**
 * Build a rate-limit key, truncating to MAX_KEY_LENGTH.
 */
export function buildRateLimitKey(...segments: string[]): string {
  const key = segments.join(":");
  if (key.length <= MAX_KEY_LENGTH) return key;
  // Truncate the last segment to fit
  const prefix = segments.slice(0, -1).join(":");
  const prefixLen = prefix.length + 1; // +1 for the colon
  const maxLastLen = MAX_KEY_LENGTH - prefixLen;
  if (maxLastLen <= 0) return key.slice(0, MAX_KEY_LENGTH);
  const last = segments[segments.length - 1];
  return `${prefix}:${last.slice(0, maxLastLen)}`;
}

// ---------------------------------------------------------------------------
// RateLimiter
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly rate: number;
  private readonly burst: number;
  private readonly maxEntries: number;
  private readonly idleTtlMs: number;
  private readonly clock: Clock;
  private lastSweepAt: number;

  constructor(config: RateLimiterConfig) {
    this.rate = config.rate;
    this.burst = config.burst;
    this.maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.idleTtlMs = config.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.clock = config.clock ?? monotonicClock;
    this.lastSweepAt = this.clock.now();
  }

  // -----------------------------------------------------------------------
  // Consume
  // -----------------------------------------------------------------------

  /**
   * Attempt to consume `tokens` (default 1) from a bucket.
   *
   * Returns a ConsumeResult with:
   * - `allowed`: whether the request is permitted
   * - `remaining`: tokens left after consumption
   * - `resetAt`: monotonic time when the bucket refills fully
   * - `retryAfterSeconds`: seconds until retry (0 if allowed)
   */
  consume(key: string, tokens: number = 1): ConsumeResult {
    const now = this.clock.now();

    // Periodic idle sweep
    if (now - this.lastSweepAt > this.idleTtlMs) {
      this.sweepIdle(now);
      this.lastSweepAt = now;
    }

    let bucket = this.buckets.get(key);

    if (!bucket) {
      // Create new bucket at full capacity
      this.ensureCapacity();
      bucket = {
        tokens: this.burst - tokens,
        lastRefill: now,
        lastAccess: now,
      };
      this.buckets.set(key, bucket);

      const resetAt = now + (tokens / this.rate) * 1000;
      return {
        allowed: true,
        remaining: Math.max(0, bucket.tokens),
        resetAt,
        retryAfterSeconds: 0,
      };
    }

    // Refill existing bucket
    const elapsed = now - bucket.lastRefill;
    const refill = (elapsed / 1000) * this.rate;
    bucket.tokens = Math.min(this.burst, bucket.tokens + refill);
    bucket.lastRefill = now;
    bucket.lastAccess = now;

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens;
      return {
        allowed: true,
        remaining: Math.floor(bucket.tokens),
        resetAt: now + ((this.burst - bucket.tokens) / this.rate) * 1000,
        retryAfterSeconds: 0,
      };
    }

    // Rate limited
    const tokensNeeded = tokens - bucket.tokens;
    const waitSeconds = Math.ceil(tokensNeeded / this.rate);

    return {
      allowed: false,
      remaining: Math.floor(bucket.tokens),
      resetAt: now + waitSeconds * 1000,
      retryAfterSeconds: waitSeconds,
    };
  }

  // -----------------------------------------------------------------------
  // State management
  // -----------------------------------------------------------------------

  /**
   * Current number of tracked buckets.
   */
  get size(): number {
    return this.buckets.size;
  }

  /**
   * Maximum number of tracked buckets.
   */
  get capacity(): number {
    return this.maxEntries;
  }

  /**
   * Clear all buckets (for testing).
   */
  clear(): void {
    this.buckets.clear();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Ensure the bucket count does not exceed maxEntries.
   * Evicts the oldest-idle bucket if we are at capacity.
   */
  private ensureCapacity(): void {
    if (this.buckets.size < this.maxEntries) return;

    // Find the oldest-idle bucket
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, bucket] of this.buckets) {
      if (bucket.lastAccess < oldestAccess) {
        oldestAccess = bucket.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.buckets.delete(oldestKey);
    }
  }

  /**
   * Sweep idle buckets (not accessed within idleTtlMs).
   */
  private sweepIdle(now: number): void {
    const cutoff = now - this.idleTtlMs;

    for (const [key, bucket] of this.buckets) {
      if (bucket.lastAccess < cutoff) {
        this.buckets.delete(key);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rate-limit header helpers
// ---------------------------------------------------------------------------

/**
 * Build rate-limit response headers.
 *
 * Standard headers:
 * - X-RateLimit-Limit: max tokens (burst)
 * - X-RateLimit-Remaining: tokens remaining
 * - X-RateLimit-Reset: monotonic time when bucket refills
 * - Retry-After: seconds until retry (only when rate-limited)
 *
 * These headers are informational and safe to emit — they do not
 * leak internal state beyond what's already observable.
 */
export function buildRateLimitHeaders(
  result: ConsumeResult,
  burst: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(burst),
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt)),
  };

  if (!result.allowed) {
    headers["retry-after"] = String(result.retryAfterSeconds);
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Preconfigured rate limiters
// ---------------------------------------------------------------------------

/**
 * Create a pre-auth rate limiter.
 *
 * Pre-auth limits are applied BEFORE authentication, keyed by
 * (normalizedAddress, routeClass). This prevents unauthenticated
 * clients from exhausting resources.
 */
export function createPreAuthLimiter(clock?: Clock): RateLimiter {
  return new RateLimiter({
    rate: 10, // 10 requests/second
    burst: 30, // allow bursts up to 30
    maxEntries: 10_000,
    idleTtlMs: 5 * 60 * 1000, // 5 minute idle eviction
    clock,
  });
}

/**
 * Create a post-auth rate limiter.
 *
 * Post-auth limits are applied AFTER authentication, keyed by
 * (principal, normalizedAddress, routeClass). This prevents
 * authenticated clients from overwhelming the server.
 */
export function createPostAuthLimiter(clock?: Clock): RateLimiter {
  return new RateLimiter({
    rate: 50, // 50 requests/second for authenticated clients
    burst: 100, // allow bursts up to 100
    maxEntries: 10_000,
    idleTtlMs: 5 * 60 * 1000,
    clock,
  });
}
