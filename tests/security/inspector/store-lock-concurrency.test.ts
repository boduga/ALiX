/**
 * G3-A′ — cross-process store serialization + CAS.
 *
 * Atomic rename prevents torn files but not lost updates. These tests prove the
 * lock provides update isolation, a mutation fails closed while a lock is held,
 * the revision CAS refuses a stale writer, and concurrent migration is
 * idempotent. Two independent store instances stand in for two processes (the
 * locks are file-based, so they contend exactly as separate processes would).
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AuthStore, createTokenRecord } from "../../../src/governance/security/inspector/auth-store.js";
import { PrincipalStore, createPrincipalRecord } from "../../../src/governance/security/inspector/principal-store.js";
import { AuthService } from "../../../src/governance/security/inspector/auth-service.js";
import { STORE_LOCK_ORDER, StoreLocks, storeLockFile, withStoreLocksResult } from "../../../src/governance/security/inspector/store-lock.js";
import { acquire } from "../../../src/governance/security/audit/audit-lock.js";
import { generateToken } from "../../../src/governance/security/inspector/token-format.js";
import type { AuditFn } from "../../../src/governance/security/inspector/auth-service.js";

function tempDir(): string {
  return join(tmpdir(), `alix-storelock-${randomUUID()}`);
}

const noopAudit: AuditFn = () => {};
const noMetrics = () => {};

/** Fast lock options so contention tests do not wait the production 5s. */
const FAST = { timeoutMs: 300, initialBackoffMs: 10, maxRetries: 2 };

describe("store lock + CAS", () => {
  let dir: string;

  beforeEach(async () => {
    dir = tempDir();
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // CONTRIBUTING: timing-sensitive tests declare an explicit timeout with a
  // workload rationale. Contention tests intentionally wait out a short lock
  // timeout (FAST ≈ 300ms) a bounded number of times.
  it("a held store lock excludes a second acquirer", { timeout: 10_000 }, async () => {
    const lockFile = storeLockFile(dir, "auth-store");
    const first = await acquire(lockFile, { staleRecovery: "manual", ...FAST });
    assert.ok(first.ok, "first acquire succeeds");
    const second = await acquire(lockFile, { staleRecovery: "manual", ...FAST });
    assert.equal(second.ok, false, "second acquire is refused while held");
    if (first.ok) first.release();
  });

  it("a mutation fails closed while the lock is held, and succeeds after release", { timeout: 10_000 }, async () => {
    const store = new AuthStore({ filePath: join(dir, "auth-store.json") });
    const gen = generateToken();
    assert.ok((await store.add(createTokenRecord({ id: gen.id, hash: gen.hash, name: "t", role: "operator" }))).ok);

    const held = await StoreLocks.acquire(dir, ["auth-store"]);
    assert.ok(held.ok);
    const blocked = await withStoreLocksResult(dir, ["auth-store"], () => ({ ok: true as const, value: undefined }), FAST);
    assert.equal(blocked.ok, false, "mutation refused while the lock is held");

    // Meanwhile the record is untouched.
    const unchanged = await store.get(gen.id);
    assert.ok(unchanged.ok && unchanged.value);
    assert.equal(unchanged.value.name, "t");

    if (held.ok) held.locks.release();
    assert.ok((await store.update(gen.id, { name: "t2" })).ok, "succeeds once released");
  });

  it("two instances do not lose each other's update", async () => {
    const a = new AuthStore({ filePath: join(dir, "auth-store.json") });
    const b = new AuthStore({ filePath: join(dir, "auth-store.json") });
    const gen = generateToken();
    assert.ok((await a.add(createTokenRecord({ id: gen.id, hash: gen.hash, name: "orig", role: "operator" }))).ok);

    // Concurrent read-modify-writes touching different fields of the same record.
    await Promise.all([
      a.update(gen.id, { name: "renamed" }),
      b.update(gen.id, { expiresAt: "2999-01-01T00:00:00.000Z" }),
    ]);

    const after = await a.get(gen.id);
    assert.ok(after.ok && after.value);
    assert.equal(after.value.name, "renamed", "first writer's change survived");
    assert.equal(after.value.expiresAt, "2999-01-01T00:00:00.000Z", "second writer's change survived");
  });

  it("revision CAS refuses a stale writer", async () => {
    const principals = new PrincipalStore({ filePath: join(dir, "principals.json") });
    const p = createPrincipalRecord({ name: "ops" });
    assert.ok((await principals.create(p)).ok);

    // First writer bumps revision 1 → 2.
    assert.ok((await principals.setStatus(p.id, { status: "disabled", reason: "a" }, 1)).ok);

    // Second writer asserting the now-stale revision 1 is refused.
    const stale = await principals.setStatus(p.id, { status: "active" }, 1);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error, "revision_conflict");
  });

  it("lock order is canonical and a partial acquisition releases cleanly", { timeout: 10_000 }, async () => {
    assert.deepEqual([...STORE_LOCK_ORDER], ["principals", "auth-store"]);

    // Hold the principals lock; a principal→token acquisition must fail on the
    // first (principals) lock and write nothing — no deadlock, no partial hold.
    const held = await acquire(storeLockFile(dir, "principals"), { staleRecovery: "manual", ...FAST });
    assert.ok(held.ok);

    const attempt = await withStoreLocksResult(dir, ["auth-store", "principals"], () => ({ ok: true as const, value: "ran" }), FAST);
    assert.equal(attempt.ok, false, "refused while principals is held");

    if (held.ok) held.release();
    const retry = await withStoreLocksResult(dir, ["auth-store", "principals"], () => ({ ok: true as const, value: "ran" }), FAST);
    assert.equal(retry.ok, true);
  });

  it("concurrent migration from two instances is idempotent (one binding)", async () => {
    const store = new AuthStore({ filePath: join(dir, "auth-store.json") });
    const { createTokenRecord: mk } = await import("../../../src/governance/security/inspector/auth-store.js");
    const gen = generateToken();
    assert.ok((await store.add(mk({ id: gen.id, hash: gen.hash, name: "legacy", role: "operator" }))).ok);

    const s1 = new AuthService(store, noopAudit, noMetrics);
    const s2 = new AuthService(store, noopAudit, noMetrics);

    const [r1, r2] = await Promise.all([s1.migrate(), s2.migrate()]);
    assert.ok(r1.ok && r2.ok);

    // Exactly one of the two runs bound the token; the other skipped it.
    const totalBound = r1.value.bound.length + r2.value.bound.length;
    assert.equal(totalBound, 1, "the token is bound exactly once");

    const principals = new PrincipalStore({ filePath: join(dir, "principals.json") });
    const all = await principals.list();
    assert.ok(all.ok);
    assert.equal(all.value.length, 1, "exactly one principal was created");
  });
});
