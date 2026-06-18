/**
 * inspector-abuse.test.ts — Sc1 stress tests for rate limiting and connection limits.
 *
 * Verifies that:
 * - Rate limiter stays bounded under random-key flood
 * - Connection limiter enforces caps under concurrent reservation
 * - No unbounded map growth under sustained abuse
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, normalizeClientAddress } from "../../src/security/inspector/rate-limiter.js";
import { ConnectionLimiter } from "../../src/security/inspector/connection-limiter.js";
import { validateHost } from "../../src/security/inspector/host-policy.js";

// ---------------------------------------------------------------------------
// Fake clock for deterministic stress tests
// ---------------------------------------------------------------------------

class FakeClock {
  time: number = 0;
  now(): number { return this.time; }
  advance(ms: number): void { this.time += ms; }
}

// ---------------------------------------------------------------------------
// Rate limiter — unbounded growth
// ---------------------------------------------------------------------------

describe("RateLimiter — stress: no unbounded growth", () => {
  it("stays bounded under 1000 random-key requests", () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({
      rate: 100,
      burst: 200,
      maxEntries: 500,
      idleTtlMs: 30_000,
      clock,
    });

    for (let i = 0; i < 1000; i++) {
      limiter.consume(`stress-key-${i % 800}`);
    }

    assert.ok(limiter.size <= 500, `size ${limiter.size} should be <= 500`);
  });

  it("evicts idle entries over time", () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({
      rate: 10,
      burst: 30,
      maxEntries: 500,
      idleTtlMs: 5000,
      clock,
    });

    // Fill 100 buckets
    for (let i = 0; i < 100; i++) {
      limiter.consume(`idle-key-${i}`);
    }

    const beforeSweep = limiter.size;
    assert.ok(beforeSweep > 10, "should have at least some entries");

    // Advance past idle TTL
    clock.advance(10_000);

    // Any consume triggers sweep
    limiter.consume("trigger-sweep");

    // After sweep, only the last key should remain
    assert.ok(limiter.size <= 1 + 1, "should have swept most entries"); // trigger-sweep + 0-1 survivors
  });

  it("handles sustained abuse without memory leak", () => {
    const clock = new FakeClock();
    const limiter = new RateLimiter({
      rate: 1000,
      burst: 2000,
      maxEntries: 250,
      idleTtlMs: 10_000,
      clock,
    });

    // Simulate sustained attack: 5000 requests, new keys every time
    for (let i = 0; i < 5000; i++) {
      limiter.consume(`attack-${i}`);
      // Advance slightly to trigger periodic sweeps
      if (i % 500 === 0) {
        clock.advance(5000);
      }
    }

    assert.ok(limiter.size <= 250, `size ${limiter.size} should be <= 250`);
  });

  it("normalizes IPv4 and IPv6 client addresses identically", () => {
    // Same client via IPv4 and IPv6-mapped should normalize to identical keys
    const key1 = `addr:${normalizeClientAddress("192.168.1.1")}:data`;
    const key2 = `addr:${normalizeClientAddress("::ffff:192.168.1.1")}:data`;
    assert.equal(key1, key2, "normalized keys should be identical");
  });
});

// ---------------------------------------------------------------------------
// Connection limiter — stress
// ---------------------------------------------------------------------------

describe("ConnectionLimiter — stress: caps enforced", () => {
  it("enforces global cap under concurrent reservations", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 50,
      maxPerPrincipal: 100,
      maxPerAddress: 100,
    });

    // Reserve up to global cap
    for (let i = 0; i < 50; i++) {
      const result = limiter.reserve(`p${i}`, `10.0.0.${i}`);
      assert.equal(result.allowed, true, `reservation ${i} should succeed`);
    }

    // Next should fail
    const failed = limiter.reserve("extra", "10.0.0.99");
    assert.equal(failed.allowed, false);
    assert.equal(failed.error, "connection_limit_global");
  });

  it("enforces per-principal cap under many principals", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 200,
      maxPerPrincipal: 3,
      maxPerAddress: 200,
    });

    // Fill principal-1 to cap
    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p1", "2.2.2.2");
    limiter.reserve("p1", "3.3.3.3");

    const failed = limiter.reserve("p1", "4.4.4.4");
    assert.equal(failed.allowed, false);
    assert.equal(failed.error, "connection_limit_principal");
  });

  it("enforces per-address cap across many principals", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 200,
      maxPerPrincipal: 200,
      maxPerAddress: 2,
    });

    // Same address from different principals
    limiter.reserve("p1", "shared-ip");
    limiter.reserve("p2", "shared-ip");

    const failed = limiter.reserve("p3", "shared-ip");
    assert.equal(failed.allowed, false);
    assert.equal(failed.error, "connection_limit_address");
  });

  it("handles release after cap and re-reserve", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 3,
      maxPerPrincipal: 100,
      maxPerAddress: 100,
    });

    const r1 = limiter.reserve("p1", "1.1.1.1");
    const r2 = limiter.reserve("p2", "2.2.2.2");
    const r3 = limiter.reserve("p3", "3.3.3.3");

    // Cap reached
    assert.equal(limiter.reserve("p4", "4.4.4.4").allowed, false);

    // Release one
    limiter.release(r2.token!);

    // Should be able to reserve again
    const r4 = limiter.reserve("p4", "4.4.4.4");
    assert.equal(r4.allowed, true);
  });

  it("releaseAll clears everything", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 100 });
    for (let i = 0; i < 50; i++) {
      limiter.reserve(`p${i}`, `10.0.0.${i}`);
    }
    assert.equal(limiter.activeCount, 50);

    limiter.releaseAll();
    assert.equal(limiter.activeCount, 0);
  });
});

// ---------------------------------------------------------------------------
// Host policy — DNS rebinding + foreign host stress
// ---------------------------------------------------------------------------

describe("HostPolicy — stress: DNS rebinding and foreign hosts", () => {
  const ALLOWED = ["127.0.0.1", "::1", "localhost"];

  it("rejects all DNS rebinding attempts (IP for hostname)", () => {
    // Each rebinding variant
    const rebindingHosts = [
      "192.168.1.1",
      "10.0.0.1",
      "172.16.0.1",
      "169.254.1.1",
    ];

    for (const host of rebindingHosts) {
      const result = validateHost(host, ALLOWED);
      assert.ok(!result.ok, `should reject ${host}`);
    }
  });

  it("rejects all foreign hostnames", () => {
    const foreignHosts = [
      "evil.com",
      "attacker.example.org",
      "internal.corp.net",
    ];

    for (const host of foreignHosts) {
      const result = validateHost(host, ALLOWED);
      assert.ok(!result.ok, `should reject ${host}`);
      if (!result.ok) {
        assert.ok(!result.error.includes(host), `error should not leak ${host}`);
      }
    }
  });
});
