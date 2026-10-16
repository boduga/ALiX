/**
 * SRAP-1 evidence HMAC key lifecycle (`srap-evidence` namespace).
 *
 * Covers generation, activation, rotation overlap, the two retirement gates
 * (eligibility vs explicit execution), fail-closed signing, the mandatory
 * key-read audit sink, and unverifiable-vs-invalid verification.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CredentialStore } from "../../../src/governance/security/credentials/credential-store.js";
import {
  SRAP_EVIDENCE_PROVIDER,
  SrapKeyUnavailableError,
  activeKeyVersion,
  generateKey,
  keyLabel,
  listKeyVersions,
  parseCredentialRef,
  parseKeyLabel,
  retireEligibility,
  retireKey,
  rotateKey,
  signCredentialRef,
  verifyCredentialRef,
} from "../../../src/governance/security/credentials/srap-evidence.js";
import type { KeyReadAudit } from "../../../src/governance/security/credentials/srap-evidence.js";

/** Discard sink for the mandatory audit on tests that don't assert on it. */
const noAudit: KeyReadAudit = () => {};

describe("srap-evidence key lifecycle", () => {
  let dir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "srap-evidence-"));
    store = new CredentialStore({ filePath: join(dir, "credential-store.json") });
    await store.load();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts with no active key and does not leak key material in list()", async () => {
    assert.equal(activeKeyVersion(store), null);
    assert.deepEqual(listKeyVersions(store), []);
    await generateKey(store);
    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].provider, SRAP_EVIDENCE_PROVIDER);
    assert.equal(listed[0].keyLabel, keyLabel(1));
    // list() must not expose the secret value.
    assert.ok(!("value" in listed[0]));
  });

  it("generate assigns increasing versions; active is the highest", async () => {
    assert.equal(await generateKey(store), 1);
    assert.equal(await generateKey(store), 2);
    assert.equal(activeKeyVersion(store), 2);
    assert.deepEqual(listKeyVersions(store), [1, 2]);
  });

  it("rotation is additive: old versions stay resolvable", async () => {
    const v1 = await generateKey(store);
    const v1Store = store.get(SRAP_EVIDENCE_PROVIDER, keyLabel(v1));
    assert.ok(v1Store);
    const ref1 = signCredentialRef(store, "cred-A", noAudit);

    const v2 = await rotateKey(store);
    assert.equal(v2, v1 + 1);
    // Old key bytes survive the rotation.
    assert.equal(store.get(SRAP_EVIDENCE_PROVIDER, keyLabel(v1)), v1Store);
    // The old ref still verifies under its own version.
    assert.equal(verifyCredentialRef(store, "cred-A", ref1, noAudit), "valid");
    // New signing uses v2.
    const ref2 = signCredentialRef(store, "cred-B", noAudit);
    assert.equal(parseCredentialRef(ref2)?.keyVersion, v2);
    // The canonical serialization carries the explicit version marker.
    assert.ok(ref2.startsWith("hmac-sha256:v2:"));
  });

  it("fail-closed: signing without an active key throws and commits nothing", async () => {
    assert.throws(() => signCredentialRef(store, "cred-A", noAudit), SrapKeyUnavailableError);
    assert.equal(store.list().length, 0);
  });

  it("verify distinguishes valid / invalid / unverifiable", async () => {
    await generateKey(store);
    const good = signCredentialRef(store, "cred-A", noAudit);
    assert.equal(verifyCredentialRef(store, "cred-A", good, noAudit), "valid");
    // Same ref, different record id → invalid (not unverifiable).
    assert.equal(verifyCredentialRef(store, "cred-B", good, noAudit), "invalid");
    // Malformed ref → unverifiable.
    assert.equal(verifyCredentialRef(store, "cred-A", "not-a-ref", noAudit), "unverifiable");
    assert.equal(verifyCredentialRef(store, "cred-A", "hmac-sha256:vX:abc", noAudit), "unverifiable");
    // Well-formed ref to a version that was never generated → unverifiable.
    assert.equal(verifyCredentialRef(store, "cred-A", "hmac-sha256:v9:AAAA", noAudit), "unverifiable");
  });

  it("reports every key access through the mandatory audit sink", async () => {
    const reads: Array<{ operation: string; keyVersion: number }> = [];
    const audit: KeyReadAudit = (e) => reads.push(e);

    await generateKey(store); // v1 active
    const ref = signCredentialRef(store, "cred-A", audit);
    // A verify that reads the key reports it, and a well-formed ref to an
    // absent version still reports the attempted access.
    assert.equal(verifyCredentialRef(store, "cred-A", ref, audit), "valid");
    assert.equal(verifyCredentialRef(store, "cred-A", "hmac-sha256:v9:AAAA", audit), "unverifiable");
    // A malformed ref short-circuits before any key access, so it is not logged.
    assert.equal(verifyCredentialRef(store, "cred-A", "not-a-ref", audit), "unverifiable");

    assert.deepEqual(reads, [
      { operation: "sign", keyVersion: 1 },
      { operation: "verify", keyVersion: 1 },
      { operation: "verify", keyVersion: 9 },
    ]);
  });

  it("a retired key version makes its refs unverifiable, never valid, never a reversal", async () => {
    const v1 = await generateKey(store);
    const ref1 = signCredentialRef(store, "cred-A", noAudit);
    assert.equal(verifyCredentialRef(store, "cred-A", ref1, noAudit), "valid");

    await rotateKey(store); // v2 active; v1 still present
    assert.equal(await retireKey(store, v1, 0), true);
    assert.equal(store.get(SRAP_EVIDENCE_PROVIDER, keyLabel(v1)), null);
    // The ref no longer resolves: unverifiable, NOT valid, NOT invalid.
    assert.equal(verifyCredentialRef(store, "cred-A", ref1, noAudit), "unverifiable");
  });

  it("retirement eligibility: absent, active, retained-references, eligible", async () => {
    await generateKey(store); // v1
    await generateKey(store); // v2 active
    assert.deepEqual(retireEligibility(store, 99, 0), { eligible: false, reason: "absent" });
    assert.deepEqual(retireEligibility(store, 2, 0), { eligible: false, reason: "active" });
    assert.deepEqual(retireEligibility(store, 1, 3), { eligible: false, reason: "retained-references" });
    assert.deepEqual(retireEligibility(store, 1, 0), { eligible: true });
  });

  it("refuses to retire the active key", async () => {
    const v1 = await generateKey(store);
    await assert.rejects(
      () => retireKey(store, v1, 0),
      (err: unknown) => err instanceof SrapKeyUnavailableError,
    );
    assert.equal(activeKeyVersion(store), v1);
  });

  it("refuses to retire a version still referenced by retained evidence", async () => {
    await generateKey(store); // v1
    await generateKey(store); // v2 active
    await assert.rejects(
      () => retireKey(store, 1, 2),
      (err: unknown) => err instanceof SrapKeyUnavailableError,
    );
    // The key is untouched.
    assert.notEqual(store.get(SRAP_EVIDENCE_PROVIDER, keyLabel(1)), null);
  });

  it("retiring an absent version is a no-op false", async () => {
    await generateKey(store);
    await generateKey(store);
    assert.equal(await retireKey(store, 99, 0), false);
  });

  it("rejects malformed key labels", () => {
    assert.equal(parseKeyLabel("hmac-key:v0"), null);
    assert.equal(parseKeyLabel("hmac-key:v"), null);
    assert.equal(parseKeyLabel("hmac-key:vX"), null);
    assert.equal(parseKeyLabel("other:v1"), null);
    assert.equal(parseKeyLabel("hmac-key:v3"), 3);
  });
});
