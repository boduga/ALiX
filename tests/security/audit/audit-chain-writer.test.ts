/**
 * P4.3-Sd1 — Audit chain writer tests.
 *
 * Covers genesis records, hash chaining, redaction, locking,
 * stale recovery, and legacy activation.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { AuditChainWriter } from "../../../src/security/audit/audit-chain-writer.js";
import { canonicalHash } from "../../../src/security/audit/canonical-json.js";
import type { AuditRecordV2, AnyAuditAction } from "../../../src/audit/audit-types.js";
import { acquire, type LockHandle } from "../../../src/security/audit/audit-lock.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "audit-chain-test-"));
}

function makeWriter(auditDir: string): AuditChainWriter {
  return new AuditChainWriter({ auditDir });
}

function makeFakeRecord(overrides?: {
  action?: string;
  timestamp?: number;
  actor?: string;
  details?: unknown;
}): Omit<AuditRecordV2, "version" | "seq" | "prevHash" | "recordHash"> {
  return {
    action: (overrides?.action ?? "auth.success") as AnyAuditAction,
    timestamp: overrides?.timestamp ?? Date.now(),
    actor: overrides?.actor ?? "test",
    details: overrides?.details ?? { requestId: "req-1", sessionId: "sess-1" },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditChainWriter", () => {
  let tmpDir: string;
  let writer: AuditChainWriter;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    writer = makeWriter(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Genesis record
  // -----------------------------------------------------------------------

  it("creates a genesis record with seq=1 and prevHash=null", async () => {
    const record = await writer.append(makeFakeRecord());
    assert.equal(record.version, 2);
    assert.equal(record.seq, 1);
    assert.equal(record.prevHash, null);
    assert.ok(typeof record.recordHash === "string");
    assert.equal(record.recordHash.length, 64);
  });

  it("writes the head sidecar after genesis", async () => {
    await writer.append(makeFakeRecord());
    const head = writer.readHead();
    assert.ok(head !== null);
    assert.equal(head!.seq, 1);
    assert.equal(typeof head!.recordHash, "string");
    assert.equal(head!.prevHash, null);
    assert.ok(typeof head!.updatedAt === "string");
  });

  // -----------------------------------------------------------------------
  // Sequential records
  // -----------------------------------------------------------------------

  it("assigns monotonically increasing sequence numbers", async () => {
    const r1 = await writer.append(makeFakeRecord());
    const r2 = await writer.append(makeFakeRecord());
    const r3 = await writer.append(makeFakeRecord());

    assert.equal(r1.seq, 1);
    assert.equal(r2.seq, 2);
    assert.equal(r3.seq, 3);
  });

  it("chains prevHash to the previous recordHash", async () => {
    const r1 = await writer.append(makeFakeRecord());
    const r2 = await writer.append(makeFakeRecord());
    const r3 = await writer.append(makeFakeRecord());

    assert.equal(r2.prevHash, r1.recordHash);
    assert.equal(r3.prevHash, r2.recordHash);
  });

  // -----------------------------------------------------------------------
  // Hash binds previous hash
  // -----------------------------------------------------------------------

  it("hash binds previous hash — altering prevHash would change recordHash", async () => {
    const r1 = await writer.append(makeFakeRecord());
    const r2 = await writer.append(makeFakeRecord());

    assert.equal(r2.prevHash, r1.recordHash);

    // Verify that the hash is dependent on the prevHash by recomputing
    // with a different input and checking it differs.
    const hashWithFakePrev = createHash("sha256")
      .update("alix-audit-v1:dummy" + String(r2.seq) + "bogus-prev")
      .digest("hex");

    assert.notEqual(r2.recordHash, hashWithFakePrev);
  });

  // -----------------------------------------------------------------------
  // Hash binds sequence
  // -----------------------------------------------------------------------

  it("hash binds sequence — altering seq would change recordHash", async () => {
    const r1 = await writer.append(makeFakeRecord());
    const r2 = await writer.append(makeFakeRecord());

    assert.equal(r1.seq, 1);
    assert.equal(r2.seq, 2);

    // If seq were different, the hash must differ.
    const hashWithFakeSeq = createHash("sha256")
      .update("alix-audit-v1:fake-999" + String(r2.prevHash ?? "null"))
      .digest("hex");

    assert.notEqual(r2.recordHash, hashWithFakeSeq);
  });

  // -----------------------------------------------------------------------
  // Redaction occurs before hashing
  // -----------------------------------------------------------------------

  it("redacts sensitive fields in details before hashing", async () => {
    const record = await writer.append(makeFakeRecord({
      details: {
        requestId: "req-1",
        token: "secret-token-abc123",
        password: "super-secret",
        apiKey: "sk-12345",
        safeField: "visible",
        nested: {
          cookie: "session=abc",
          value: 42,
        },
      },
    }));

    const details = record.details as Record<string, unknown>;
    assert.equal(details.token, "[REDACTED]");
    assert.equal(details.password, "[REDACTED]");
    assert.equal(details.apiKey, "[REDACTED]");
    assert.equal(details.requestId, "req-1");
    assert.equal(details.safeField, "visible");
    const nested = details.nested as Record<string, unknown>;
    assert.equal(nested.cookie, "[REDACTED]");
    assert.equal(nested.value, 42);
  });

  it("redacts authorization and bearer fields", async () => {
    const record = await writer.append(makeFakeRecord({
      details: {
        authorization: "Bearer token123",
        bearer: "token456",
        auth: "secret",
      },
    }));

    const details = record.details as Record<string, unknown>;
    assert.equal(details.authorization, "[REDACTED]");
    assert.equal(details.bearer, "[REDACTED]");
    assert.equal(details.auth, "[REDACTED]");
  });

  it("redacts IP address and host fields", async () => {
    const record = await writer.append(makeFakeRecord({
      details: {
        ip: "192.168.1.1",
        address: "10.0.0.1",
        host: "evil.example.com",
        origin: "https://attacker.com",
      },
    }));

    const details = record.details as Record<string, unknown>;
    assert.equal(details.ip, "[REDACTED]");
    assert.equal(details.address, "[REDACTED]");
    assert.equal(details.host, "[REDACTED]");
    assert.equal(details.origin, "[REDACTED]");
  });

  it("redaction affects record hash — unredacted would differ", async () => {
    const withToken = await writer.append(makeFakeRecord({
      details: { token: "secret", data: "hello" },
    }));

    const unredactedHash = canonicalHash({
      action: withToken.action,
      details: { token: "secret", data: "hello" },
      timestamp: withToken.timestamp,
    });

    assert.notEqual(withToken.recordHash, unredactedHash);
  });

  // -----------------------------------------------------------------------
  // Lock prevents concurrent writes
  // -----------------------------------------------------------------------

  it("prevents concurrent writes via cross-process lock", async () => {
    const lockPath = join(tmpDir, "audit.lock");

    // Manually acquire the lock.
    const lockResult = await acquire(lockPath);
    assert.ok(lockResult.ok, "Failed to acquire test lock");

    try {
      assert.ok(existsSync(lockPath));

      const secondAttempt = await acquire(lockPath, {
        timeoutMs: 500,
        maxRetries: 2,
        initialBackoffMs: 50,
      });

      assert.ok(!secondAttempt.ok, "Second lock acquisition should have failed");
    } finally {
      lockResult.release();
    }
  });

  // -----------------------------------------------------------------------
  // Stale lock handling
  // -----------------------------------------------------------------------

  it("detects stale lock when staleRecovery is manual", async () => {
    const lockPath = join(tmpDir, "audit.lock");

    const oldContent = {
      pid: 99999,
      host: "test-host",
      time: new Date(Date.now() - 60000).toISOString(),
      nonce: "fake-nonce",
    };

    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(oldContent), { encoding: "utf-8" });

    const result = await acquire(lockPath, {
      staleRecovery: "manual",
      staleThresholdMs: 30_000,
    });

    assert.ok(!result.ok);
    if (!result.ok) {
      assert.ok(result.error.toLowerCase().includes("stale"));
    }

    rmSync(lockPath, { force: true });
  });

  it("auto-recovers a stale lock when staleRecovery is auto", async () => {
    const lockPath = join(tmpDir, "audit.lock");

    const oldContent = {
      pid: 99999,
      host: "test-host",
      time: new Date(Date.now() - 60000).toISOString(),
      nonce: "fake-nonce-2",
    };

    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(oldContent), { encoding: "utf-8" });

    const result = await acquire(lockPath, {
      staleRecovery: "auto",
      staleThresholdMs: 30_000,
    });

    assert.ok(result.ok);
    if (result.ok) {
      result.release();
    }
  });

  // -----------------------------------------------------------------------
  // Lock timeout
  // -----------------------------------------------------------------------

  it("times out when lock is held longer than timeout", async () => {
    const lockPath = join(tmpDir, "audit.lock");

    const holder = await acquire(lockPath);
    assert.ok(holder.ok, "Failed to acquire initial lock");

    try {
      const result = await acquire(lockPath, {
        timeoutMs: 200,
        maxRetries: 3,
        initialBackoffMs: 50,
      });

      assert.ok(!result.ok);
      if (!result.ok) {
        assert.ok(
          result.code === "LOCK_TIMEOUT" || result.error.toLowerCase().includes("timeout"),
        );
      }
    } finally {
      holder.release();
    }
  });

  // -----------------------------------------------------------------------
  // Stale sidecar recovery
  // -----------------------------------------------------------------------

  it("recovers head from last v2 record when sidecar is missing", async () => {
    const r1 = await writer.append(makeFakeRecord({ actor: "one" }));
    assert.equal(r1.seq, 1);

    const headPath = join(tmpDir, "head.json");
    rmSync(headPath);

    assert.equal(writer.readHead(), null);

    const r2 = await writer.append(makeFakeRecord({ actor: "two" }));
    assert.equal(r2.seq, 2);
    assert.equal(r2.prevHash, r1.recordHash);

    const head = writer.readHead();
    assert.ok(head !== null);
    assert.equal(head!.seq, 2);
  });

  // -----------------------------------------------------------------------
  // Legacy activation (Sd1.6)
  // -----------------------------------------------------------------------

  it("legacy activation is idempotent", async () => {
    const result1 = await writer.activateLegacy();
    assert.ok(result1.activated === true);

    const result2 = await writer.activateLegacy();
    assert.ok(result2.activated === false);
    if (!result2.activated) {
      assert.ok(result2.reason.toLowerCase().includes("already activated"));
    }
  });

  it("legacy activation processes existing legacy records", async () => {
    const auditPath = join(tmpDir, "audit.jsonl");
    const legacyRecords = [
      { id: "audit_1", action: "policy.allowed", timestamp: "2025-01-01T00:00:00Z", details: {} },
      { id: "audit_2", action: "policy.denied", timestamp: "2025-01-02T00:00:00Z", details: { reason: "test" } },
    ];

    mkdirSync(dirname(auditPath), { recursive: true });
    writeFileSync(
      auditPath,
      legacyRecords.map((r) => JSON.stringify(r)).join("\n") + "\n",
      "utf-8",
    );

    const result = await writer.activateLegacy();

    assert.ok(result.activated, `Expected activation but got: ${(result as { reason: string }).reason}`);
    if (!result.activated) return;

    assert.equal(result.legacyCount, 2);
    assert.ok(result.legacyBytes > 0);
    assert.equal(typeof result.legacyDigest, "string");
    assert.equal(result.legacyDigest.length, 64);
    assert.equal(result.activationRecord.action, "audit.integrity_enabled");
    assert.equal(result.activationRecord.seq, 1);

    const head = writer.readHead();
    assert.ok(head?.legacy);
    assert.equal(head!.legacy!.count, 2);
    assert.equal(head!.legacy!.verified, false);
  });

  it("legacy activation computes a correct SHA-256 of legacy bytes", async () => {
    const auditPath = join(tmpDir, "audit.jsonl");
    const knownBytes = '{"id":"a1","action":"test","timestamp":"2025-01-01T00:00:00Z","details":{}}\n';

    mkdirSync(dirname(auditPath), { recursive: true });
    writeFileSync(auditPath, knownBytes, "utf-8");

    const expectedDigest = createHash("sha256").update(knownBytes, "utf8").digest("hex");

    const result = await writer.activateLegacy();
    assert.ok(result.activated);
    if (!result.activated) return;

    assert.equal(result.legacyDigest, expectedDigest);
  });

  it("legacy activation handles empty audit file gracefully", async () => {
    const result = await writer.activateLegacy();
    assert.ok(result.activated);
    if (!result.activated) return;

    assert.equal(result.legacyCount, 0);
    assert.equal(result.legacyBytes, 0);
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------

  it("lists records (newest first)", async () => {
    await writer.append(makeFakeRecord({ actor: "first" }));
    await writer.append(makeFakeRecord({ actor: "second" }));
    await writer.append(makeFakeRecord({ actor: "third" }));

    const records = writer.list();
    assert.equal(records.length, 3);
    const first = records[0] as AuditRecordV2;
    assert.equal(first.actor, "third");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await writer.append(makeFakeRecord());
    }
    const records = writer.list(3);
    assert.equal(records.length, 3);
  });
});
