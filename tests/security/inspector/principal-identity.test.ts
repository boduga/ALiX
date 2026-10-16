/**
 * G3-A′ — operator principal identity: service lifecycle + authentication matrix.
 *
 * Covers enrollment (principal-first, inert orphan), rotation preserving
 * principalId, revocation preserving principalId, disablement denying ALL
 * authentication, legacy-token compatibility, migration, and reconcile.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AuthStore } from "../../../src/governance/security/inspector/auth-store.js";
import { PrincipalStore } from "../../../src/governance/security/inspector/principal-store.js";
import { AuthService } from "../../../src/governance/security/inspector/auth-service.js";
import type { AuditFn } from "../../../src/governance/security/inspector/auth-service.js";

function tempDir(): string {
  return join(tmpdir(), `alix-principal-${randomUUID()}`);
}

const noopAudit: AuditFn = () => {};
const noMetrics = () => {};

/** An audit fn that can be made to fail (to test write-ahead durability). */
function failingAudit(): AuditFn {
  return () => { throw new Error("audit backend down"); };
}

interface Fixture {
  dir: string;
  store: AuthStore;
  principals: PrincipalStore;
  service: AuthService;
}

function makeFixture(dir: string, audit: AuditFn = noopAudit): Fixture {
  const store = new AuthStore({ filePath: join(dir, "auth-store.json") });
  const principals = new PrincipalStore({ filePath: join(dir, "principals.json") });
  const service = new AuthService(store, audit, noMetrics, { principalStore: principals });
  return { dir, store, principals, service };
}

describe("operator principal identity", () => {
  let dir: string;

  beforeEach(async () => {
    dir = tempDir();
    await mkdir(dir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("enrollment creates a principal and binds the credential", async () => {
    const { service, principals } = makeFixture(dir);
    const created = await service.createToken({ name: "ops", role: "operator" });
    assert.ok(created.ok);
    const principalId = created.value.principalId;
    assert.match(principalId, /^prin_/);

    const p = await principals.get(principalId);
    assert.ok(p.ok && p.value);
    assert.equal(p.value.status, "active");

    // The credential resolves to the principal (bound).
    const verified = await service.verifyToken(created.value.token);
    assert.ok(verified.ok);
    assert.equal(verified.value.principalId, principalId);
  });

  it("adopts an existing principal via --principal", async () => {
    const { service, principals } = makeFixture(dir);
    const first = await service.createToken({ name: "ops", role: "operator" });
    assert.ok(first.ok);
    const principalId = first.value.principalId;

    const second = await service.createToken({ name: "ops2", role: "admin", principalId });
    assert.ok(second.ok);
    assert.equal(second.value.principalId, principalId);
    const all = await principals.list();
    assert.ok(all.ok);
    assert.equal(all.value.length, 1, "adoption does not create a second principal");
  });

  it("rotation preserves principalId (identity continuity)", async () => {
    const { service, store } = makeFixture(dir);
    const created = await service.createToken({ name: "ops", role: "operator" });
    assert.ok(created.ok);
    const principalId = created.value.principalId;

    const rotated = await service.rotateToken(created.value.id, 60_000);
    assert.ok(rotated.ok);

    const reloaded = await store.get(rotated.value.id);
    assert.ok(reloaded.ok && reloaded.value);
    assert.equal(reloaded.value.principalId, principalId);
  });

  it("revocation preserves principalId for historical attribution", async () => {
    const { service, store } = makeFixture(dir);
    const created = await service.createToken({ name: "ops", role: "operator" });
    assert.ok(created.ok);
    const principalId = created.value.principalId;

    const revoked = await service.revokeToken(created.value.id, "manual");
    assert.ok(revoked.ok);

    const reloaded = await store.get(created.value.id);
    assert.ok(reloaded.ok && reloaded.value);
    assert.ok(reloaded.value.revocation, "revoked");
    assert.equal(reloaded.value.principalId, principalId, "binding preserved");
  });

  it("disablement denies ALL authentication for a bound credential", async () => {
    const { service } = makeFixture(dir);
    const created = await service.createToken({ name: "ops", role: "operator" });
    assert.ok(created.ok);
    const principalId = created.value.principalId;

    // Active principal → ordinary access works.
    assert.ok((await service.verifyToken(created.value.token)).ok);

    const disabled = await service.disablePrincipal(principalId, "offboarding");
    assert.ok(disabled.ok);

    // Bound + disabled → deny all (bearer).
    const bearer = await service.verifyToken(created.value.token);
    assert.equal(bearer.ok, false);
    if (!bearer.ok) assert.equal(bearer.error, "principal_disabled");

    // Cookie revalidation denies too.
    const cookie = await service.verifyPrincipalStatus(created.value.id);
    assert.equal(cookie.ok, false);
    if (!cookie.ok) assert.equal(cookie.error, "principal_disabled");

    // Re-enable restores.
    assert.ok((await service.enablePrincipal(principalId)).ok);
    assert.ok((await service.verifyToken(created.value.token)).ok);
  });

  it("bound + missing principal denies all authentication (fail closed)", async () => {
    const { service } = makeFixture(dir);
    const created = await service.createToken({ name: "ops", role: "operator" });
    assert.ok(created.ok);

    // Simulate a principal record that vanished (e.g. manual file edit).
    await rm(join(dir, "principals.json"), { force: true });

    const bearer = await service.verifyToken(created.value.token);
    assert.equal(bearer.ok, false);
    if (!bearer.ok) assert.equal(bearer.error, "principal_missing");

    const cookie = await service.verifyPrincipalStatus(created.value.id);
    assert.equal(cookie.ok, false);
    if (!cookie.ok) assert.equal(cookie.error, "principal_missing");
  });

  it("legacy unbound credential keeps ordinary access", async () => {
    const { service, store } = makeFixture(dir);
    // Write an unbound legacy token directly (as pre-G3-A′ stores look).
    const { generateToken } = await import("../../../src/governance/security/inspector/token-format.js");
    const { createTokenRecord } = await import("../../../src/governance/security/inspector/auth-store.js");
    const gen = generateToken();
    const record = createTokenRecord({ id: gen.id, hash: gen.hash, name: "legacy", role: "operator" });
    delete (record as { principalId?: string }).principalId;
    assert.ok((await store.add(record)).ok);

    const verified = await service.verifyToken(gen.token);
    assert.ok(verified.ok, "unbound legacy token still authenticates");
    assert.equal(verified.value.principalId, undefined, "no principal asserted");
  });

  it("write-ahead audit failure persists nothing (enrollment)", async () => {
    const fixture = makeFixture(dir, failingAudit());
    const result = await fixture.service.createToken({ name: "ops", role: "operator" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "audit_write_failed");

    const tokens = await fixture.store.load();
    assert.ok(tokens.ok);
    assert.equal(tokens.value.length, 0, "no credential written");
    const principals = await fixture.principals.load();
    assert.ok(principals.ok);
    assert.equal(principals.value.length, 0, "no principal written");
  });

  it("migration binds unbound tokens and is idempotent", async () => {
    const { service, store } = makeFixture(dir);
    const { generateToken } = await import("../../../src/governance/security/inspector/token-format.js");
    const { createTokenRecord } = await import("../../../src/governance/security/inspector/auth-store.js");
    const gen = generateToken();
    assert.ok((await store.add(createTokenRecord({ id: gen.id, hash: gen.hash, name: "legacy", role: "operator" }))).ok);

    const first = await service.migrate();
    assert.ok(first.ok);
    assert.equal(first.value.bound.length, 1);

    // Re-running is idempotent: already-bound is skipped, no second principal.
    const second = await service.migrate();
    assert.ok(second.ok);
    assert.equal(second.value.bound.length, 0);
    assert.equal(second.value.skipped[0]?.reason, "already-bound");
  });

  it("migration never binds a revoked credential (no resurrection)", async () => {
    const { service, store } = makeFixture(dir);
    const { generateToken } = await import("../../../src/governance/security/inspector/token-format.js");
    const { createTokenRecord, createRevocation } = await import("../../../src/governance/security/inspector/auth-store.js");
    const gen = generateToken();
    const record = createTokenRecord({ id: gen.id, hash: gen.hash, name: "revoked", role: "operator" });
    record.revocation = createRevocation("prior");
    assert.ok((await store.add(record)).ok);

    const result = await service.migrate();
    assert.ok(result.ok);
    assert.equal(result.value.bound.length, 0);
    assert.equal(result.value.skipped[0]?.reason, "revoked");
  });

  it("migration adopts only an active principal (disabled → no change)", async () => {
    const { service, store, principals } = makeFixture(dir);
    const { generateToken } = await import("../../../src/governance/security/inspector/token-format.js");
    const { createTokenRecord } = await import("../../../src/governance/security/inspector/auth-store.js");
    const gen = generateToken();
    assert.ok((await store.add(createTokenRecord({ id: gen.id, hash: gen.hash, name: "legacy", role: "operator" }))).ok);

    const { createPrincipalRecord } = await import("../../../src/governance/security/inspector/principal-store.js");
    const p = createPrincipalRecord({ name: "target" });
    assert.ok((await principals.create(p)).ok);
    assert.ok((await principals.setStatus(p.id, { status: "disabled", reason: "test" })).ok);

    const result = await service.migrate({ principalId: p.id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "principal_disabled");

    const reloaded = await store.get(gen.id);
    assert.ok(reloaded.ok && reloaded.value);
    assert.equal(reloaded.value.principalId, undefined, "no binding written");
  });

  it("reconcile reports incomplete enrollment and never deletes", async () => {
    const { service, principals } = makeFixture(dir);
    const { createPrincipalRecord } = await import("../../../src/governance/security/inspector/principal-store.js");
    const orphan = createPrincipalRecord({ name: "orphan" });
    assert.ok((await principals.create(orphan)).ok);

    const report = await service.reconcile();
    assert.ok(report.ok);
    assert.equal(report.value.incompleteEnrollments.length, 1);
    assert.equal(report.value.incompleteEnrollments[0].id, orphan.id);

    // Still present (reconcile does not delete).
    assert.ok((await principals.get(orphan.id)).ok);
  });

  it("reconcile distinguishes no-active-credentials from incomplete enrollment", async () => {
    const { service, store } = makeFixture(dir);
    const created = await service.createToken({ name: "ops", role: "operator" });
    assert.ok(created.ok);
    assert.ok((await service.revokeToken(created.value.id, "gone")).ok);

    const report = await service.reconcile();
    assert.ok(report.ok);
    assert.equal(report.value.incompleteEnrollments.length, 0, "a credential was bound");
    assert.equal(report.value.noActiveCredentials.length, 1);
  });
});
