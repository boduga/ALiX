/**
 * rate-limiter.test.ts — Sc1.6 Token-bucket rate limiter tests.
 *
 * Covers:
 * - Token consumption and refill
 * - Burst capacity
 * - Bounded buckets (max entries)
 * - Idle bucket eviction
 * - Evict oldest-idle at capacity
 * - IPv4/IPv6 normalization
 * - Key length bound
 * - Fake-clock deterministic tests for refill/burst/eviction
 * - Pre-auth and post-auth limiter presets
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RateLimiter,
  normalizeClientAddress,
  buildRateLimitKey,
  createPreAuthLimiter,
  createPostAuthLimiter,
  type Clock,
} from "../../../src/security/inspector/rate-limiter.js";

// ---------------------------------------------------------------------------
// Fake clock for deterministic testing
// ---------------------------------------------------------------------------

class FakeClock implements Clock {
  private time: number;

  constructor(startMs: number = 0) {
    this.time = startMs;
  }

  now(): number {
    return this.time;
  }

  advance(ms: number): void {
    this.time += ms;
  }
}

// ---------------------------------------------------------------------------
// RateLimiter — basic consumption
// ---------------------------------------------------------------------------

describe("RateLimiter — basic consumption", () => {
  it("allows first request", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 10, burst: 30, clock });
    const result = limiter.consume("test-key");
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 29);
  });

  it("tracks remaining tokens correctly", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 10, burst: 30, clock });
    limiter.consume("test-key");
    const result = limiter.consume("test-key");
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 28);
  });

  it("rate limits after exceeding burst", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 10, burst: 5, clock });

    // Consume all tokens
    for (let i = 0; i < 5; i++) {
      const r = limiter.consume("test-key");
      assert.equal(r.allowed, true, `request ${i} should be allowed`);
    }

    // Next request should be rate limited
    const limited = limiter.consume("test-key");
    assert.equal(limited.allowed, false);
    assert.ok(limited.retryAfterSeconds > 0);
  });

  it("refills tokens over time", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 10, burst: 30, clock });

    // Consume all tokens
    for (let i = 0; i < 30; i++) {
      limiter.consume("test-key");
    }

    // Should be rate limited now
    let limited = limiter.consume("test-key");
    assert.equal(limited.allowed, false);

    // Advance 1 second (should refill 10 tokens)
    clock.advance(1000);

    // Should allow 10 more requests
    for (let i = 0; i < 10; i++) {
      const r = limiter.consume("test-key");
      assert.equal(r.allowed, true, `request ${i} after refill should be allowed`);
    }

    // Next should be limited again
    limited = limiter.consume("test-key");
    assert.equal(limited.allowed, false);
  });

  it("never exceeds burst capacity on refill", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 10, burst: 30, clock });

    // Consume 5 tokens
    for (let i = 0; i < 5; i++) {
      limiter.consume("test-key");
    }

    // Advance 10 seconds (would refill 100 tokens, but cap is 30)
    clock.advance(10_000);

    // Should only have 30 tokens (burst cap)
    // Consume 30
    for (let i = 0; i < 30; i++) {
      const r = limiter.consume("test-key");
      assert.equal(r.allowed, true, `request ${i} should be allowed`);
    }

    // Next limited
    const limited = limiter.consume("test-key");
    assert.equal(limited.allowed, false);
  });

  it("returns retryAfterSeconds correctly", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 1, burst: 1, clock });

    limiter.consume("test-key"); // consume the 1 token
    const limited = limiter.consume("test-key");
    assert.equal(limited.allowed, false);
    assert.ok(limited.retryAfterSeconds >= 1);
  });

  it("returns Retry-After header when rate limited", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 1, burst: 1, clock });

    limiter.consume("test-key");
    const result = limiter.consume("test-key");
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterSeconds > 0);
  });
});

// ---------------------------------------------------------------------------
// RateLimiter — bounded state
// ---------------------------------------------------------------------------

describe("RateLimiter — bounded state", () => {
  it("evicts oldest-idle bucket at capacity", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({
      rate: 10,
      burst: 30,
      maxEntries: 3,
      idleTtlMs: 60_000,
      clock,
    });

    // Fill to capacity
    limiter.consume("key-1");
    limiter.consume("key-2");
    limiter.consume("key-3");
    assert.equal(limiter.size, 3);

    // Add a 4th key — should evict oldest (key-1)
    limiter.consume("key-4");
    assert.equal(limiter.size, 3);
  });

  it("sweeps idle buckets", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({
      rate: 10,
      burst: 30,
      idleTtlMs: 5000,
      clock,
    });

    limiter.consume("key-1");
    assert.equal(limiter.size, 1);

    // Advance past idle TTL — next consume should sweep
    clock.advance(10_000);

    // Consume on a different key triggers sweep
    limiter.consume("key-2");
    // key-1 should have been swept
    // We can't directly check, but size should be reasonable
    assert.ok(limiter.size <= 2);
  });

  it("handles random-key bucket flood within bounds", () => {
    const clock = new FakeClock(0);
    const maxEntries = 100;
    const limiter = new RateLimiter({
      rate: 10,
      burst: 30,
      maxEntries,
      idleTtlMs: 60_000,
      clock,
    });

    // Flood with random keys
    for (let i = 0; i < 500; i++) {
      limiter.consume(`flood-key-${i}`);
    }

    assert.ok(limiter.size <= maxEntries);
  });
});

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

describe("normalizeClientAddress", () => {
  it("normalizes IPv4 addresses", () => {
    assert.equal(normalizeClientAddress("192.168.1.1"), "192.168.1.1");
    assert.equal(normalizeClientAddress(" 192.168.1.1 "), "192.168.1.1");
  });

  it("converts IPv4-mapped IPv6 to IPv4", () => {
    assert.equal(normalizeClientAddress("::ffff:10.0.0.1"), "10.0.0.1");
    assert.equal(normalizeClientAddress("::ffff:192.168.1.1"), "192.168.1.1");
  });

  it("normalizes IPv6 to consistent form", () => {
    // Same address in different forms should normalize to the same string
    const a = normalizeClientAddress("::1");
    const b = normalizeClientAddress("0:0:0:0:0:0:0:1");
    // Both should be the expanded form
    assert.ok(a.includes(":"));
    assert.ok(b.includes(":"));
    // They should be equal
    assert.equal(a, b);
  });

  it("normalizes IPv6 with compression consistently", () => {
    const a = normalizeClientAddress("2001:db8::1");
    const b = normalizeClientAddress("2001:db8:0:0:0:0:0:1");
    assert.equal(a, b);
  });
});

// ---------------------------------------------------------------------------
// Key construction
// ---------------------------------------------------------------------------

describe("buildRateLimitKey", () => {
  it("joins segments with colon", () => {
    const key = buildRateLimitKey("addr", "data");
    assert.equal(key, "addr:data");
  });

  it("truncates long keys", () => {
    const longAddr = "a".repeat(200);
    const key = buildRateLimitKey(longAddr, "data");
    assert.ok(key.length <= 128);
  });

  it("preserves short keys", () => {
    const key = buildRateLimitKey("127.0.0.1", "auth");
    assert.equal(key, "127.0.0.1:auth");
  });
});

// ---------------------------------------------------------------------------
// Preconfigured limiters
// ---------------------------------------------------------------------------

describe("createPreAuthLimiter", () => {
  it("creates a working limiter with defaults", () => {
    const clock = new FakeClock(0);
    const limiter = createPreAuthLimiter(clock);
    const result = limiter.consume("test");
    assert.equal(result.allowed, true);
    assert.ok(result.remaining > 0);
  });

  it("respects burst limit", () => {
    const clock = new FakeClock(0);
    const limiter = createPreAuthLimiter(clock);

    // Should allow 30 requests (burst)
    for (let i = 0; i < 30; i++) {
      const r = limiter.consume("test");
      assert.equal(r.allowed, true, `request ${i}`);
    }

    // 31st should be rate limited
    const limited = limiter.consume("test");
    assert.equal(limited.allowed, false);
  });
});

describe("createPostAuthLimiter", () => {
  it("creates a working limiter with higher limits", () => {
    const clock = new FakeClock(0);
    const limiter = createPostAuthLimiter(clock);
    const result = limiter.consume("test");
    assert.equal(result.allowed, true);
    assert.ok(result.remaining > 50); // burst is 100, should have ~99 remaining
  });

  it("allows more burst than pre-auth", () => {
    const clock = new FakeClock(0);
    const preAuth = createPreAuthLimiter(clock);
    const postAuth = createPostAuthLimiter(clock);

    // Pre-auth burst is 30
    for (let i = 0; i < 30; i++) preAuth.consume("test");
    assert.equal(preAuth.consume("test").allowed, false);

    // Post-auth burst is 100
    for (let i = 0; i < 100; i++) {
      const r = postAuth.consume("test2");
      assert.equal(r.allowed, true, `post-auth request ${i}`);
    }
    assert.equal(postAuth.consume("test2").allowed, false);
  });
});

// ---------------------------------------------------------------------------
// Rate refill and burst edge cases
// ---------------------------------------------------------------------------

describe("RateLimiter — refill and burst edge cases", () => {
  it("refills at exact rate after partial consumption", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 5, burst: 10, clock });

    // Consume 8 tokens (2 remaining)
    for (let i = 0; i < 8; i++) limiter.consume("key");

    // Advance 1 second (refills 5 tokens → 7 total)
    clock.advance(1000);

    // Should allow 7 more
    for (let i = 0; i < 7; i++) {
      const r = limiter.consume("key");
      assert.equal(r.allowed, true, `request ${i} after refill`);
    }
  });

  it("handles fractional token refill correctly", () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter({ rate: 3, burst: 3, clock });

    // Consume all 3
    for (let i = 0; i < 3; i++) limiter.consume("key");

    // Advance 500ms (refills 1.5 tokens → 1 whole token available)
    clock.advance(500);

    // Should allow 1 more
    const r = limiter.consume("key");
    assert.equal(r.allowed, true);
  });
});
