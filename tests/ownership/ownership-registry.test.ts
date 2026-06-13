import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OwnershipRegistry } from "../../src/ownership/ownership-registry.js";
import type { OwnershipEventSink } from "../../src/ownership/ownership-types.js";

describe("OwnershipRegistry", () => {
  let dir: string;
  let reg: OwnershipRegistry;
  let events: string[];

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "own-test-"));
    mkdirSync(join(dir, ".alix", "ownership"), { recursive: true });
    events = [];
    const sink: OwnershipEventSink = { emit: async (event: string) => { events.push(event); } };
    reg = new OwnershipRegistry(dir, { eventSink: sink, sessionId: "test-session" });
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // ─── Acquire ────────────────────────────────────────────────────

  it("acquire creates a new record", async () => {
    const result = await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src/runtime"), recursive: true },
      mode: "exclusive-write",
    });
    assert.equal(result.acquired, true);
    assert.ok(result.record!.id);
    assert.equal(result.record!.agentId, "agent-1");
    assert.equal(result.record!.status, "active");
  });

  it("acquire with same scope+mode returns existing (renew)", async () => {
    const scope = { kind: "path" as const, root: join(dir, "src/runtime"), recursive: true };
    const r1 = await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write" });
    const r2 = await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write" });
    assert.equal(r1.record!.id, r2.record!.id);
  });

  it("conflicting acquisition is rejected", async () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write" });
    const result = await reg.acquire({ agentId: "agent-2", scope, mode: "exclusive-write" });
    assert.equal(result.acquired, false);
    assert.ok(result.conflict);
    assert.ok(result.conflict.reason.includes("agent-1"));
  });

  it("shared-read does not conflict with exclusive-write", async () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write" });
    const result = await reg.acquire({ agentId: "agent-2", scope, mode: "shared-read" });
    assert.equal(result.acquired, true);
  });

  it("exclusive-write conflicts with existing shared-read", async () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope, mode: "shared-read" });
    const result = await reg.acquire({ agentId: "agent-2", scope, mode: "exclusive-write" });
    assert.equal(result.acquired, false);
  });

  it("review-only never conflicts", async () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write" });
    const result = await reg.acquire({ agentId: "agent-2", scope, mode: "review-only" });
    assert.equal(result.acquired, true);
  });

  it("same agent re-access is allowed", async () => {
    const scope = { kind: "path" as const, root: join(dir, "src/runtime"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write" });
    const result = await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });
    assert.equal(result.acquired, true);
  });

  // ─── Release ────────────────────────────────────────────────────

  it("release marks as released", async () => {
    const result = await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });
    const released = await reg.release(result.record!.id);
    assert.equal(released, true);
    const record = reg.get(result.record!.id);
    assert.equal(record?.status, "released");
  });

  it("release unknown id returns false", async () => {
    assert.equal(await reg.release("nonexistent"), false);
  });

  // ─── History ────────────────────────────────────────────────────

  it("terminal records are preserved in history", async () => {
    const r = await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "x"), recursive: true },
      mode: "exclusive-write",
    });
    await reg.release(r.record!.id);
    const history = await reg.listHistory();
    assert.equal(history.length, 1);
    const active = await reg.listActive();
    assert.equal(active.length, 0);
  });

  // ─── Persistence ────────────────────────────────────────────────

  it("save and reload persists records", async () => {
    await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
      reason: "test persistence",
    });

    // Create a fresh registry instance to verify persistence
    const reg2 = new OwnershipRegistry(dir);
    // Acquire triggers reload internally
    const result = await reg2.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });
    assert.equal(result.acquired, true); // renew of persisted record
  });

  // ─── Renew ──────────────────────────────────────────────────────

  it("renew extends TTL", async () => {
    const r = await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
      ttlMs: 60000,
    });
    const recordId = r.record!.id;
    const originalExpiry = r.record!.expiresAt;
    await reg.renew(recordId, 3600000);
    // After renew acquires its own lock, reload from disk
    const renewed = reg.get(recordId);
    assert.ok(renewed, "renewed record should exist");
    assert.ok(new Date(renewed!.expiresAt).getTime() > new Date(originalExpiry).getTime());
  });

  // ─── Events ─────────────────────────────────────────────────────

  it("events are emitted on acquire", async () => {
    events = [];
    const sink: OwnershipEventSink = { emit: async (event: string) => { events.push(event); } };
    const eventReg = new OwnershipRegistry(dir, { eventSink: sink });
    await eventReg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "x"), recursive: true },
      mode: "exclusive-write",
    });
    assert.ok(events.includes("ownership.acquired"));
  });

  it("events are emitted on denied", async () => {
    const scope = { kind: "path" as const, root: join(dir, "x"), recursive: true };
    await reg.acquire({ agentId: "agent-1", scope, mode: "exclusive-write" });
    // Wait for events to flush
    events = [];
    const sink: OwnershipEventSink = { emit: async (event: string) => { events.push(event); } };
    const eventReg = new OwnershipRegistry(dir, { eventSink: sink });
    await eventReg.acquire({ agentId: "agent-2", scope, mode: "exclusive-write" });
    assert.ok(events.includes("ownership.denied"));
  });

  // ─── Prune ──────────────────────────────────────────────────────

  it("prune removes only old terminal records", async () => {
    // Write an old released record directly to the store file (simulating past)
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const storePath = join(dir, ".alix", "ownership", "ownership.json");
    writeFileSync(storePath, JSON.stringify({
      version: 1,
      revision: 2,
      records: [
        {
          id: "own_old001",
          agentId: "agent-1",
          scope: { kind: "path", root: join(dir, "x"), recursive: true },
          mode: "exclusive-write",
          status: "released",
          acquiredAt: oldDate,
          expiresAt: oldDate,
          releasedAt: oldDate,
        },
      ],
    }, null, 2));

    const count = await reg.prune({ olderThanDays: 30 });
    assert.equal(count, 1);

    // Refresh and verify only old records were removed
    await reg.refresh();
    assert.equal(reg.list().length, 0);
  });

  // ─── authorizeMutation ──────────────────────────────────────────

  it("authorizeMutation passes for unowned path", async () => {
    const decision = await reg.authorizeMutation({
      agentId: "agent-1",
      targets: [{ path: join(dir, "new-file.ts"), origin: "single", confident: true }],
      autoAcquire: true,
    });
    assert.equal(decision.allowed, true);
  });

  it("authorizeMutation blocks conflicting write", async () => {
    const scope = { kind: "path" as const, root: join(dir, "src"), recursive: true };
    await reg.acquire({ agentId: "agent-2", scope, mode: "exclusive-write" });

    const decision = await reg.authorizeMutation({
      agentId: "agent-1",
      targets: [{ path: join(dir, "src/main.ts"), origin: "single", confident: true }],
      autoAcquire: true,
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason!.includes("Ownership conflict"));
  });

  it("authorizeMutation autoAcquire=false requires existing coverage", async () => {
    const decision = await reg.authorizeMutation({
      agentId: "agent-1",
      targets: [{ path: join(dir, "new-file.ts"), origin: "single", confident: true }],
      autoAcquire: false,
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason!.includes("Explicit ownership lease"));
  });

  it("authorizeMutation blocks unconfident targets in autoAcquire mode", async () => {
    const decision = await reg.authorizeMutation({
      agentId: "agent-1",
      targets: [{ path: join(dir, "cwd"), origin: "shell", confident: false }],
      autoAcquire: true,
    });
    assert.equal(decision.allowed, false);
    assert.ok(decision.reason!.includes("Unconfident targets"));
  });

  // ─── acquireMany ────────────────────────────────────────────────

  it("acquireMany succeeds for non-conflicting requests", async () => {
    const results = await reg.acquireMany([
      { agentId: "agent-1", scope: { kind: "path" as const, root: join(dir, "a"), recursive: true }, mode: "exclusive-write" as const },
      { agentId: "agent-2", scope: { kind: "path" as const, root: join(dir, "b"), recursive: true }, mode: "exclusive-write" as const },
    ]);
    assert.equal(results.length, 2);
    assert.equal(results[0].acquired, true);
    assert.equal(results[1].acquired, true);
  });

  it("acquireMany detects intra-batch conflict", async () => {
    const scope = { kind: "path" as const, root: join(dir, "shared"), recursive: true };
    const results = await reg.acquireMany([
      { agentId: "agent-1", scope, mode: "exclusive-write" },
      { agentId: "agent-2", scope, mode: "exclusive-write" },
    ]);
    assert.equal(results.length, 2);
    // At least one should fail (depending on lock order)
    const successes = results.filter(r => r.acquired).length;
    assert.ok(successes <= 1);
  });

  // ─── hasCoverageForPath ─────────────────────────────────────────

  it("hasCoverageForPath returns true for covered path", async () => {
    await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });
    assert.ok(reg.hasCoverageForPath("agent-1", join(dir, "src/main.ts")));
  });

  it("hasCoverageForPath returns false for uncovered path", async () => {
    assert.equal(reg.hasCoverageForPath("agent-1", join(dir, "src/main.ts")), false);
  });

  it("hasCoverageForPath returns false for other agent's lease", async () => {
    await reg.acquire({
      agentId: "agent-2",
      scope: { kind: "path", root: join(dir, "src"), recursive: true },
      mode: "exclusive-write",
    });
    assert.equal(reg.hasCoverageForPath("agent-1", join(dir, "src/main.ts")), false);
  });

  // ─── Revision ───────────────────────────────────────────────────

  it("revision increments on mutation", async () => {
    const revBefore = reg.currentRevision;
    await reg.acquire({
      agentId: "agent-1",
      scope: { kind: "path", root: join(dir, "rev-test"), recursive: true },
      mode: "exclusive-write",
    });
    assert.ok(reg.currentRevision > revBefore);
  });
});
