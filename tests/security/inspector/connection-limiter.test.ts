/**
 * connection-limiter.test.ts — Sc1.7 Connection limiter tests.
 *
 * Covers:
 * - Global connection cap
 * - Per-principal cap
 * - Per-address cap
 * - Atomic reserve/release
 * - Idempotent cleanup
 * - Diagnostics counters
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ConnectionLimiter } from "../../../src/security/inspector/connection-limiter.js";

// ---------------------------------------------------------------------------
// Basic reserve/release
// ---------------------------------------------------------------------------

describe("ConnectionLimiter — reserve/release", () => {
  it("reserves a connection and returns a token", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 10 });
    const result = limiter.reserve("principal-1", "127.0.0.1");
    assert.equal(result.allowed, true);
    assert.ok(result.token);
    assert.equal(result.token!.principal, "principal-1");
    assert.equal(result.token!.address, "127.0.0.1");
  });

  it("releases a reserved connection", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 10 });
    const result = limiter.reserve("principal-1", "127.0.0.1");
    assert.equal(result.allowed, true);

    const released = limiter.release(result.token!);
    assert.equal(released, true);
    assert.equal(limiter.activeCount, 0);
  });

  it("release is idempotent", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 10 });
    const result = limiter.reserve("principal-1", "127.0.0.1");
    assert.equal(result.allowed, true);

    limiter.release(result.token!);
    const second = limiter.release(result.token!);
    assert.equal(second, false); // already released
  });

  it("tracks active count correctly", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 10 });
    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p2", "2.2.2.2");
    assert.equal(limiter.activeCount, 2);
  });
});

// ---------------------------------------------------------------------------
// Global cap
// ---------------------------------------------------------------------------

describe("ConnectionLimiter — global cap", () => {
  it("rejects when global cap is reached", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 2 });
    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p2", "2.2.2.2");

    const result = limiter.reserve("p3", "3.3.3.3");
    assert.equal(result.allowed, false);
    assert.equal(result.error, "connection_limit_global");
  });

  it("allows after releasing a slot under global cap", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 2 });
    const r1 = limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p2", "2.2.2.2");

    // Release one
    limiter.release(r1.token!);

    // Should allow a new connection
    const result = limiter.reserve("p3", "3.3.3.3");
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Per-principal cap
// ---------------------------------------------------------------------------

describe("ConnectionLimiter — per-principal cap", () => {
  it("rejects when per-principal cap is reached", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 100,
      maxPerPrincipal: 2,
      maxPerAddress: 100,
    });

    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p1", "2.2.2.2");

    const result = limiter.reserve("p1", "3.3.3.3");
    assert.equal(result.allowed, false);
    assert.equal(result.error, "connection_limit_principal");
  });

  it("allows other principals when one is capped", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 100,
      maxPerPrincipal: 2,
      maxPerAddress: 100,
    });

    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p1", "2.2.2.2");

    // p2 should still be allowed
    const result = limiter.reserve("p2", "3.3.3.3");
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Per-address cap
// ---------------------------------------------------------------------------

describe("ConnectionLimiter — per-address cap", () => {
  it("rejects when per-address cap is reached", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 100,
      maxPerPrincipal: 100,
      maxPerAddress: 2,
    });

    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p2", "1.1.1.1"); // same address, different principal

    const result = limiter.reserve("p3", "1.1.1.1");
    assert.equal(result.allowed, false);
    assert.equal(result.error, "connection_limit_address");
  });

  it("allows different addresses when one is capped", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 100,
      maxPerPrincipal: 100,
      maxPerAddress: 2,
    });

    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p2", "1.1.1.1");

    // Different address should be fine
    const result = limiter.reserve("p3", "2.2.2.2");
    assert.equal(result.allowed, true);
  });
});

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

describe("ConnectionLimiter — bulk operations", () => {
  it("releases all connections for a principal", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 100 });
    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p1", "2.2.2.2");
    limiter.reserve("p2", "3.3.3.3");

    const count = limiter.releasePrincipal("p1");
    assert.equal(count, 2);
    assert.equal(limiter.activeCount, 1);
  });

  it("releasePrincipal is idempotent", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 100 });
    limiter.reserve("p1", "1.1.1.1");

    limiter.releasePrincipal("p1");
    const second = limiter.releasePrincipal("p1");
    assert.equal(second, 0);
  });

  it("releases all connections", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 100 });
    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p2", "2.2.2.2");
    limiter.reserve("p3", "3.3.3.3");

    const count = limiter.releaseAll();
    assert.equal(count, 3);
    assert.equal(limiter.activeCount, 0);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

describe("ConnectionLimiter — diagnostics", () => {
  it("reports correct counts", () => {
    const limiter = new ConnectionLimiter({
      maxGlobal: 100,
      maxPerPrincipal: 10,
      maxPerAddress: 20,
    });

    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p2", "2.2.2.2");

    // Reject one to increment rejection counter
    for (let i = 0; i < 100; i++) {
      limiter.reserve(`p${i + 3}`, `10.0.0.${i + 1}`);
    }
    // Now global cap is hit, next reserve should fail
    const failed = limiter.reserve("px", "9.9.9.9");
    assert.equal(failed.allowed, false);

    const diag = limiter.diagnostic();
    assert.equal(diag.maxGlobal, 100);
    assert.equal(diag.maxPerPrincipal, 10);
    assert.equal(diag.maxPerAddress, 20);
    assert.ok(diag.totalReservations > 0);
    assert.ok(diag.totalRejections > 0);
    assert.ok(typeof diag.byPrincipal === "object");
    assert.ok(typeof diag.byAddress === "object");
  });

  it("reports correct by-principal counts", () => {
    const limiter = new ConnectionLimiter({ maxGlobal: 100 });
    limiter.reserve("p1", "1.1.1.1");
    limiter.reserve("p1", "2.2.2.2");
    limiter.reserve("p2", "3.3.3.3");

    const diag = limiter.diagnostic();
    assert.equal(diag.byPrincipal["p1"], 2);
    assert.equal(diag.byPrincipal["p2"], 1);
  });
});
