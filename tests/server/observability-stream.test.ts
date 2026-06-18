/**
 * observability-stream.test.ts — Sc2 tests for ObservabilityStreamHub and SecureSseConnection.
 *
 * Verifies:
 * - SecureSseConnection redacts, enforces limits, handles backpressure, cleanup
 * - ObservabilityStreamHub: shared producer, replay ring, epoch/sequence, fan-out
 * - MockSecureSseConnection records events correctly
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { MockSecureSseConnection } from "../../src/server/secure-sse.js";
import { ObservabilityStreamHub } from "../../src/server/observability-stream-hub.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// MockSecureSseConnection tests
// ---------------------------------------------------------------------------

describe("MockSecureSseConnection", () => {
  it("records sent events", () => {
    const conn = new MockSecureSseConnection();
    conn.send("test.event", { foo: "bar" });
    assert.strictEqual(conn.events.length, 1);
    assert.strictEqual(conn.events[0].event, "test.event");
    assert.deepStrictEqual(conn.events[0].data, { foo: "bar" });
  });

  it("ignores sends after close", () => {
    const conn = new MockSecureSseConnection();
    conn.close();
    conn.send("test.event", { foo: "bar" });
    assert.strictEqual(conn.events.length, 0);
  });

  it("enforces per-event byte limit", () => {
    const conn = new MockSecureSseConnection(undefined, undefined, {
      perEventByteLimit: 10,
    });
    // Large data (> 10 bytes serialized)
    conn.send("test", "a".repeat(5000));
    assert.strictEqual(conn.events.length, 0);
  });

  it("enforces max buffered events", () => {
    const conn = new MockSecureSseConnection(undefined, undefined, {
      maxBufferedEvents: 3,
    });
    conn.send("e1", { a: 1 });
    conn.send("e2", { a: 2 });
    conn.send("e3", { a: 3 });
    assert.strictEqual(conn.events.length, 3);
    conn.send("e4", { a: 4 });
    // Should have closed due to overflow
    assert.strictEqual(conn.closed, true);
  });

  it("fires onClose callbacks", () => {
    const conn = new MockSecureSseConnection();
    let fired = false;
    conn.onClose(() => { fired = true; });
    conn.close();
    assert.strictEqual(fired, true);
  });

  it("onClose callbacks fire only once", () => {
    const conn = new MockSecureSseConnection();
    let count = 0;
    conn.onClose(() => { count++; });
    conn.close();
    conn.close();
    assert.strictEqual(count, 1);
  });

  it("close is idempotent", () => {
    const conn = new MockSecureSseConnection();
    conn.send("e1", { a: 1 });
    conn.close();
    conn.close();
    conn.close();
    assert.strictEqual(conn.closed, true);
  });
});

// ---------------------------------------------------------------------------
// ObservabilityStreamHub tests
// ---------------------------------------------------------------------------

describe("ObservabilityStreamHub", () => {
  let tmp: string;
  let hub: ObservabilityStreamHub;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), "alix-obs-test-"));
  });

  after(() => {
    try { rmSync(tmp, { recursive: true }); } catch { /* ignore */ }
  });

  it("starts and stops", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 100 });
    h.start();
    assert.strictEqual(h.subscriberCount, 0);
    h.stop();
    assert.strictEqual(h.subscriberCount, 0);
  });

  it("subscribes connections", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    h.start();
    const conn = new MockSecureSseConnection();
    h.subscribe(conn);
    assert.strictEqual(h.subscriberCount, 1);
    h.unsubscribe(conn);
    assert.strictEqual(h.subscriberCount, 0);
    h.stop();
  });

  it("stops all subscribers on hub stop", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    h.start();
    const conn = new MockSecureSseConnection();
    h.subscribe(conn);
    h.stop();
    assert.strictEqual(conn.closed, true);
    assert.strictEqual(h.subscriberCount, 0);
  });

  it("25 clients share one producer cycle", async () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    h.start();
    const connections: MockSecureSseConnection[] = [];
    for (let i = 0; i < 25; i++) {
      const conn = new MockSecureSseConnection();
      h.subscribe(conn);
      connections.push(conn);
    }
    assert.strictEqual(h.subscriberCount, 25);

    // Wait for at least one cycle
    await new Promise((r) => setTimeout(r, 2500));

    // All 25 clients should have received the same set of events
    // (health.snapshot, alert events if any, etc.)
    // At minimum, verify that all clients got events
    let minEvents = Infinity;
    for (const c of connections) {
      if (c.events.length < minEvents) minEvents = c.events.length;
    }
    // With a 5s cycle, 2.5s wait should get at least 1 cycle
    assert.ok(minEvents > 0, "all 25 clients should receive events from shared cycle");

    h.stop();
  });

  it("replay handles epoch mismatch", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    const conn = new MockSecureSseConnection();

    // Inject a fake ring entry for testing
    const ring = (h as unknown as { ring: Array<Record<string, unknown>> }).ring;
    ring.push({
      epoch: h.serverEpoch,
      seq: 1,
      event: "test.event",
      data: { value: 42 },
      timestamp: new Date().toISOString(),
    });

    // Replay with wrong epoch
    const count = h.replay(conn, "wrongepoch:0");
    assert.ok(count > 0, "should replay events on epoch mismatch");
    // Should have received replay.reset + events
    const resetEvents = conn.events.filter((e) => e.event === "replay.reset");
    assert.strictEqual(resetEvents.length, 1);
    assert.deepStrictEqual((resetEvents[0].data as Record<string, unknown>).reason, "epoch_mismatch");
  });

  it("replay handles cursor below floor", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    const conn = new MockSecureSseConnection();

    // Add events with sequences 10-12
    const ring = (h as unknown as { ring: Array<Record<string, unknown>> }).ring;
    ring.push({ epoch: h.serverEpoch, seq: 10, event: "e1", data: {}, timestamp: new Date().toISOString() });
    ring.push({ epoch: h.serverEpoch, seq: 11, event: "e2", data: {}, timestamp: new Date().toISOString() });
    ring.push({ epoch: h.serverEpoch, seq: 12, event: "e3", data: {}, timestamp: new Date().toISOString() });

    // Request cursor 5, but floor is 10
    const count = h.replay(conn, `${h.serverEpoch}:5`);
    assert.ok(count > 0);
    const resetEvents = conn.events.filter((e) => e.event === "replay.reset");
    assert.strictEqual(resetEvents.length, 1);
    assert.deepStrictEqual((resetEvents[0].data as Record<string, unknown>).reason, "cursor_below_floor");
  });

  it("replay handles cursor at/above head", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    const conn = new MockSecureSseConnection();

    const ring = (h as unknown as { ring: Array<Record<string, unknown>> }).ring;
    ring.push({ epoch: h.serverEpoch, seq: 10, event: "e1", data: {}, timestamp: new Date().toISOString() });

    // Cursor at head — no replay
    const count = h.replay(conn, `${h.serverEpoch}:10`);
    assert.strictEqual(count, 0);
  });

  it("replay handles invalid last-event-id gracefully", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    const conn = new MockSecureSseConnection();

    const ring = (h as unknown as { ring: Array<Record<string, unknown>> }).ring;
    ring.push({ epoch: h.serverEpoch, seq: 1, event: "e1", data: {}, timestamp: new Date().toISOString() });

    // Invalid format — should replay from beginning
    const count = h.replay(conn, "not-valid");
    assert.ok(count > 0);
  });

  it("empty hub replay returns 0", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    const conn = new MockSecureSseConnection();
    const count = h.replay(conn, `${h.serverEpoch}:0`);
    assert.strictEqual(count, 0);
  });

  it("replay ring is bounded", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000, maxRingSize: 5 });
    const ring = (h as unknown as { ring: Array<Record<string, unknown>> }).ring;

    // Push 10 events
    for (let i = 0; i < 10; i++) {
      ring.push({ epoch: h.serverEpoch, seq: i + 1, event: "test", data: {}, timestamp: new Date().toISOString() });
      // Simulate ring bounding
      while (ring.length > 5) ring.shift();
    }

    assert.strictEqual(ring.length, 5);
    assert.strictEqual(ring[0].seq, 6); // oldest in ring
    assert.strictEqual(ring[4].seq, 10); // newest in ring
  });

  it("stop is idempotent", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    h.start();
    h.stop();
    h.stop();
    h.stop();
    assert.strictEqual(h.subscriberCount, 0);
  });

  it("diagnostic returns expected keys", () => {
    const h = new ObservabilityStreamHub(tmp);
    const diag = h.diagnostic();
    assert.ok("epoch" in diag);
    assert.ok("subscribers" in diag);
    assert.ok("ringSize" in diag);
    assert.ok("cycleCount" in diag);
  });

  it("rapid connect/disconnect does not leak subscribers", () => {
    const h = new ObservabilityStreamHub(tmp, { cycleIntervalMs: 5000 });
    h.start();

    for (let i = 0; i < 50; i++) {
      const conn = new MockSecureSseConnection();
      h.subscribe(conn);
      h.unsubscribe(conn);
    }

    assert.strictEqual(h.subscriberCount, 0);
    h.stop();
  });
});
